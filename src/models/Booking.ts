import mongoose from 'mongoose'

export interface IBooking extends mongoose.Document {
  user: mongoose.Types.ObjectId
  turf: mongoose.Types.ObjectId
  facility: mongoose.Types.ObjectId // Required after migration
  date: Date
  startTime: string
  endTime: string
  appliedPricePerSlot: number
  totalPrice: number
  pricingRule: string
  dayType: string
  status: 'pending' | 'confirmed' | 'cancelled'
  paymentStatus: 'unpaid' | 'paid' | 'refunded' | 'pending_approval'
  transactionId?: string // New field for bKash transaction ID
  paidAmount?: number // New field for the amount paid
  expiresAt: Date
  lastDigit: number
  // Manual booking flags
  isManual?: boolean
  createdBy?: 'user' | 'admin'
  createdByAdmin?: mongoose.Types.ObjectId
}

const bookingSchema = new mongoose.Schema<IBooking>({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  turf: { type: mongoose.Schema.Types.ObjectId, ref: 'Turf', required: true },
  facility: { type: mongoose.Schema.Types.ObjectId, ref: 'Facility', required: false }, // Optional initially for migration
  date: { type: Date, required: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },

  appliedPricePerSlot: { type: Number, required: true },
  totalPrice: { type: Number, required: true },
  pricingRule: { type: String, required: true },
  dayType: { type: String, required: true },

  status: { type: String, enum: ['pending', 'confirmed', 'cancelled'], default: 'pending' },
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'paid', 'refunded', 'pending_approval'],
    default: 'unpaid',
  },
  transactionId: { type: String }, // Add transactionId to the schema
  paidAmount: { type: Number }, // Add paidAmount to the schema
  expiresAt: { type: Date },
  lastDigit: { type: Number },
  // Flags for manual/admin-created bookings
  isManual: { type: Boolean, default: false },
  createdBy: { type: String, enum: ['user', 'admin'], default: 'user' },
  createdByAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

bookingSchema.index({ turf: 1, date: 1, startTime: 1 })
bookingSchema.index({ facility: 1, date: 1, startTime: 1 }) // For facility-specific availability queries
bookingSchema.index({ user: 1, createdAt: -1 })
bookingSchema.index({ dayType: 1, date: 1 })
bookingSchema.index({ status: 1, paymentStatus: 1 })
bookingSchema.index({ createdAt: -1 })
bookingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const Booking = mongoose.model<IBooking>('Booking', bookingSchema)
