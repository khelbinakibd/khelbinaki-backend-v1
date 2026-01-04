/**
 * Script to send welcome emails to users created via manual booking
 * TODO: When reactivating emails, run this script after setting EMAIL_ENABLED=true
 * TODO: When reactivating emails, verify EMAIL_ENABLED is true before running
 * TODO: When reactivating emails, test with a small batch first
 */
import mongoose from 'mongoose'
import { env } from '../src/config/env'
import { User } from '../src/models/User'
import { sendWelcomeEmail } from '../src/services/emailServices'
import { logger } from '../src/utils/logger'

async function sendWelcomeEmailsToExistingUsers() {
  try {
    // TODO: When reactivating emails, add check: if (!env.EMAIL_ENABLED) throw error

    // Connect to database
    await mongoose.connect(env.MONGODB_URI)
    logger.info('Connected to database')

    // Find users who need welcome emails
    // TODO: When reactivating emails, verify this query finds all intended users
    const usersToEmail = await User.find({
      createdViaManualBooking: true,
      welcomeEmailSent: false,
      isActive: true,
    })

    logger.info(`Found ${usersToEmail.length} users who need welcome emails`)

    // TODO: When reactivating emails, consider adding batch processing for large numbers
    // TODO: When reactivating emails, consider adding rate limiting to avoid email service limits

    let successCount = 0
    let errorCount = 0

    for (const user of usersToEmail) {
      try {
        await sendWelcomeEmail(user)
        successCount++
        logger.info(`✅ Welcome email sent to ${user.email}`)
      }
      catch (error: any) {
        errorCount++
        logger.error(`❌ Failed to send welcome email to ${user.email}:`, error.message)
      }
    }

    logger.info(`\n📊 Summary:`)
    logger.info(`✅ Successfully sent: ${successCount}`)
    logger.info(`❌ Failed: ${errorCount}`)
    logger.info(`📧 Total processed: ${usersToEmail.length}`)

    await mongoose.disconnect()
    process.exit(0)
  }
  catch (error: any) {
    logger.error('Script failed:', error)
    await mongoose.disconnect()
    process.exit(1)
  }
}

sendWelcomeEmailsToExistingUsers()

