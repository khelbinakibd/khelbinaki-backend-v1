import nodemailer from 'nodemailer'
import { Resend } from 'resend'
import { env } from '../config/env'
import { logger } from './logger'

interface MailOptions {
  to: string
  subject: string
  html: string
  from?: string
}

// Mailgun support removed

// Initialize Resend client for production (with free testing domain)
let resendClient: Resend | null = null

if (env.EMAIL_SERVICE === 'resend') {
  if (!env.RESEND_API_KEY) {
    logger.error('❌ RESEND_API_KEY is required when EMAIL_SERVICE is "resend"')
    throw new Error('RESEND_API_KEY is required when EMAIL_SERVICE is set to "resend"')
  }
  try {
    resendClient = new Resend(env.RESEND_API_KEY)
    logger.info('✅ Resend email service initialized')
  }
  catch (error: any) {
    logger.error('❌ Failed to initialize Resend:', error.message)
    throw error
  }
}

// Initialize Nodemailer transporter for development (MailHog, Mailtrap, etc.)
let nodemailerTransporter: nodemailer.Transporter | null = null
if (env.EMAIL_SERVICE === 'nodemailer' || !env.EMAIL_SERVICE) {
  nodemailerTransporter = nodemailer.createTransport({
    host: env.EMAIL_HOST,
    port: env.EMAIL_PORT,
    secure: env.EMAIL_PORT === 465,
    auth: env.EMAIL_USER && env.EMAIL_PASSWORD
      ? {
          user: env.EMAIL_USER,
          pass: env.EMAIL_PASSWORD,
        }
      : undefined,
    ignoreTLS: env.EMAIL_HOST === 'localhost' || env.EMAIL_HOST === '127.0.0.1',
    requireTLS: false,
  })
  logger.info(`✅ Nodemailer email service initialized (${env.EMAIL_HOST}:${env.EMAIL_PORT})`)
}

/**
 * Send email using Resend (production) or Nodemailer (development)
 * Automatically selects the service based on EMAIL_SERVICE environment variable
 *
 * Enhanced with comprehensive logging for production debugging
 */
export async function sendEmail(options: MailOptions) {
  const from = options.from || env.EMAIL_FROM
  const emailService = env.EMAIL_SERVICE || 'nodemailer'

  // Log email attempt for debugging
  logger.debug('📧 Email send attempt', {
    to: options.to,
    subject: options.subject,
    service: emailService,
    from,
  })

  try {
    // Use Resend for production
    if (emailService === 'resend') {
      // Validate Resend client
      if (!resendClient) {
        const errorMsg = '❌ Resend client not initialized. Check RESEND_API_KEY environment variable.'
        logger.error(errorMsg)
        throw new Error(errorMsg)
      }

      // Validate API key exists
      if (!env.RESEND_API_KEY) {
        const errorMsg = '❌ RESEND_API_KEY environment variable not set'
        logger.error(errorMsg)
        throw new Error(errorMsg)
      }

      // Use onboarding@resend.dev for testing (works without domain verification)
      const resendFrom = from.includes('@resend.dev') ? from : 'Khelbi Naki BD <onboarding@resend.dev>'

      logger.info('📤 Sending email via Resend...', {
        to: options.to,
        from: resendFrom,
        subject: options.subject,
      })

      const result = await resendClient.emails.send({
        from: resendFrom,
        to: options.to,
        subject: options.subject,
        html: options.html,
      })

      // Check for API errors
      if (result.error) {
        const errorMsg = `Resend API error: ${result.error.message}`
        logger.error(`❌ ${errorMsg}`, {
          error: result.error,
          to: options.to,
          resendApiKeySet: !!env.RESEND_API_KEY,
          apiKeyPrefix: env.RESEND_API_KEY?.substring(0, 10),
        })
        throw new Error(errorMsg)
      }

      // Success
      logger.info(`✅ Email successfully sent via Resend`, {
        to: options.to,
        messageId: result.data?.id,
        subject: options.subject,
      })

      return {
        success: true,
        messageId: result.data?.id,
        service: 'resend',
      }
    }

    // Mailgun path removed

    // Use Nodemailer for development (MailHog, Mailtrap, etc.)
    if (!nodemailerTransporter) {
      const errorMsg = '❌ Nodemailer transporter not initialized. Check EMAIL_HOST and EMAIL_PORT.'
      logger.error(errorMsg)
      throw new Error(errorMsg)
    }

    logger.info('📤 Sending email via Nodemailer...', {
      to: options.to,
      host: env.EMAIL_HOST,
      port: env.EMAIL_PORT,
      subject: options.subject,
    })

    const info = await nodemailerTransporter.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
    })

    logger.info(`✅ Email successfully sent via Nodemailer`, {
      to: options.to,
      messageId: info.messageId,
      subject: options.subject,
      response: info.response,
    })

    return {
      success: true,
      messageId: info.messageId,
      service: 'nodemailer',
    }
  }
  catch (error: any) {
    // Comprehensive error logging for debugging production issues
    const errorDetails = {
      timestamp: new Date().toISOString(),
      service: emailService,
      to: options.to,
      subject: options.subject,
      errorMessage: error?.message || String(error),
      errorCode: error?.code,
      errorStack: error?.stack,
      // Environment info for debugging
      nodeEnv: process.env.NODE_ENV,
      emailServiceSet: !!env.EMAIL_SERVICE,
      resendKeySet: !!env.RESEND_API_KEY,
      emailFromSet: !!env.EMAIL_FROM,
    }

    logger.error('❌ Email sending failed with error', errorDetails)

    // Re-throw so controller can handle it
    throw new Error(
      `Email service failed: ${error?.message || 'Unknown error'}. `
      + `Service: ${emailService}. `
      + `To: ${options.to}`,
    )
  }
}

/**
 * Verify email service connection (useful for health checks)
 */
export async function verifyEmailConnection(): Promise<boolean> {
  try {
    if (env.EMAIL_SERVICE === 'resend') {
      if (!resendClient) {
        logger.warn('Resend client not initialized')
        return false
      }
      logger.info('Resend client is initialized and ready')
      return true
    }
    // Mailgun verification removed

    if (!nodemailerTransporter) {
      logger.warn('Nodemailer transporter not initialized')
      return false
    }

    await nodemailerTransporter.verify()
    logger.info('Nodemailer connection verified successfully')
    return true
  }
  catch (error: any) {
    logger.error('Email service verification failed', {
      error: error.message,
      service: env.EMAIL_SERVICE,
    })
    return false
  }
}
