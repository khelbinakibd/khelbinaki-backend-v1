import type { Request, Response } from 'express'
import crypto from 'node:crypto'
import { env } from '../config/env'
import { Otp } from '../models/Otp'
import { RefreshToken } from '../models/RefreshToken'
import { User } from '../models/User'
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyOtpSchema,
} from '../schemas/authSchema'
import AppError from '../utils/AppError'
import asyncHandler from '../utils/asyncHandler'
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt'
import { logger } from '../utils/logger'
import { sendEmail } from '../utils/sendEmail'

// Helper: set both access and refresh token cookies
function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  const isProduction = process.env.NODE_ENV === 'production'

  // Set access token cookie
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax', // 'none' for cross-origin in production, 'lax' for development
    maxAge: 60 * 60 * 1000, // 1 hour
    path: '/', // Make sure path is root
  })

  // Set refresh token cookie - FIXED: Remove specific path
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/', // Changed from '/api/v1/auth/refresh-token' to '/'
  })
}

// Helper: clear auth cookies
function clearAuthCookies(res: Response) {
  const isProduction = process.env.NODE_ENV === 'production'

  res.clearCookie('accessToken', {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
  })

  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
  })
}

// -------------------- REGISTER --------------------
export const register = asyncHandler(async (req: Request, res: Response) => {
  const { name, email, password, phone } = registerSchema.parse(req.body)

  let user = await User.findOne({ email })

  if (user) {
    if (user.isVerified) {
      throw new AppError('This email is already registered and verified.', 409)
    }
    // Update unverified user's info if provided
    user.name = name ?? user.name
    user.phone = phone ?? user.phone
    if (password)
      user.password = password
    await user.save()
  }
  else {
    user = await User.create({ name, email, password, phone })
  }

  // Generate OTP
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString()
  await Otp.findOneAndUpdate(
    { email },
    { otp: otpCode, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )

  // Send OTP via email
  try {
    await sendEmail({
      to: email,
      subject: 'Your verification code',
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; padding: 20px;">
          <h1>Welcome to Khelbi Naki!</h1>
          <p>Your One-Time Password (OTP) for email verification is:</p>
          <h2 style="background: #f4f4f4; padding: 10px; text-align: center; border-radius: 5px;">${otpCode}</h2>
          <p>This code will expire in 10 minutes.</p>
          <p>If you didn't request this, please ignore this email.</p>
        </div>
      `,
    })
  }
  catch (emailError: any) {
    const errorMsg = emailError?.message || String(emailError)
    logger.error('❌ OTP Email sending failed', {
      error: errorMsg,
      errorObj: emailError,
      email,
      service: env.EMAIL_SERVICE,
    })
    // In development with MailHog, continue anyway
    // In production, throw error with diagnostic info
    if (process.env.NODE_ENV === 'production') {
      throw new AppError(`Email service error: ${errorMsg}`, 500)
    }
  }

  res.status(201).json({
    message: 'User created/updated. OTP sent to email for verification.',
    data: {
      email: user.email,
    },
  })
})

// -------------------- VERIFY OTP --------------------
export const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const { email, otp } = verifyOtpSchema.parse(req.body)

  const otpEntry = await Otp.findOne({ email, otp })
  if (!otpEntry)
    throw new AppError('Invalid OTP', 400)
  if (otpEntry.expiresAt.getTime() < Date.now()) {
    await Otp.deleteOne({ _id: otpEntry._id })
    throw new AppError('OTP expired', 400)
  }

  const user = await User.findOne({ email })
  if (!user)
    throw new AppError('User not found', 404)

  user.isVerified = true
  await user.save()
  await Otp.deleteOne({ _id: otpEntry._id })

  // Issue tokens
  const accessToken = signAccessToken({ id: user._id, role: user.role })
  const refreshToken = signRefreshToken({ id: user._id, role: user.role })

  await RefreshToken.create({
    user: user._id,
    token: refreshToken,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  })

  setAuthCookies(res, accessToken, refreshToken)

  res.status(200).json({
    message: 'Email verified successfully. You are now logged in.',
    data: {
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
      accessToken,
      refreshToken,
    },
  })
})

// -------------------- LOGIN --------------------
export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = loginSchema.parse(req.body)

  const user = await User.findOne({ email }).select('+password')
  if (!user || !(await user.comparePassword(password)))
    throw new AppError('Incorrect email or password', 401)
  if (!user.isVerified)
    throw new AppError('Email not verified. Please check your email for the OTP.', 403)
  if (!user.isActive)
    throw new AppError('Your account has been deactivated. Please contact support.', 403)

  // Clean up any existing refresh tokens for this user (optional security measure)
  await RefreshToken.deleteMany({ user: user._id })

  const accessToken = signAccessToken({ id: user._id, role: user.role })
  const refreshToken = signRefreshToken({ id: user._id, role: user.role })

  await RefreshToken.create({
    user: user._id,
    token: refreshToken,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  })

  setAuthCookies(res, accessToken, refreshToken)

  res.status(200).json({
    message: 'Login successful',
    data: {
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
      accessToken,
      refreshToken,
    },
  })
})

// -------------------- REFRESH TOKEN --------------------
export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  // FIXED: Check both cookies and body for refresh token
  const cookieToken = req.cookies?.refreshToken
  const bodyToken = req.body?.refreshToken
  const token = cookieToken || bodyToken

  if (!token) {
    throw new AppError('Refresh token required', 400)
  }

  let payload: any
  try {
    payload = verifyRefreshToken(token)
  }
  catch {
    throw new AppError('Invalid refresh token', 401)
  }

  const storedToken = await RefreshToken.findOne({ token })
  if (!storedToken) {
    throw new AppError('Invalid refresh token', 401)
  }

  // Verify the user still exists and is active
  const user = await User.findById(payload.id)
  if (!user || !user.isActive) {
    await storedToken.deleteOne()
    throw new AppError('User not found or inactive', 401)
  }

  // Rotate token
  await storedToken.deleteOne()
  const newRefreshToken = signRefreshToken({ id: payload.id, role: payload.role })
  const newAccessToken = signAccessToken({ id: payload.id, role: payload.role })

  await RefreshToken.create({
    user: payload.id,
    token: newRefreshToken,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  })

  setAuthCookies(res, newAccessToken, newRefreshToken)

  res.json({
    message: 'Tokens refreshed successfully',
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  })
})

// -------------------- FORGOT PASSWORD --------------------
export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email } = forgotPasswordSchema.parse(req.body)
  const user = await User.findOne({ email })
  if (!user)
    return res.json({ message: 'If the email is in our system, a password reset link has been sent.' })

  const resetToken = user.createPasswordResetToken()
  await user.save({ validateBeforeSave: false })

  try {
    await sendEmail({
      to: user.email,
      subject: 'Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; padding: 20px;">
          <h1>Password Reset Request</h1>
          <p>You are receiving this because you (or someone else) have requested the reset of the password for your account.</p>
          <p>Please click on the following link to reset your password:</p>
          <p><a href="${env.CLIENT_URL}/reset-password/${resetToken}" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Password</a></p>
          <p>If you did not request this, please ignore this email and your password will remain unchanged.</p>
          <p>This link will expire in 10 minutes.</p>
        </div>
      `,
    })
  }
  catch (emailError) {
    user.passwordResetToken = undefined
    user.passwordResetExpires = undefined
    await user.save({ validateBeforeSave: false })
    logger.error('Password reset email failed', { error: emailError })
    throw new AppError('There was an error sending the email. Try again later.', 500)
  }

  res.json({ message: 'If the email is in our system, a password reset link has been sent.' })
})

// -------------------- RESET PASSWORD --------------------
export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { password } = resetPasswordSchema.parse(req.body)
  const token = req.params.token

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex')
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  })
  if (!user)
    throw new AppError('Token is invalid or has expired', 400)

  user.password = password
  user.passwordResetToken = undefined
  user.passwordResetExpires = undefined
  await user.save()

  // Clean up any existing refresh tokens for this user
  await RefreshToken.deleteMany({ user: user._id })

  const accessToken = signAccessToken({ id: user._id, role: user.role })
  const refreshToken = signRefreshToken({ id: user._id, role: user.role })

  await RefreshToken.create({
    user: user._id,
    token: refreshToken,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  })

  setAuthCookies(res, accessToken, refreshToken)

  res.json({
    message: 'Password reset successfully.',
    user: { id: user._id, name: user.name, email: user.email, role: user.role },
    accessToken,
    refreshToken,
  })
})

// -------------------- LOGOUT --------------------
export const logout = asyncHandler(async (req: Request, res: Response) => {
  // Try to get refresh token from cookies or body
  const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken

  if (refreshToken) {
    try {
      await RefreshToken.deleteOne({ token: refreshToken })
    }
    catch (error) {
      logger.error('Error deleting refresh token', { error })
    }
  }

  clearAuthCookies(res)

  res.status(200).json({ message: 'Logout successfully' })
})
