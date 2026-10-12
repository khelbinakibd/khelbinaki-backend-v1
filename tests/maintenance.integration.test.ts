import type { AddressInfo } from 'node:net'
import type { OccupancyActor } from '../src/services/occupancyService'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
// eslint-disable-next-line test/no-import-node-test
import { after, before, beforeEach, describe, mock, test } from 'node:test'
import mongoose from 'mongoose'
import { Booking } from '../src/models/Booking'
import { Facility } from '../src/models/Facility'
import { MaintenanceBlock } from '../src/models/MaintenanceBlock'
import { Turf } from '../src/models/Turf'
import { User } from '../src/models/User'
import { ExpirationBatchError, expirePendingBookings } from '../src/services/bookingExpirationService'
import { createGuardedBooking, mutateBookingOccupancy } from '../src/services/bookingOccupancyService'
import { getTurfAvailability } from '../src/services/bookingServices'
import { withFacilityOccupancyGuard } from '../src/services/facilityOccupancyGuard'
import { deleteFacility } from '../src/services/facilityServices'
import { createMaintenanceBlock, listMaintenanceBlocks, releaseMaintenanceBlock } from '../src/services/maintenanceService'
import { dhakaDateStart } from '../src/utils/businessTime'

// No .env files, app startup or seeding. Only a fresh DB on a loopback replica set.
// autoIndex/autoCreate are disabled; BUG-04 is explicitly installed only in this disposable DB.
const enabled = process.env.RUN_BUG08_MONGO_TESTS === '1'
const port = Number(process.env.BUG08_TEST_MONGO_PORT ?? 27028)
const databaseName = `bug08_test_${new mongoose.Types.ObjectId().toHexString()}`
const dateKey = '2099-06-01'
const manager: OccupancyActor = { id: new mongoose.Types.ObjectId().toString(), role: 'manager' }
const admin: OccupancyActor = { id: new mongoose.Types.ObjectId().toString(), role: 'admin' }
const outsider: OccupancyActor = { id: new mongoose.Types.ObjectId().toString(), role: 'admin' }
const customer: OccupancyActor = { id: new mongoose.Types.ObjectId().toString(), role: 'user' }
let facilityId: mongoose.Types.ObjectId
let turfId: mongoose.Types.ObjectId
let offlineAck: string | undefined

function bookingData(startTime = '10:00', endTime = '11:00'): any {
  return {
    user: new mongoose.Types.ObjectId(customer.id),
    turf: turfId,
    facility: facilityId,
    date: dhakaDateStart(dateKey),
    startTime,
    endTime,
    status: 'pending',
    paymentStatus: 'unpaid',
    appliedPricePerSlot: 100,
    totalPrice: 100,
    pricingRule: 'all-days',
    dayType: 'sunday-thursday',
    lastDigit: 1234,
  }
}
function blockData(startTime = '10:00', endTime = '11:00') {
  return { date: dateKey, startTime, endTime, reason: 'test maintenance' }
}
function rejectsWith(code: number) {
  return (error: any) => error.statusCode === code
}
function assertSingleWinner(results: PromiseSettledResult<unknown>[]) {
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1)
  const failure = results.find(item => item.status === 'rejected') as PromiseRejectedResult
  assert.equal(failure.reason.statusCode, 409)
}

