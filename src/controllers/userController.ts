import type { Request, Response } from 'express'
import type { AuthRequest } from '../middlewares/authMiddleware'
import { User } from '../models/User'
import { updateProfileSchema } from '../schemas/userSchema'
import AppError from '../utils/AppError'
import asyncHandler from '../utils/asyncHandler'

// GET /api/v1/me/
export const getMyProfile = asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await User.findById(req.user!.id).select('-password')
  if (!user)
    throw new AppError('User not found', 404)
  res.json(user)
})

// PATCH /api/v1/me/
export const updateMyProfile = asyncHandler(async (req: AuthRequest, res: Response) => {
  const validated = updateProfileSchema.parse(req.body)

  if (validated.email) {
    const exists = await User.findOne({ email: validated.email, _id: { $ne: req.user!.id } })
    if (exists)
      throw new AppError('Email already in use', 409)
  }

  const updated = await User.findByIdAndUpdate(
    req.user!.id,
    { $set: validated },
    { new: true, runValidators: true, select: '-password' },
  )
  if (!updated)
    throw new AppError('User not found', 404)

  res.json(updated)
})

// GET /api/v1/users
export const getAllUsersHandler = asyncHandler(async (req: Request, res: Response) => {
  const users = await User.find().select('-password')

  res.status(200).json({
    message: 'User retrived successfully.',
    count: users.length,
    users,
  })
})
