import type { NextFunction, Request, Response } from 'express'
import mongoose from 'mongoose'
import { ZodError } from 'zod'
import { env } from '../config/env'
import AppError from '../utils/AppError'
import { logger } from '../utils/logger'

// Not found handler
export function notFound(req: Request, res: Response) {
  const errorId = crypto.randomUUID()

  logger.warn('Route not found', {
    errorId,
    url: req.url,
    method: req.method,
    requestId: req.requestId,
  })

  res.status(404).json({
    success: false,
    message: 'Route not found',
    errorId,
  })
}

// Enhanced error handler with production safety
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const errorId = req.requestId || crypto.randomUUID()
  const isProduction = env.NODE_ENV === 'production'

  // Log with structured data (includes stack trace only in logs)
  logger.error('Application Error', {
    errorId,
    error: err,
    stack: err instanceof Error ? err.stack : undefined,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId: req.requestId,
  })

  // Zod validation errors
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      errorId,
      message: 'Validation failed',
      errors: err.issues.map(e => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    })
  }

  // Custom application errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      errorId,
      message: err.message,
      // Only include stack trace in development
      ...((!isProduction && err.stack) && { stack: err.stack }),
    })
  }

  // MongoDB errors
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({
      success: false,
      errorId,
      message: 'Database validation error',
      errors: Object.values(err.errors).map(e => ({
        field: e.path,
        message: e.message,
      })),
    })
  }

  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({
      success: false,
      errorId,
      message: 'Invalid ID format',
    })
  }

  // MongoDB duplicate key error
  if ((err as any).code === 11000) {
    const field = Object.keys((err as any).keyPattern)[0]
    return res.status(409).json({
      success: false,
      errorId,
      message: `Duplicate value for field: ${field}`,
    })
  }

  // Generic errors - hide details in production
  const message = isProduction
    ? 'Internal Server Error'
    : err instanceof Error
      ? err.message
      : 'An unexpected error occurred'

  return res.status(500).json({
    success: false,
    errorId,
    message,
    // Only include error details in development
    ...((!isProduction && err instanceof Error) && {
      error: err.message,
      stack: err.stack,
    }),
  })
}
