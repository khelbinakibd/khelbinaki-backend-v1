import { Booking } from '../models/Booking'
import AppError from '../utils/AppError'
import { withFacilityOccupancyGuard } from './facilityOccupancyGuard'

// Keep the existing explicit-deadline cleanup semantics. No deadline is inferred
// from createdAt, booking date, or Asia/Dhaka wall-clock time.
export const DEFAULT_EXPIRATION_BATCH_LIMIT = 100
export const MAX_EXPIRATION_BATCH_LIMIT = 1000

export class ExpirationBatchError extends Error {
  constructor(
    readonly completedCount: number,
    readonly candidateCount: number,
    readonly batchLimit: number,
    readonly cause: unknown,
  ) {
    super('Expiration batch stopped after a transaction failure; previously committed transitions remain committed')
    this.name = 'ExpirationBatchError'
  }
}

export function expiredPendingBookingFilter(now: Date) {
  if (Number.isNaN(now.getTime()))
    throw new RangeError('Invalid expiration cutoff')

  return { status: 'pending', paymentStatus: { $ne: 'paid' }, expiresAt: { $type: 'date', $lt: now } }
}

/** Prerequisite implementation; intentionally not scheduled by startup.
 * Until BUG-08 guards every writer, invoke only with all other booking writers
 * stopped. Refuse MongoDB TTL deletion rather than claiming it is guarded.
 */
export async function expirePendingBookings(now = new Date(), batchSize = DEFAULT_EXPIRATION_BATCH_LIMIT): Promise<number> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_EXPIRATION_BATCH_LIMIT)
    throw new RangeError('Expiration batch size must be between 1 and 1000')

  const filter = expiredPendingBookingFilter(now)
  // Temporary prerequisite gate. BUG-08 may remove it only after ALL live
  // occupancy writers share withFacilityOccupancyGuard. Do not schedule yet.
  if (process.env.BOOKING_EXPIRATION_OFFLINE_ACK !== 'all-other-writers-stopped-and-access-disabled') {
    throw new AppError('Booking expiration currently requires offline operation with all other booking writers stopped and their database access disabled', 503)
  }
  const indexes = await Booking.collection.listIndexes().toArray()
  if (indexes.some(index => index.expireAfterSeconds !== undefined)) {
    throw new AppError('Booking expiration is disabled until Booking TTL indexes are removed using the migration runbook', 503)
  }

  const candidates = await Booking.find(filter)
    .select('_id facility turf')
    .sort({ expiresAt: 1, _id: 1 })
    .limit(batchSize)
    .lean()

  // Validate the whole batch before any write. Never expire a booking outside
  // the Facility guard if it lacks a facility (legacy data must be repaired offline).
  if (candidates.some(booking => !booking.facility || !booking.turf)) {
    throw new AppError('Cannot expire legacy bookings without a facility and turf; run the offline migration first', 409)
  }

  let count = 0
  for (const booking of candidates) {
    try {
      const modified = await withFacilityOccupancyGuard(booking.facility, booking.turf, async (session) => {
        // Recheck status, payment, deadline and facility after acquiring the guard.
        const result = await Booking.updateOne(
          { _id: booking._id, facility: booking.facility, turf: booking.turf, ...filter },
          { $set: { status: 'expired', expiredAt: now } },
          { session, runValidators: true },
        )
        return result.modifiedCount
      })
      count += modified
    }
    catch (cause) {
      throw new ExpirationBatchError(count, candidates.length, batchSize, cause)
    }
  }
  return count
}
