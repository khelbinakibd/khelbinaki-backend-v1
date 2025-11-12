import type { NextFunction, Request, Response } from 'express'
import { verifyAccessToken } from '../utils/jwt'

export interface AuthRequest extends Request {
  user?: { id: string, role: 'user' | 'admin' | 'manager' }
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  // Try to get token from multiple sources (prioritize cookies for security)
  let token = req.cookies?.accessToken

  // Fallback to Authorization header if no cookie (for API clients)
  if (!token) {
    const auth = req.headers.authorization
    token = auth?.startsWith('Bearer ') ? auth.split(' ')[1] : undefined
  }

  if (!token) {
    return res.status(401).json({
      message: 'Access token required',
      error: 'UNAUTHORIZED',
    })
  }

  try {
    const payload = verifyAccessToken(token) as { id?: string, role?: string }
    if (!payload?.id || !payload?.role) {
      return res.status(401).json({
        message: 'Invalid token payload',
        error: 'INVALID_TOKEN',
      })
    }

    req.user = { id: String(payload.id), role: payload.role as any }
    next()
  }
  catch (error: any) {
    // Check if token is expired vs invalid
    const isExpired = error.message?.includes('expired') || error.name === 'TokenExpiredError'

    return res.status(401).json({
      message: isExpired ? 'Access token expired' : 'Invalid access token',
      error: isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
    })
  }
}

// Optional middleware for routes that may have authenticated users but don't require it
export function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  let token = req.cookies?.accessToken

  if (!token) {
    const auth = req.headers.authorization
    token = auth?.startsWith('Bearer ') ? auth.split(' ')[1] : undefined
  }

  if (token) {
    try {
      const payload = verifyAccessToken(token) as { id?: string, role?: string }
      if (payload?.id && payload?.role) {
        req.user = { id: String(payload.id), role: payload.role as any }
      }
    }
    catch (error) {
      // Silently ignore auth errors for optional auth
      console.warn('Optional auth failed:', error)
    }
  }

  next()
}
