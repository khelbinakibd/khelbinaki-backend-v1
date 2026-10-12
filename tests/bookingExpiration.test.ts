import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'
import mongoose from 'mongoose'
import { Booking } from '../src/models/Booking'
import { Facility } from '../src/models/Facility'
import { ExpirationBatchError, expirePendingBookings, expiredPendingBookingFilter } from '../src/services/bookingExpirationService'
import { withFacilityOccupancyGuard } from '../src/services/facilityOccupancyGuard'
import { dhakaDateTimeToInstant } from '../src/utils/businessTime'

let originalOfflineAck: string | undefined
beforeEach(() => {
  originalOfflineAck = process.env.BOOKING_EXPIRATION_OFFLINE_ACK
  process.env.BOOKING_EXPIRATION_OFFLINE_ACK = 'all-other-writers-stopped-and-access-disabled'
})
afterEach(() => {
  mock.restoreAll()
  if (originalOfflineAck === undefined)
    delete process.env.BOOKING_EXPIRATION_OFFLINE_ACK
  else
    process.env.BOOKING_EXPIRATION_OFFLINE_ACK = originalOfflineAck
})

const now = dhakaDateTimeToInstant('2026-10-12', '00:01')
const facility = new mongoose.Types.ObjectId()
const turf = new mongoose.Types.ObjectId()
const candidate = { _id: new mongoose.Types.ObjectId(), facility, turf }

// These tests isolate database calls; they do not connect or prove MongoDB's
// isolation. Real replica-set contention remains a BUG-08 integration check.
function installFakes(candidates: any[] = [candidate]) {
  const events: string[] = []
  const session = {
    async withTransaction(callback: () => Promise<unknown>, options: any) {
      assert.deepEqual(options, {
        readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary',
      })
      events.push('begin')
      try {
        const value = await callback()
        events.push('commit')
        return value
      }
      catch (error) {
        events.push('abort')
        throw error
      }
    },
    async endSession() { events.push('end') },
  }
  mock.method(mongoose, 'startSession', async () => session)
  mock.method(Booking.collection, 'listIndexes', () => ({ toArray: async () => [] }))
  mock.method(Booking, 'find', (filter: any) => {
    assert.deepEqual(filter, expiredPendingBookingFilter(now))
    return {
      select(fields: string) {
        assert.equal(fields, '_id facility turf')
        return {
          sort(sort: any) {
            assert.deepEqual(sort, { expiresAt: 1, _id: 1 })
            return {
              limit(limit: number) {
                assert.equal(limit, 100)
                return { lean: async () => candidates }
              },
            }
          },
        }
      },
    }
  })
  mock.method(Facility, 'updateOne', async (filter: any, update: any, options: any) => {
    events.push('guard')
    assert.deepEqual(filter, { _id: facility, turf })
    assert.deepEqual(update, { $inc: { occupancyRevision: 1 } })
    assert.equal(options.session, session)
    return { matchedCount: 1 }
  })
  const bookingUpdate = mock.method(Booking, 'updateOne', async (filter: any, update: any, options: any) => {
    events.push('expire')
    assert.ok(candidates.some(item => item._id.equals(filter._id)))
    assert.deepEqual({ ...filter, _id: candidate._id }, { ...candidate, ...expiredPendingBookingFilter(now) })
    assert.deepEqual(update, { $set: { status: 'expired', expiredAt: now } })
    assert.equal(options.session, session)
    assert.equal(options.runValidators, true)
    return { modifiedCount: 1 }
  })
  return { events, session, bookingUpdate }
}

