import mongoose from 'mongoose'

export interface IOtp extends mongoose.Document {
  email: string
  otp: string
  expiresAt: Date
}

const otpSchema = new mongoose.Schema<IOtp>({
  email: { type: String, required: true, index: true },
  otp: { type: String, required: true },
  expiresAt: {
    type: Date,
    required: true,
    expires: '10m',
  },
}, { timestamps: true })

export const Otp = mongoose.model<IOtp>('Otp', otpSchema)
