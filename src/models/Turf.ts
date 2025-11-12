import mongoose from 'mongoose'
import slugify from 'slugify'

export interface ITimeSlot {
  startTime: string
  endTime: string
  pricePerSlot: number
}

export interface IPricingRule {
  dayType: 'sunday-thursday' | 'friday-saturday' | 'all-days'
  timeSlots: ITimeSlot[]
}

export interface ITurf extends mongoose.Document {
  name: string
  slug: string
  googleMap: string
  location: {
    address: string
    city: string
  }
  description?: string
  pricingRules: IPricingRule[]
  defaultPricePerSlot: number
  bkashNumber: string
  amenities: string[]
  images: string[]
  operatingHours: { start: string, end: string }
  admins: mongoose.Types.ObjectId[]
  createdAt: Date
  isActive: boolean
  updatedAt: Date
}

// TimeSlot Schema
const timeSlotSchema = new mongoose.Schema<ITimeSlot>({
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  pricePerSlot: { type: Number, required: true },
}, { _id: false })

// PricingRule Schema
const pricingRulesSchema = new mongoose.Schema<IPricingRule>({
  dayType: {
    type: String,
    enum: ['sunday-thursday', 'friday-saturday', 'all-days'],
    required: true,
  },
  timeSlots: [timeSlotSchema],
}, { _id: false })

// Turf Schema
const turfSchema = new mongoose.Schema<ITurf>({
  name: { type: String, required: true, unique: true },
  slug: { type: String, unique: true },
  googleMap: { type: String },
  location: {
    address: { type: String, required: true },
    city: { type: String, required: true },
  },
  description: { type: String, default: '' },

  bkashNumber: { type: String, required: true },

  pricingRules: [pricingRulesSchema],
  defaultPricePerSlot: { type: Number, required: true },

  amenities: { type: [String], default: [] },
  images: { type: [String], default: [] },
  operatingHours: {
    start: { type: String, required: true },
    end: { type: String, required: true },
  },
  admins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true })

// Pre save hook to auto-generate the slug before saving
turfSchema.pre('save', function (next) {
  if (this.isModified('name')) {
    this.slug = slugify(this.name, { lower: true, strict: true })
  }
  next()
})

// Adding indexes for performance
turfSchema.index({ 'location.city': 1, 'isActive': 1 })
turfSchema.index({ 'pricingRules.dayType': 1 })

export const Turf = mongoose.model<ITurf>('Turf', turfSchema)
