import type { NextFunction, Request, Response } from 'express'
import { User } from '../models/User'
import { verifyAccessToken } from '../utils/jwt'

export interface AuthRequest extends Request {
  user?: { id: string, role: 'user' | 'admin' | 'manager' }
}

function accessToken(req: AuthRequest) {
  const auth = req.headers.authorization
  return req.cookies?.accessToken || (auth?.startsWith('Bearer ') ? auth.split(' ')[1] : undefined)
}

function verifiedUserId(token: string): string {
  const payload = verifyAccessToken(token) as { id?: unknown, role?: unknown }
  if (!payload?.role || typeof payload?.id !== 'string' || !/^[a-f\d]{24}$/i.test(payload.id))
    throw new Error('Invalid token payload')
  return payload.id
}

async function currentIdentity(id: string): Promise<AuthRequest['user']> {
  const user = await User.findById(id).select('_id role isActive').lean()
  if (!user || !user.isActive || !['user', 'admin', 'manager'].includes(user.role))
    return undefined
  return { id: user._id.toString(), role: user.role }
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  req.user = undefined
  const token = accessToken(req)
  if (!token)
    return res.status(401).json({ message: 'Access token required', error: 'UNAUTHORIZED' })

  let id: string
  try {
    id = verifiedUserId(token)
  }
  catch (error) {
    if (error instanceof Error && error.message === 'Invalid token payload')
      return res.status(401).json({ message: 'Invalid token payload', error: 'INVALID_TOKEN' })
    // Preserve the previous classification, including the JWT helper's
    // combined 'Invalid or expired token' verification error.
    const isExpired = error instanceof Error && (error.message.includes('expired') || error.name === 'TokenExpiredError')
    return res.status(401).json({
      message: isExpired ? 'Access token expired' : 'Invalid access token',
      error: isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
    })
  }

  // Database failures are server errors, never grounds to trust token claims.
  try {
    req.user = await currentIdentity(id)
  }
  catch (error) {
    return next(error)
  }
  if (!req.user)
    return res.status(401).json({ message: 'User not found or inactive', error: 'UNAUTHORIZED' })
  next()
}

export async function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  req.user = undefined
  const token = accessToken(req)
  if (!token)
    return next()
  let id: string
  try {
    id = verifiedUserId(token)
  }
  catch {
    return next()
  }
  try {
    req.user = await currentIdentity(id)
  }
  catch (error) {
    return next(error)
  }
  next()
}