test('schema retains expired history, declares no Booking TTL, and preserves BUG-04', () => {
  const booking = new Booking({ status: 'expired', expiredAt: now })
  assert.equal(booking.validateSync()?.errors.status, undefined)
  assert.equal(Booking.schema.path('expiresAt').options.default, undefined)
  const indexes = Booking.schema.indexes()
  assert.equal(indexes.some(([, options]) => options.expireAfterSeconds !== undefined), false)
  const unique = indexes.find(([, options]) => options.name === 'uniq_active_booking_slot')!
  assert.deepEqual(unique[0], { turf: 1, facility: 1, date: 1, startTime: 1, endTime: 1 })
  assert.equal(unique[1].unique, true)
  assert.deepEqual(unique[1].partialFilterExpression, { status: { $in: ['pending', 'confirmed'] } })
  assert.equal(Facility.schema.path('occupancyRevision').options.select, false)
})

test('cutoff is an instant across the Dhaka day boundary; no 15-minute deadline is inferred', () => {
  assert.equal(now.toISOString(), '2026-10-11T18:01:00.000Z')
  assert.deepEqual(expiredPendingBookingFilter(now), { status: 'pending', paymentStatus: { $ne: 'paid' }, expiresAt: { $type: 'date', $lt: now } })
  assert.throws(() => expiredPendingBookingFilter(new Date('invalid')), /Invalid expiration cutoff/)
})

test('guard precedes conditional expiration; transaction operations are sequential', async () => {
  const { events } = installFakes()
  assert.equal(await expirePendingBookings(now), 1)
  assert.deepEqual(events, ['begin', 'guard', 'expire', 'commit', 'end'])
})

test('a still-installed TTL index fails closed before selecting or writing records', async () => {
  const { events } = installFakes()
  mock.method(Booking.collection, 'listIndexes', () => ({
    toArray: async () => [{ name: 'expiresAt_1', expireAfterSeconds: 0 }],
  }))
  await assert.rejects(expirePendingBookings(now), /TTL indexes are removed/)
  assert.deepEqual(events, [])
})

test('expiration refuses online operation until all other writers share the guard', async () => {
  const { events } = installFakes()
  delete process.env.BOOKING_EXPIRATION_OFFLINE_ACK
  await assert.rejects(expirePendingBookings(now), /requires offline operation/)
  assert.deepEqual(events, [])
})

test('no candidates and a legacy candidate never issue unguarded writes', async () => {
  const fakes = installFakes([])
  assert.equal(await expirePendingBookings(now), 0)
  assert.deepEqual(fakes.events, [])
  mock.restoreAll()
  const legacy = installFakes([candidate, { ...candidate, facility: undefined }])
  await assert.rejects(expirePendingBookings(now), /legacy bookings/)
  assert.deepEqual(legacy.events, [])
})

test('missing facility aborts, ends the session and never expires the booking', async () => {
  const { events } = installFakes()
  mock.method(Facility, 'updateOne', async () => { events.push('guard'); return { matchedCount: 0 } })
  await assert.rejects(expirePendingBookings(now), (error: unknown) => error instanceof ExpirationBatchError && error.completedCount === 0 && String(error.cause).includes('facility is missing'))
  assert.deepEqual(events, ['begin', 'guard', 'abort', 'end'])
})

test('booking write errors abort instead of falling back to a nontransactional update', async () => {
  const { events } = installFakes()
  mock.method(Booking, 'updateOne', async () => { events.push('expire'); throw new Error('write failed') })
  await assert.rejects(expirePendingBookings(now), (error: unknown) => error instanceof ExpirationBatchError && error.completedCount === 0 && String(error.cause).includes('write failed'))
  assert.deepEqual(events, ['begin', 'guard', 'expire', 'abort', 'end'])
})

test('unsupported sessions fail without facility or booking writes', async () => {
  const { events } = installFakes()
  mock.method(mongoose, 'startSession', async () => { throw new Error('sessions unavailable') })
  await assert.rejects(expirePendingBookings(now), (error: unknown) => error instanceof ExpirationBatchError && String(error.cause).includes('sessions unavailable'))
  assert.deepEqual(events, [])
})

