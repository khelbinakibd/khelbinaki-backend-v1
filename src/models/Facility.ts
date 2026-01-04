import mongoose from 'mongoose'
import type { IPricingRule, ITimeSlot } from './Turf'

export interface IFacility extends mongoose.Document {
  name: string
  turf: mongoose.Types.ObjectId
  pricingRules: IPricingRule[] // Required: facility must have pricing rules
  defaultPricePerSlot?: number // Optional: display-only fallback when no rules match
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

// TimeSlot Schema (reused from Turf)
const timeSlotSchema = new mongoose.Schema<ITimeSlot>({
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  pricePerSlot: { type: Number, required: true },
}, { _id: false })

// PricingRule Schema (reused from Turf)
const pricingRulesSchema = new mongoose.Schema<IPricingRule>({
  dayType: {
    type: String,
    enum: ['sunday-thursday', 'friday-saturday', 'all-days'],
    required: true,
  },
  timeSlots: [timeSlotSchema],
}, { _id: false })

// Facility Schema
const facilitySchema = new mongoose.Schema<IFacility>({
  name: { type: String, required: true },
  turf: { type: mongoose.Schema.Types.ObjectId, ref: 'Turf', required: true, index: true },
  pricingRules: { type: [pricingRulesSchema], required: true }, // Required: facility must have pricing rules
  defaultPricePerSlot: { type: Number }, // Optional: display-only fallback
  isActive: { type: Boolean, default: true },
}, { timestamps: true })

// Validate that pricingRules array is not empty
facilitySchema.pre('validate', function (next) {
  if (!this.pricingRules || this.pricingRules.length === 0) {
    next(new Error('Facility must have at least one pricing rule'))
  }
  else {
    next()
  }
})

// Indexes for performance
facilitySchema.index({ turf: 1, isActive: 1 })
facilitySchema.index({ turf: 1, name: 1 }) // For unique name per turf queries

export const Facility = mongoose.model<IFacility>('Facility', facilitySchema)

