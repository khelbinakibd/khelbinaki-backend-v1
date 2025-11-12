// src/config/env.ts
import path from 'node:path'
import dotenv from 'dotenv'

// Only load .env files in development/local environments
// In production, use platform environment variables (Render, Railway, etc.)
if (process.env.NODE_ENV !== 'production') {
  const envFile = process.env.NODE_ENV === 'test'
    ? '.env.test'
    : '.env.development'

  dotenv.config({ path: path.resolve(process.cwd(), envFile) })

  // Load .env.local for local overrides (optional)
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
}

export const env = {
  // Basic Configuration
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT ?? 9000),

  // Database
  MONGODB_URI: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/turf_booking_dev',
  DB_MAX_POOL_SIZE: Number(process.env.DB_MAX_POOL_SIZE ?? 10),
  DB_MIN_POOL_SIZE: Number(process.env.DB_MIN_POOL_SIZE ?? 2),

  // URLs
  CLIENT_URL: process.env.CLIENT_URL ?? 'http://localhost:5173',
  SERVER_URL: process.env.SERVER_URL ?? 'http://localhost:9000',
  PUBLIC_URL: process.env.PUBLIC_URL,

  // JWT Configuration
  JWT_SECRET: process.env.JWT_SECRET!,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '1h',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET!,
  REFRESH_EXPIRES_IN: process.env.REFRESH_EXPIRES_IN ?? '7d',

  // Security
  BCRYPT_SALT_ROUND: Number(process.env.BCRYPT_SALT_ROUND ?? 10),
  SECURE_COOKIES: process.env.SECURE_COOKIES === 'true',
  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN,

  // CORS
  CORS_ORIGINS: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],

  // Email Configuration
  EMAIL_HOST: process.env.EMAIL_HOST || 'localhost',
  EMAIL_PORT: Number(process.env.EMAIL_PORT ?? 1025),
  EMAIL_USER: process.env.EMAIL_USER,
  EMAIL_PASSWORD: process.env.EMAIL_PASSWORD,
  EMAIL_FROM: process.env.EMAIL_FROM || 'Khelbi Naki BD <onboarding@resend.dev>',
  // AUTO-SELECT: Use Resend in production, nodemailer in development
  EMAIL_SERVICE: process.env.EMAIL_SERVICE || (process.env.NODE_ENV === 'production' ? 'resend' : 'nodemailer'),
  RESEND_API_KEY: process.env.RESEND_API_KEY,

  // Cloudinary
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,

  // Manager Account
  MANAGER_NAME: process.env.MANAGER_NAME || 'Super Admin',
  MANAGER_EMAIL: process.env.MANAGER_EMAIL || 'admin@example.com',
  MANAGER_PASSWORD: process.env.MANAGER_PASSWORD || 'defaultpassword',

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 900000),
  RATE_LIMIT_MAX_REQUESTS: Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 100),

  // Development/Debug
  DEBUG_MODE: process.env.DEBUG_MODE === 'true',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',

  // Performance
  COMPRESSION: process.env.COMPRESSION === 'true',
  CACHE_TTL: Number(process.env.CACHE_TTL ?? 3600),
}

// Enhanced production validation
if (process.env.NODE_ENV === 'production') {
  const requiredVars = [
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'MONGODB_URI',
    'CLIENT_URL',
    'SERVER_URL',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
    'MANAGER_EMAIL',
    'MANAGER_PASSWORD',
  ]

  if (env.EMAIL_SERVICE === 'resend' && !process.env.RESEND_API_KEY) {
    requiredVars.push('RESEND_API_KEY')
  }

  const missingVars = requiredVars.filter(varName => !process.env[varName])

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`)
  }

  // Validate JWT secrets length
  if (env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long in production')
  }
  if (env.JWT_REFRESH_SECRET.length < 32) {
    throw new Error('JWT_REFRESH_SECRET must be at least 32 characters long in production')
  }

  // Validate URLs use HTTPS in production
  if (!env.CLIENT_URL.startsWith('https://')) {
    console.warn('⚠️  CLIENT_URL should use HTTPS in production')
  }
  if (!env.SERVER_URL.startsWith('https://')) {
    console.warn('⚠️  SERVER_URL should use HTTPS in production')
  }

  console.log('✅ Production environment variables validated')
}

// Development warnings
if (process.env.NODE_ENV === 'development') {
  if (env.JWT_SECRET.includes('fallback')) {
    console.warn('⚠️  Using fallback JWT secrets. Set proper secrets in .env.development')
  }
}