test('two cleanup calls only count one transition after the conditional recheck', async () => {
  installFakes()
  let pending = true
  mock.method(Booking, 'updateOne', async (filter: any) => {
    assert.equal(filter.status, 'pending')
    const modifiedCount = pending ? 1 : 0
    pending = false
    return { modifiedCount }
  })
  assert.deepEqual(await Promise.all([expirePendingBookings(now), expirePendingBookings(now)]), [1, 0])
})

test('confirmed, cancelled, moved, rescheduled or already expired candidates are skipped on recheck', async () => {
  const { bookingUpdate } = installFakes()
  for (const current of [
    { status: 'confirmed', facility, turf, expiresAt: new Date(now.getTime() - 1) },
    { status: 'cancelled', facility, turf, expiresAt: new Date(now.getTime() - 1) },
    { status: 'expired', facility, turf, expiresAt: new Date(now.getTime() - 1) },
    { status: 'pending', facility: new mongoose.Types.ObjectId(), turf, expiresAt: new Date(now.getTime() - 1) },
    { status: 'pending', facility, turf, expiresAt: new Date(now.getTime() + 1) },
    { status: 'pending', facility, turf, expiresAt: now },
    { status: 'pending', facility, turf, expiresAt: undefined },
  ]) {
    bookingUpdate.mock.mockImplementation(async (filter: any) => ({
      modifiedCount: current.status === filter.status
        && current.facility.equals(filter.facility)
        && current.expiresAt !== undefined
        && current.expiresAt < filter.expiresAt.$lt ? 1 : 0,
    }))
    assert.equal(await expirePendingBookings(now), 0)
  }
})

test('guard callback is re-executed with the session on transaction retry', async () => {
  const { events, session } = installFakes()
  mock.method(session, 'withTransaction', async (callback: () => Promise<unknown>) => {
    await callback() // simulate an aborted attempt, then driver retry
    return callback()
  })
  let attempts = 0
  assert.equal(await withFacilityOccupancyGuard(facility, turf, async (received) => {
    assert.equal(received, session)
    return ++attempts
  }), 2)
  assert.deepEqual(events, ['guard', 'guard', 'end'])
})

test('invalid batch sizes fail before any database access', async () => {
  const { events } = installFakes()
  for (const size of [0, -1, 1001, 1.5])
    await assert.rejects(expirePendingBookings(now, size), /batch size/)
  assert.deepEqual(events, [])
})

test('paid-pending and confirmed overdue records do not match expiration', async () => {
  installFakes()
  for (const current of [
    { status: 'pending', paymentStatus: 'paid' },
    { status: 'confirmed', paymentStatus: 'paid' },
    { status: 'confirmed', paymentStatus: 'unpaid' },
  ]) {
    mock.method(Booking, 'updateOne', async (filter: any) => {
      assert.deepEqual(filter.paymentStatus, { $ne: 'paid' })
      return { modifiedCount: current.status === filter.status && current.paymentStatus !== filter.paymentStatus.$ne ? 1 : 0 }
    })
    assert.equal(await expirePendingBookings(now), 0)
  }
})

test('partial failure reports earlier commits and stops before later candidates', async () => {
  const candidates = [candidate, { ...candidate, _id: new mongoose.Types.ObjectId() }, { ...candidate, _id: new mongoose.Types.ObjectId() }]
  const { events } = installFakes(candidates)
  let attempts = 0
  mock.method(Booking, 'updateOne', async () => {
    if (++attempts === 2)
      throw new Error('second write failed')
    return { modifiedCount: 1 }
  })
  await assert.rejects(expirePendingBookings(now), (error: unknown) => {
    assert.ok(error instanceof ExpirationBatchError)
    assert.equal(error.completedCount, 1)
    assert.equal(error.candidateCount, 3)
    assert.equal(error.batchLimit, 100)
    assert.match(String(error.cause), /second write failed/)
    return true
  })
  assert.equal(attempts, 2)
  assert.deepEqual(events, ['begin', 'guard', 'commit', 'end', 'begin', 'guard', 'abort', 'end'])
})
