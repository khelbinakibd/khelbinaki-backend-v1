import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import AppError from './AppError'

export function signAccessToken(payload: object) {
  // @ts-expect-error - jwt types expect string | Buffer, but env.JWT_SECRET is defined
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN })
}

export function signRefreshToken(payload: object) {
  // @ts-expect-error - jwt types expect string | Buffer, but env.JWT_REFRESH_SECRET is defined
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: env.REFRESH_EXPIRES_IN })
}

export function verifyAccessToken(token: string): any {
  try {
    return jwt.verify(token, env.JWT_SECRET)
  }
  catch {
    throw new AppError('Invalid or expired token', 401)
  }
}

export function verifyRefreshToken(token: string): any {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET)
  }
  catch {
    throw new AppError('Invalid or expired refresh token', 401)
  }
}
