/**
 * Retrieves all users with optional filtering and pagination.
 * Excludes passwords from the result
 */

import type { IUser } from '../models/User'
import mongoose from 'mongoose'
import { User } from '../models/User'

/**
 * Update a user's details by their ID.
 * @param userId The ID of the user to update
 * @param updateData The data to update.
 */

export async function updateUserById(userId: string, updateData: Partial<IUser>) {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return null
  }
  const updatedUser = await User.findByIdAndUpdate(userId, updateData, {
    new: true,
    runValidators: true,
  }).select('-password')
  return updatedUser
}