describe('real isolated MongoDB transactions for BUG-08', { skip: !enabled, concurrency: false }, () => {
  before(async () => {
    assert.ok(Number.isInteger(port) && port > 1024 && port < 65536)
    await mongoose.connect(`mongodb://127.0.0.1:${port}/${databaseName}?directConnection=true`, {
      autoIndex: false,
      autoCreate: false,
      serverSelectionTimeoutMS: 10000,
    })
    const db = mongoose.connection.db!
    const hello = await db.command({ hello: 1 })
    assert.ok(hello.setName && hello.logicalSessionTimeoutMinutes)
    assert.equal(db.databaseName, databaseName)
    for (const model of [Booking, Facility, Turf, MaintenanceBlock, User])
      await db.createCollection(model.collection.collectionName)
    // Use the schema's actual BUG-04 specification, never syncIndexes.
    const unique = Booking.schema.indexes().find(([, options]) => options.name === 'uniq_active_booking_slot')!
    await Booking.collection.createIndex(unique[0] as mongoose.mongo.IndexSpecification, unique[1] as mongoose.mongo.CreateIndexesOptions)
    const installed = await Booking.collection.listIndexes().toArray()
    assert.ok(installed.some(index => index.name === 'uniq_active_booking_slot' && index.unique))
    offlineAck = process.env.BOOKING_EXPIRATION_OFFLINE_ACK
    process.env.BOOKING_EXPIRATION_OFFLINE_ACK = 'all-other-writers-stopped-and-access-disabled'
  })
  after(async () => {
    // Only delete fixtures in this randomly named test DB; never touch other DBs.
    if (mongoose.connection.db?.databaseName === databaseName) {
      for (const collection of [Booking.collection, MaintenanceBlock.collection, Facility.collection, Turf.collection, User.collection])
        await collection.deleteMany({})
    }
    await mongoose.disconnect()
    if (offlineAck === undefined)
      delete process.env.BOOKING_EXPIRATION_OFFLINE_ACK
    else
      process.env.BOOKING_EXPIRATION_OFFLINE_ACK = offlineAck
  })
  beforeEach(async () => {
    for (const collection of [Booking.collection, MaintenanceBlock.collection, Facility.collection, Turf.collection, User.collection])
      await collection.deleteMany({})
    const turf = await Turf.create({
      name: 'isolated test turf',
      admins: [admin.id],
      location: { address: 'test', city: 'test' },
      bkashNumber: 'test',
      operatingHours: { start: '09:00', end: '14:00' },
    })
    turfId = turf._id as mongoose.Types.ObjectId
    const facility = await Facility.create({
      name: 'isolated test facility',
      turf: turfId,
      pricingRules: [{ dayType: 'all-days', timeSlots: [{ startTime: '00:00', endTime: '23:59', pricePerSlot: 100 }] }],
    })
    facilityId = facility._id as mongoose.Types.ObjectId
  })

  test('authorization applies to list, create, release and wrong-facility block IDs', async () => {
    await assert.rejects(createMaintenanceBlock(String(facilityId), outsider, blockData()), rejectsWith(403))
    await assert.rejects(listMaintenanceBlocks(String(facilityId), outsider, {}), rejectsWith(403))
    const block = await createMaintenanceBlock(String(facilityId), admin, blockData())
    await assert.rejects(releaseMaintenanceBlock(String(facilityId), String(block._id), outsider), rejectsWith(403))
    const other = await Facility.create({ name: 'other', turf: turfId, pricingRules: (await Facility.findById(facilityId))!.pricingRules })
    await assert.rejects(releaseMaintenanceBlock(String(other._id), String(block._id), manager), rejectsWith(404))
    assert.equal((await listMaintenanceBlocks(String(facilityId), manager, {})).length, 1)
    await assert.rejects(createGuardedBooking({ ...bookingData('12:00', '13:00'), isManual: true }, outsider), rejectsWith(403))
  })

  test('real authenticated HTTP endpoints enforce authentication, role scope and interval validation', async () => {
    const originalMode = process.env.NODE_ENV
    const originalKey = process.env.JWT_SECRET
    process.env.NODE_ENV = 'test'
    process.env.JWT_SECRET = 'isolated-bug08-test-signing-key-only'
    const { default: express } = await import('express')
    const { default: jwt } = await import('jsonwebtoken')
    const { default: router } = await import('../src/routes/facilityRoutes')
    const app = express()
    app.use(express.json())
    app.use('/api/v1', router)
    app.use((error: any, _req: any, res: any, _next: any) => {
      res.status(error.statusCode ?? (error.name === 'ZodError' ? 400 : 500)).json({ message: error.message })
    })
    const server = app.listen(0, '127.0.0.1')
    await new Promise<void>(resolve => server.once('listening', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/facilities/${facilityId}/maintenance-blocks`
    const headers = (actor: OccupancyActor) => ({
      'Authorization': `Bearer ${jwt.sign(actor, process.env.JWT_SECRET!, { expiresIn: '5m' })}`,
      'Content-Type': 'application/json',
    })
    try {
      assert.equal((await fetch(base)).status, 401)
      assert.equal((await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(blockData()) })).status, 401)
      assert.equal((await fetch(`${base}/${new mongoose.Types.ObjectId()}/release`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401)
      assert.equal((await fetch(base, { headers: headers(outsider) })).status, 403)
      assert.equal((await fetch(base, { method: 'POST', headers: headers(admin), body: JSON.stringify(blockData('23:00', '01:00')) })).status, 400)
      const created = await fetch(base, { method: 'POST', headers: headers(admin), body: JSON.stringify(blockData()) })
      assert.equal(created.status, 201)
      const block = (await created.json() as any).data
      assert.equal((await fetch(`${base}/${block._id}/release`, { method: 'PATCH', headers: headers(outsider), body: '{}' })).status, 403)
      assert.equal((await fetch(`${base}/${block._id}/release`, { method: 'PATCH', headers: headers(manager), body: '{"reason":"complete"}' })).status, 200)
      const listed = await fetch(`${base}?includeReleased=true&date=${dateKey}`, { headers: headers(manager) })
      assert.equal(listed.status, 200)
      assert.equal(((await listed.json()) as any).data.length, 1)
      const races = await Promise.all([
        fetch(base, { method: 'POST', headers: headers(admin), body: JSON.stringify(blockData('13:00', '14:00')) }),
        fetch(base, { method: 'POST', headers: headers(manager), body: JSON.stringify(blockData('13:30', '14:30')) }),
      ])
      assert.deepEqual(races.map(response => response.status).sort((a, b) => a - b), [201, 409])
    }
    finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      if (originalMode === undefined)
        delete process.env.NODE_ENV
      else process.env.NODE_ENV = originalMode
      if (originalKey === undefined)
        delete process.env.JWT_SECRET
      else process.env.JWT_SECRET = originalKey
    }
  })

  test('assigned users may list/create/release; unassigned users cannot', async () => {
    await Turf.updateOne({ _id: turfId }, { $addToSet: { admins: customer.id } })
    const block = await createMaintenanceBlock(String(facilityId), customer, blockData())
    assert.equal((await listMaintenanceBlocks(String(facilityId), customer, {})).length, 1)
    await releaseMaintenanceBlock(String(facilityId), String(block._id), customer)
    await Turf.updateOne({ _id: turfId }, { $pull: { admins: customer.id } })
    await assert.rejects(listMaintenanceBlocks(String(facilityId), customer, {}), rejectsWith(403))
    await assert.rejects(createMaintenanceBlock(String(facilityId), customer, blockData()), rejectsWith(403))
    await assert.rejects(releaseMaintenanceBlock(String(facilityId), String(block._id), customer), rejectsWith(403))
  })

  test('payment approval conflict rolls back payment/status/revision and sends no email', async () => {
    const booking = await Booking.create({ ...bookingData(), status: 'cancelled', paymentStatus: 'pending_approval' })
    await createMaintenanceBlock(String(facilityId), manager, blockData())
    const revision = (await Facility.findById(facilityId).select('+occupancyRevision'))!.occupancyRevision
    const emails = createRequire(`${process.cwd()}/tests/maintenance.integration.test.ts`)('../src/services/emailServices') as typeof import('../src/services/emailServices')
    const send = mock.method(emails, 'sendBookingConfirmationEmail', async () => {})
    try {
      const { approveBookingPaymentHandler } = await import('../src/controllers/adminController')
      await assert.rejects(new Promise<void>((resolve, reject) => {
        approveBookingPaymentHandler({ params: { id: String(booking._id) }, user: manager } as any, { json: () => resolve() } as any, reject)
      }), rejectsWith(409))
      const after = await Booking.findById(booking._id)
      assert.equal(after!.status, 'cancelled')
      assert.equal(after!.paymentStatus, 'pending_approval')
      assert.equal((await Facility.findById(facilityId).select('+occupancyRevision'))!.occupancyRevision, revision)
      assert.equal(send.mock.callCount(), 0)
    }
    finally { send.mock.restore() }
  })

  for (const conflict of ['booking', 'maintenance'] as const) {
    test(`manual ${conflict} conflict retains newly created customer but creates no booking`, async () => {
      if (conflict === 'booking')
        await Booking.create(bookingData())
      else await createMaintenanceBlock(String(facilityId), manager, blockData())
      const originalCount = await Booking.countDocuments({})
      const { createAdminBookingHandler } = await import('../src/controllers/adminController')
      await assert.rejects(new Promise<void>((resolve, reject) => {
        createAdminBookingHandler({ user: manager, body: {
          turf: String(turfId),
          facility: String(facilityId),
          date: dateKey,
          startTime: '10:00',
          endTime: '11:00',
          userPhone: '01700000000',
          firstName: 'Isolated',
          lastName: 'Customer',
          email: 'isolated@example.invalid',
          totalPayment: 100,
          paidAmount: 0,
        } } as any, { status: () => ({ json: () => resolve() }) } as any, reject)
      }), rejectsWith(409))
      assert.equal(await Booking.countDocuments({}), originalCount)
      assert.equal(await User.countDocuments({ phone: '01700000000' }), 1)
    })
  }

  test('overlap conflicts, adjacency succeeds, release audit is idempotent', async () => {
    const first = await createMaintenanceBlock(String(facilityId), manager, blockData())
    await assert.rejects(createMaintenanceBlock(String(facilityId), admin, blockData('10:30', '11:30')), rejectsWith(409))
    await createMaintenanceBlock(String(facilityId), admin, blockData('11:00', '12:00'))
    const released = await releaseMaintenanceBlock(String(facilityId), String(first._id), admin, 'done')
    const again = await releaseMaintenanceBlock(String(facilityId), String(first._id), manager, 'different')
    assert.equal(again.releasedAt!.getTime(), released.releasedAt!.getTime())
    assert.equal(again.releasedBy!.toString(), admin.id)
    assert.equal(again.releaseReason, 'done')
    await createGuardedBooking(bookingData(), customer)
  })

  test('public availability includes maintenance and old pending holds; release restores availability', async () => {
    const block = await createMaintenanceBlock(String(facilityId), manager, blockData())
    const pending = await createGuardedBooking(bookingData('12:00', '13:00'), customer)
    await Booking.collection.updateOne({ _id: pending._id as mongoose.Types.ObjectId }, { $set: { createdAt: new Date(0) } })
    let available = await getTurfAvailability(String(turfId), dateKey, String(facilityId))
    assert.equal(available.slots.find(slot => slot.startTime === '10:00')!.isAvailable, false)
    assert.equal(available.slots.find(slot => slot.startTime === '11:00')!.isAvailable, true)
    assert.equal(available.slots.find(slot => slot.startTime === '12:00')!.isAvailable, false)
    await releaseMaintenanceBlock(String(facilityId), String(block._id), manager)
    available = await getTurfAvailability(String(turfId), dateKey, String(facilityId))
    assert.equal(available.slots.find(slot => slot.startTime === '10:00')!.isAvailable, true)
  })

  test('customer/admin booking conflicts with blocks; pending/confirmed bookings conflict with blocks', async () => {
    const block = await createMaintenanceBlock(String(facilityId), manager, blockData())
    await assert.rejects(createGuardedBooking(bookingData(), customer), rejectsWith(409))
    await assert.rejects(createGuardedBooking({ ...bookingData(), isManual: true, status: 'confirmed', paymentStatus: 'paid' }, admin), rejectsWith(409))
    await releaseMaintenanceBlock(String(facilityId), String(block._id), manager)
    const booking = await createGuardedBooking(bookingData(), customer)
    await assert.rejects(createMaintenanceBlock(String(facilityId), manager, blockData()), rejectsWith(409))
    await mutateBookingOccupancy(String(booking._id), admin, { kind: 'approve' })
    await assert.rejects(createMaintenanceBlock(String(facilityId), manager, blockData()), rejectsWith(409))
  })

  test('cancellation, reactivation, approval, payment, and deletion use guarded fresh state', async () => {
    const booking = await createGuardedBooking(bookingData(), customer)
    await assert.rejects(mutateBookingOccupancy(String(booking._id), outsider, { kind: 'delete' }), rejectsWith(403))
    await mutateBookingOccupancy(String(booking._id), customer, { kind: 'cancel-own' })
    const block = await createMaintenanceBlock(String(facilityId), manager, blockData())
    for (const mutation of [{ kind: 'status', status: 'pending' }, { kind: 'approve' }] as const)
      await assert.rejects(mutateBookingOccupancy(String(booking._id), admin, mutation), rejectsWith(409))
    await releaseMaintenanceBlock(String(facilityId), String(block._id), manager)
    await mutateBookingOccupancy(String(booking._id), admin, { kind: 'status', status: 'pending' })
    const paid = await mutateBookingOccupancy(String(booking._id), admin, { kind: 'paid' })
    assert.equal(paid.status, 'confirmed')
    const cancelled = await mutateBookingOccupancy(String(booking._id), admin, { kind: 'cancel-admin' })
    assert.equal(cancelled.paymentStatus, 'refunded')
    await mutateBookingOccupancy(String(booking._id), admin, { kind: 'delete' })
    assert.equal(await Booking.countDocuments({}), 0)
    assert.ok((await Facility.findById(facilityId).select('+occupancyRevision'))!.occupancyRevision >= 7)
  })

  test('real expiration excludes paid-pending and confirmed overdue bookings, honors batch limits', async () => {
    const overdue = new Date(Date.now() - 60000)
    await Booking.create([
      { ...bookingData(), paymentStatus: 'paid', expiresAt: overdue },
      { ...bookingData('11:00', '12:00'), status: 'confirmed', expiresAt: overdue },
      { ...bookingData('12:00', '13:00'), expiresAt: overdue },
      { ...bookingData('13:00', '14:00'), expiresAt: overdue },
    ])
    assert.equal(await expirePendingBookings(new Date(), 1), 1)
    assert.equal(await Booking.countDocuments({ status: 'expired' }), 1)
    assert.equal(await expirePendingBookings(new Date(), 1), 1)
    assert.equal(await expirePendingBookings(new Date(), 1), 0)
    assert.equal(await Booking.countDocuments({ status: 'pending', paymentStatus: 'paid' }), 1)
    assert.equal(await Booking.countDocuments({ status: 'confirmed' }), 1)
  })

  test('a failed expiration transaction reports partial commits and rolls back its guard', async () => {
    const now = new Date()
    await Booking.create([
      { ...bookingData(), expiresAt: new Date(now.getTime() - 2000) },
      { ...bookingData('12:00', '13:00'), expiresAt: new Date(now.getTime() - 1000), facility: new mongoose.Types.ObjectId() },
    ])
    await assert.rejects(expirePendingBookings(now), (error: unknown) => error instanceof ExpirationBatchError && error.completedCount === 1)
    assert.equal(await Booking.countDocuments({ status: 'expired' }), 1)
    assert.equal(await Booking.countDocuments({ status: 'pending' }), 1)
    assert.equal((await Facility.findById(facilityId).select('+occupancyRevision'))!.occupancyRevision, 1)
  })

  test('previous-day legacy overnight booking conflicts with next-day maintenance', async () => {
    await Booking.create({ ...bookingData('23:00', '01:00'), date: dhakaDateStart('2099-05-31') })
    await assert.rejects(createMaintenanceBlock(String(facilityId), manager, blockData('00:30', '01:30')), rejectsWith(409))
    await createMaintenanceBlock(String(facilityId), manager, blockData('01:00', '02:00'))
  })

  test('concurrent booking vs block, overlapping blocks, and overlapping bookings have one winner', async () => {
    for (let round = 0; round < 5; round++) {
      await Booking.deleteMany({})
      await MaintenanceBlock.deleteMany({})
      assertSingleWinner(await Promise.allSettled([
        createGuardedBooking(bookingData(), customer),
        createMaintenanceBlock(String(facilityId), manager, blockData('10:30', '11:30')),
      ]))
    }
    await Booking.deleteMany({})
    await MaintenanceBlock.deleteMany({})
    assertSingleWinner(await Promise.allSettled([
      createMaintenanceBlock(String(facilityId), admin, blockData()),
      createMaintenanceBlock(String(facilityId), manager, blockData('10:30', '11:30')),
    ]))
    await MaintenanceBlock.deleteMany({})
    assertSingleWinner(await Promise.allSettled([
      createGuardedBooking(bookingData(), customer),
      createGuardedBooking(bookingData('10:30', '11:30'), customer),
    ]))
  })

  test('concurrent adjacent blocks both commit', async () => {
    const results = await Promise.all([
      createMaintenanceBlock(String(facilityId), admin, blockData()),
      createMaintenanceBlock(String(facilityId), manager, blockData('11:00', '12:00')),
    ])
    assert.equal(results.length, 2)
  })

  test('concurrent reactivation vs maintenance has one winner', async () => {
    const booking = await Booking.create({ ...bookingData(), status: 'cancelled' })
    assertSingleWinner(await Promise.allSettled([
      mutateBookingOccupancy(String(booking._id), admin, { kind: 'status', status: 'pending' }),
      createMaintenanceBlock(String(facilityId), manager, blockData()),
    ]))
  })

  test('concurrent cancellation or deletion vs maintenance cannot leave active overlaps', async () => {
    for (const kind of ['cancel-admin', 'delete'] as const) {
      await Booking.deleteMany({})
      await MaintenanceBlock.deleteMany({})
      const booking = await createGuardedBooking(bookingData(), customer)
      const results = await Promise.allSettled([
        mutateBookingOccupancy(String(booking._id), admin, { kind }),
        createMaintenanceBlock(String(facilityId), manager, blockData()),
      ])
      assert.equal(results[0].status, 'fulfilled')
      if (results[1].status === 'fulfilled')
        assert.equal(await Booking.countDocuments({ status: { $in: ['pending', 'confirmed'] } }), 0)
      else
        assert.equal((results[1] as PromiseRejectedResult).reason.statusCode, 409)
    }
  })

  test('concurrent expiration vs payment approval preserves the final paid booking', async () => {
    const booking = await Booking.create({ ...bookingData(), expiresAt: new Date(Date.now() - 1000) })
    await Promise.all([
      expirePendingBookings(new Date()),
      mutateBookingOccupancy(String(booking._id), admin, { kind: 'approve' }),
    ])
    const final = await Booking.findById(booking._id)
    assert.equal(final!.status, 'confirmed')
    assert.equal(final!.paymentStatus, 'paid')
    assert.equal(final!.expiresAt, undefined)
  })

  test('real write conflict retries the losing callback on a fresh snapshot', async () => {
    let entered!: () => void
    let finish!: () => void
    const hasEntered = new Promise<void>((resolve) => {
      entered = resolve
    })
    const canFinish = new Promise<void>((resolve) => {
      finish = resolve
    })
    const holding = withFacilityOccupancyGuard(facilityId, turfId, async () => {
      entered()
      await canFinish
    })
    await hasEntered
    const losingSession = await mongoose.startSession()
    let attempts = 0
    let conflictObserved!: () => void
    const sawConflict = new Promise<void>((resolve) => {
      conflictObserved = resolve
    })
    try {
      const competing = losingSession.withTransaction(async () => {
        attempts++
        try {
          await Facility.updateOne({ _id: facilityId }, { $inc: { occupancyRevision: 1 } }, { session: losingSession })
        }
        catch (error) {
          conflictObserved()
          throw error
        }
      })
      await sawConflict
      finish()
      await holding
      await competing
      assert.ok(attempts >= 2)
      assert.equal((await Facility.findById(facilityId).select('+occupancyRevision'))!.occupancyRevision, 2)
    }
    finally {
      finish()
      await losingSession.endSession()
    }
  })

  test('facility hard deletion cannot orphan maintenance history', async () => {
    await createMaintenanceBlock(String(facilityId), manager, blockData())
    await assert.rejects(deleteFacility(String(facilityId), true), /maintenance history/)
    assert.ok(await Facility.findById(facilityId))
  })

  test('concurrent facility deletion vs maintenance creation cannot create an orphan', async () => {
    const results = await Promise.allSettled([
      createMaintenanceBlock(String(facilityId), manager, blockData()),
      deleteFacility(String(facilityId), true),
    ])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    const facility = await Facility.findById(facilityId)
    assert.equal(await MaintenanceBlock.countDocuments({}), facility ? 1 : 0)
  })
})
