// Optional service to clean up expired data

import { DEFAULT_EXPIRATION_BATCH_LIMIT, ExpirationBatchError, expirePendingBookings } from './bookingExpirationService'
import { Otp } from '../models/Otp'
import { RefreshToken } from '../models/RefreshToken'
import { logger } from '../utils/logger'

/**
 * Clean up expired OTP entries and refresh tokens
 * Should be run periodically (e.g., via cron job or scheduled task)
 */
export async function cleanupExpiredData() {
  try {
    // Clean up expired OTPs
    const expiredOtps = await Otp.deleteMany({
      expiresAt: { $lt: new Date() },
    })

    // Clean up expired refresh tokens
    const expiredTokens = await RefreshToken.deleteMany({
      expiresAt: { $lt: new Date() },
    })

    logger.info('Cleanup completed', {
      otpsDeleted: expiredOtps.deletedCount,
      tokensDeleted: expiredTokens.deletedCount,
    })

    return {
      otpsDeleted: expiredOtps.deletedCount,
      tokensDeleted: expiredTokens.deletedCount,
    }
  }
  catch (error) {
    logger.error('Error during cleanup', { error })
    throw error
  }
}

/**
 * Start periodic cleanup (call this in your main app startup)
 */
export function startPeriodicCleanup() {
  // Run cleanup every hour
  setInterval(async () => {
    await cleanupExpiredData()
  }, 60 * 60 * 1000) // 1 hour

  logger.info('Periodic cleanup scheduled every hour')
}

/** One bounded batch, not a complete sweep. Returns committed transitions.
 * Call repeatedly to drain a backlog; ExpirationBatchError reports partial progress.
 * Offline-only until the TTL migration and all BUG-08 occupancy guards are deployed.
 */
export async function cleanupExpiredBookings(batchLimit = DEFAULT_EXPIRATION_BATCH_LIMIT) {
  try {
    const count = await expirePendingBookings(new Date(), batchLimit)
    logger.info('Completed one booking expiration batch', { count, batchLimit })
    return count
  }
  catch (error) {
    logger.error('Error during booking cleanup', error instanceof ExpirationBatchError
      ? { completedCount: error.completedCount, candidateCount: error.candidateCount, batchLimit: error.batchLimit }
      : { errorType: error instanceof Error ? error.name : 'Unknown' })
    throw error
  }
}
