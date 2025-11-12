import { z } from 'zod'

const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/

// Register schema
export const registerSchema = z.object({
  name: z.string().min(2),
  email: z.email().lowercase(),
  password: z.string()
    .min(8, 'Password must be at least 8 characters long.')
    .regex(strongPasswordRegex, 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character.'),
  phone: z.string().min(11).max(14).optional(),
})

// Login schema
export const loginSchema = z.object({
  email: z.email().lowercase(),
  password: z.string().min(1, 'Password is required'),
})

// Forgot password schema
export const forgotPasswordSchema = z.object({
  email: z.email().lowercase(),
})

// Reset password schema
export const resetPasswordSchema = z.object({
  password: z.string()
    .min(8, 'Password must be at least 8 characters long.')
    .regex(strongPasswordRegex, 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character.'),
})

// OTP verification schema
export const verifyOtpSchema = z.object({
  email: z.email().lowercase(),
  otp: z.string().length(6),
})
