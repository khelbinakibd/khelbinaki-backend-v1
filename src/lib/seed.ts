import { env } from '../config/env'
import { User } from '../models/User'
import { logger } from '../utils/logger'

/**
 * Checks if a super admin (manager) exists and creates one if not.
 */
export async function seedSuperAdmin() {
  try {
    const { MANAGER_EMAIL, MANAGER_PASSWORD, MANAGER_NAME } = env
    if (!MANAGER_EMAIL || !MANAGER_PASSWORD || !MANAGER_NAME) {
      logger.warn('Manager account credentials not found in .env. Skipping super admin seeding.')
      return null
    }

    const existingManager = await User.findOne({ role: 'manager' })
    if (existingManager) {
      logger.info('Manager account already exists')
      return existingManager
    }

    const manager = await User.create({
      name: MANAGER_NAME,
      email: MANAGER_EMAIL,
      password: MANAGER_PASSWORD,
      role: 'manager',
      isVerified: true,
      isActive: true,
    })

    logger.info(`Super admin account created successfully: ${manager.email}`)
    return manager
  }
  catch (error: any) {
    logger.error('Error during super admin seeding', {
      error: error.message,
      stack: error.stack,
    })
    return null
  }
}

/**
 * Master seed function - runs super admin seeding only
 */
export async function seedAll() {
  try {
    logger.info('🌱 Starting database seeding...')

    // Seed manager (super admin) only
    const manager = await seedSuperAdmin()
    if (!manager) {
      logger.warn('⚠️  Manager seeding skipped or failed.')
    }
    else {
      logger.info('✅ Database seeding completed successfully')
    }
  }
  catch (error: any) {
    logger.error('❌ Database seeding failed', {
      error: error.message,
      stack: error.stack,
    })
    throw error
  }
}
