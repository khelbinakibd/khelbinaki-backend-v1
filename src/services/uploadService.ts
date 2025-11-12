import { v2 as cloudinary } from 'cloudinary'
import multer from 'multer'
import { env } from '../config/env'
import AppError from '../utils/AppError'
import { logger } from '../utils/logger'

// Configure Cloudinary with credentials from environment variables
cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
})

// Configure Multer for in-memory storage
// This is best because we don't need to save the file to our server's disk
const storage = multer.memoryStorage()

// Multer middleware to handle a single file upload
// We'll use the field name 'image'
export const upload = multer({
  storage,
  fileFilter(req, file, callback) {
    // Basic validation for image file types
    if (file.mimetype.startsWith('image/')) {
      callback(null, true)
    }
    else {
      callback(new AppError('Only image files are allowed!', 400))
    }
  },
})

/**
 * Upload a file buffer to Cloudinary.
 * @param file The object from Multer.
 * @param folder The folder in Cloudinary to upload to.
 * @returns The secure URL of th uploaded image.
 */

export async function uploadToCloudinary(file: Express.Multer.File, folder: string): Promise<string> {
  return new Promise((resolve, reject) => {
  // Cloudinary's uploader expects a stream, so we create one from the buffer
    const stream = cloudinary.uploader.upload_stream({ folder }, (error, result) => {
      if (error) {
        logger.error('Cloudinary upload error', { error })
        return reject(new AppError('Failed to upload image.', 500))
      }
      if (result) {
        resolve(result.secure_url)
      }
    })

    stream.end(file.buffer)
  })
}
