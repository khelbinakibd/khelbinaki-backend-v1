import type { Server } from 'node:http'
import mongoose from 'mongoose'
import app from './app'
import { env } from './config/env'
import connectDB from './lib/db'
import { seedAll } from './lib/seed'
import { startPeriodicCleanup } from './services/cleanupServices'
import AppError from './utils/AppError'
import { logger } from './utils/logger'
import { verifyEmailConnection } from './utils/sendEmail'

let server: Server

async function validateSecrets() {
  const minLength = 32
  if (env.JWT_SECRET.length < minLength || env.JWT_REFRESH_SECRET.length < minLength) {
    logger.error('Security Alert: JWT secrets are too short!')
    throw new AppError('Insecure JWT secrets. Please provide secretes of at least 32 character', 500)
  }
  logger.info('JWT secrets security check passed')
}

async function validateEmailService() {
  logger.info(`📧 Email Service: ${env.EMAIL_SERVICE}`)

  if (env.EMAIL_SERVICE === 'nodemailer') {
    logger.info(`📬 SMTP Server: ${env.EMAIL_HOST}:${env.EMAIL_PORT}`)
    if (env.EMAIL_HOST === 'localhost' || env.EMAIL_HOST === '127.0.0.1') {
      logger.info('💡 Using local email server (MailHog). Make sure it\'s running on port 1025')
    }
  }

  // Verify connection (non-critical, just for info)
  try {
    const isConnected = await verifyEmailConnection()
    if (isConnected) {
      logger.info('✅ Email service connection verified')
    }
    else {
      logger.warn('⚠️  Email service verification failed. Emails might not send correctly.')
    }
  }
  catch (error) {
    logger.warn('⚠️  Could not verify email service connection:', error)
  }
}

async function start() {
  try {
    await validateSecrets()
    await validateEmailService()
    await connectDB() // ensure DB is ready before accepting requests

    // Seed database with initial data (manager, turfs, sample users)
    await seedAll()

    // Start periodic cleanup (optional)
    if (process.env.NODE_ENV === 'production') {
      startPeriodicCleanup()
    }
    server = app.listen(env.PORT, () => {
      logger.info(`🚀 Server running at http://localhost:${env.PORT}`)
      logger.info(`📊 Environment: ${env.NODE_ENV}`)
    })
  }
  catch (err) {
    logger.error('❌ Failed to start server:', err)
    process.exit(1)
  }
}

/**
 * Graceful shutdown handler
 * Closes server connections and database properly before exit
 */
async function gracefulShutdown(signal: string) {
  logger.info(`\n${signal} signal received: closing HTTP server gracefully`)

  if (server) {
    server.close(async () => {
      logger.info('✅ HTTP server closed')

      try {
        // Close database connections
        await mongoose.connection.close()
        logger.info('✅ MongoDB connection closed')

        logger.info('✨ Graceful shutdown completed')
        process.exit(0)
      }
      catch (err) {
        logger.error('❌ Error during graceful shutdown:', err)
        process.exit(1)
      }
    })

    // Force close after 30 seconds
    setTimeout(() => {
      logger.error('⚠️  Forced shutdown after timeout')
      process.exit(1)
    }, 30000)
  }
  else {
    process.exit(0)
  }
}

// Handle graceful shutdown on various signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: any) => {
  logger.error('❌ Unhandled Rejection:', reason)
  gracefulShutdown('UNHANDLED_REJECTION')
})

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  logger.error('❌ Uncaught Exception:', error)
  gracefulShutdown('UNCAUGHT_EXCEPTION')
})

start()
