import mongoose from 'mongoose'

export interface IReport extends mongoose.Document {
  // Legacy fields for turf-related reports
  turfId?: mongoose.Types.ObjectId
  reason?: string
  details?: string
  // New fields for website feedback/reports
  name: string
  email: string
  phone?: string
  subject: string
  message: string
  reportType: 'bug' | 'security' | 'abuse' | 'privacy' | 'other' | 'website' | 'turf_issue'
  userId?: mongoose.Types.ObjectId
  status: 'open' | 'in_review' | 'resolved' | 'closed'
  createdAt: Date
}

const reportSchema = new mongoose.Schema<IReport>({
  // Legacy fields
  turfId: { type: mongoose.Schema.Types.ObjectId, ref: 'Turf' },
  reason: { type: String, trim: true },
  details: { type: String, trim: true },
  // New fields
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  phone: { type: String, trim: true },
  subject: { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true },
  reportType: {
    type: String,
    enum: ['bug', 'security', 'abuse', 'privacy', 'other', 'website', 'turf_issue'],
    default: 'other',
  },
  status: {
    type: String,
    enum: ['open', 'in_review', 'resolved', 'closed'],
    default: 'open',
  },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: { createdAt: true, updatedAt: false } })

reportSchema.index({ createdAt: -1 })
reportSchema.index({ status: 1, createdAt: -1 })
reportSchema.index({ reportType: 1, createdAt: -1 })
reportSchema.index({ email: 1 })
reportSchema.index({ turfId: 1, createdAt: -1 })

export const Report = mongoose.model<IReport>('Report', reportSchema)
