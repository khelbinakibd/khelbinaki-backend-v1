import { z } from 'zod'

export const updateProfileSchema = z.object({
  name: z.string().min(2).trim().optional(),
  email: z.email().toLowerCase().optional(),
  phone: z.string().min(11).max(14).trim().optional(),
  address: z.string().trim().optional(),
  profilePicture: z.url().optional(),
})

export const createAdminSchema = z.object({
  name: z.string().min(2).trim(),
  email: z.email().toLowerCase(),
  password: z.string().min(6),
  phone: z.string().min(11).max(14).trim().optional(),
})

export const updateUserStatusSchema = z.object({
  isActive: z.boolean(),
})

export const updateUserSchema = z.object({
  name: z.string().min(2).trim().optional(),
  email: z.email().toLowerCase().optional(),
  phone: z.string().min(11).max(14).trim().optional(),
  role: z.enum(['user', 'admin']).optional(),
  isActive: z.boolean().optional(),
})
