import mongoose from 'mongoose'

export interface IContactMessage extends mongoose.Document {
  name: string
  email: string
  message: string
  createdAt: Date
}

const contactMessageSchema = new mongoose.Schema<IContactMessage>({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  message: { type: String, required: true, trim: true },
}, { timestamps: { createdAt: true, updatedAt: false } })

export const ContactMessage = mongoose.model<IContactMessage>('ContactMessage', contactMessageSchema)
