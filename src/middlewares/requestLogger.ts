import type { NextFunction, Request, Response } from 'express'
import { logger } from '../utils/logger'

// Extend Express Request type to include requestId
declare module 'express' {
  interface Request {
    requestId?: string
    startTime?: number
  }
}

/**
 * Request logging middleware with unique request IDs
 * Logs incoming requests and response times
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  // Generate unique request ID
  req.requestId = crypto.randomUUID()
  req.startTime = Date.now()

  // Log incoming request
  logger.info('Incoming Request', {
    requestId: req.requestId,
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  })

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - (req.startTime || Date.now())

    logger.info('Request Completed', {
      requestId: req.requestId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
    })
  })

  next()
}

/**
 * Attach request ID to response headers for debugging
 */
export function attachRequestId(req: Request, res: Response, next: NextFunction) {
  if (req.requestId) {
    res.setHeader('X-Request-ID', req.requestId)
  }
  next()
}
