import type { ClientSession, Types } from 'mongoose'
import mongoose from 'mongoose'
import { Facility } from '../models/Facility'
import AppError from '../utils/AppError'

/** Acquire before reading occupancy. Use sequential operations in the callback.
 * MongoDB retries write conflicts with a fresh snapshot through withTransaction.
 * No external side effects may be performed inside the retryable callback.
 */
export async function withFacilityOccupancyGuard<T>(
  facilityId: Types.ObjectId,
  turfId: Types.ObjectId,
  operation: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await mongoose.startSession()
  try {
    return await session.withTransaction(async () => {
      const result = await Facility.updateOne(
        { _id: facilityId, turf: turfId },
        { $inc: { occupancyRevision: 1 } },
        { session },
      )
      if (result.matchedCount !== 1) {
        throw new AppError('Cannot change occupancy: facility is missing or belongs to another turf', 409)
      }
      return operation(session)
    }, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary',
    })
  }
  finally {
    await session.endSession()
  }
}
