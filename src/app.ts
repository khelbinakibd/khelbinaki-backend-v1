import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import mongoose from 'mongoose'
import morgan from 'morgan'
import { env } from './config/env'
import { requireAuth } from './middlewares/authMiddleware'
import { errorHandler, notFound } from './middlewares/errorHandler'
import { attachRequestId, requestLogger } from './middlewares/requestLogger'
import adminRouter from './routes/adminRoutes'
import authRouter from './routes/authRoutes'
import bookingRouter from './routes/bookingRoutes'
import facilityRouter from './routes/facilityRoutes'
import supportRouter from './routes/supportRoutes'
import turfRouter from './routes/turfRoutes'
import userRouter from './routes/userRoutes'

const app = express()

// Trust proxy (important for cookies in production behind reverse proxy)
app.set('trust proxy', 1)

// Middlewares
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

//  Configure cookie parser properly
app.use(cookieParser())

// Enhanced CORS configuration for cookies
const corsOptions = {
  origin(origin: string | undefined, callback: (error: Error | null, success?: boolean) => void) {
    if (!origin) {
      return callback(null, true)
    }

    const allowedOrigins = [
      env.CLIENT_URL,
      env.SERVER_URL,
      env.PUBLIC_URL,
      'https://www.khelbinakibd.com',
      'http://localhost:5173',

    ].filter(Boolean)

    // Allow any localhost in development
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true)
    }

    // Allow ngrok/localtunnel in development
    if (env.NODE_ENV !== 'production' && (origin.includes('ngrok') || origin.includes('loca.lt'))) {
      return callback(null, true)
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true)
    }
    else {
      console.warn(`❌ CORS blocked origin: ${origin}`)
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true, // Essential for cookies
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Cache-Control',
    'X-File-Name',
  ],
  exposedHeaders: ['Set-Cookie'],
  preflightContinue: false,
  optionsSuccessStatus: 204,
}

app.use(cors(corsOptions))

// Request logging with unique IDs (production-ready)
if (env.NODE_ENV === 'production') {
  app.use(requestLogger)
  app.use(attachRequestId)
}

// FIXED: Enhanced helmet configuration
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ['\'self\''],
      styleSrc: ['\'self\'', '\'unsafe-inline\''],
      scriptSrc: ['\'self\''],
      imgSrc: ['\'self\'', 'data:', 'https:'],
      connectSrc: ['\'self\''],
    },
  },
  crossOriginEmbedderPolicy: false, // Disable for API
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}))

app.use(morgan('dev'))

// Cookies Logging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`, {
    cookies: req.cookies,
    origin: req.headers.origin,
  })
  next()
})

// Enhanced health check route for monitoring
app.get('/api/v1/health', async (_req, res) => {
  const dbState = mongoose.connection.readyState
  const dbStatusMap: Record<number, string> = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  }
  const dbStatus = dbStatusMap[dbState] || 'unknown'

  const health = {
    status: dbState === 1 ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: env.NODE_ENV,
    version: process.env.npm_package_version || '1.0.0',
    services: {
      database: {
        status: dbStatus,
        connected: dbState === 1,
      },
      email: {
        service: env.EMAIL_SERVICE,
        configured: true,
      },
    },
    memory: {
      used: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      total: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
    },
  }

  const statusCode = health.status === 'healthy' ? 200 : 503
  res.status(statusCode).json(health)
})

// API routes
app.get('/api/v1/protected', requireAuth, (req, res) => {
  res.json({
    message: 'You are authenticated',
    data: {
      user: (req as any).user,
    },
  })
})

// Auth routes
app.use('/api/v1/auth', authRouter)
// User routes
app.use('/api/v1/users', userRouter)
// Turf routes
app.use('/api/v1/turfs', turfRouter)
// Facility routes
app.use('/api/v1', facilityRouter)
// Booking routes
app.use('/api/v1/bookings', bookingRouter)
// Support routes (contact, report)
app.use('/api/v1', supportRouter)
// Admin routes
app.use('/api/v1/admin', adminRouter)

// 404 + error handler
app.use(notFound)
app.use(errorHandler)

export default app
