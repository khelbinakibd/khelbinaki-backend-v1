import { z } from 'zod'

export const operatingHoursSchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
})

const timeSlotSchema = z.object({
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format, expected HH:mm'),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format, expected HH:mm'),
  pricePerSlot: z.number().nonnegative(),
}).refine((data) => {
  // Allow endTime < startTime for midnight-spanning slots (e.g., 16:00-01:00)
  // If endTime < startTime, it means the slot spans midnight (next day)
  // If endTime >= startTime, it's a normal same-day slot
  // Both cases are valid
  return true
}, {
  message: 'Time slot validation passed',
})

const pricingRuleSchema = z.object({
  dayType: z.enum(['sunday-thursday', 'friday-saturday', 'all-days']),
  timeSlots: z.array(timeSlotSchema).min(1, 'At least one time slot is required per rule.'),
})

// Facility schema for turf creation/update
const facilitySchema = z.object({
  _id: z.string().regex(/^[0-9a-f]{24}$/i, 'Invalid MongoDB ObjectId format').optional(), // For updates
  name: z.string().min(1, 'Facility name is required').max(100, 'Facility name must be less than 100 characters'),
  isActive: z.boolean().optional().default(true),
  pricingRules: z.array(pricingRuleSchema).min(1, 'Facility must have at least one pricing rule'), // Required: must have at least one rule
  defaultPricePerSlot: z.number().nonnegative().optional(),
})

// FIXED: Added admins field validation
export const createTurfSchema = z.object({
  name: z.string().min(3),
  googleMap: z.string().optional(),
  location: z.object({
    address: z.string().min(3),
    city: z.string().min(3),
  }),
  description: z.string().optional(),

  // Pricing fields removed - all pricing is now at facility level
  // pricingRules: deprecated (no longer used)
  // defaultPricePerSlot: deprecated (no longer used)

  bkashNumber: z.string().min(11, 'Number must be 11 digit').max(11, 'Number must be 11 digit'),

  amenities: z.array(z.string()).optional(),
  images: z.array(z.url()).optional(),
  operatingHours: operatingHoursSchema,
  capacity: z.number().int().positive('Capacity must be a positive integer').optional(),
  slug: z.string().optional(),

  // FIXED: Added admins field - array of MongoDB ObjectId strings
  admins: z.array(
    z.string().regex(/^[0-9a-f]{24}$/i, 'Invalid MongoDB ObjectId format'),
  ).optional(),
  // Facilities array for turf creation
  facilities: z.array(facilitySchema).optional(),
})

export const updatedTurfSchema = z.object({
  name: z.string().min(3).optional(),
  googleMap: z.string().optional(),
  location: z.object({
    address: z.string().min(3),
    city: z.string().min(3),
  }).optional(),
  description: z.string().optional(),
  // Pricing fields removed - all pricing is now at facility level
  // pricingRules: deprecated (no longer used)
  // defaultPricePerSlot: deprecated (no longer used)

  bkashNumber: z.string().min(11, 'Number must be 11 digit').max(11, 'Number must be 11 digit'),

  amenities: z.array(z.string()).optional(),
  images: z.array(z.url()).optional(),
  operatingHours: operatingHoursSchema.optional(),
  capacity: z.number().int().positive('Capacity must be a positive integer').optional(),
  isActive: z.boolean().optional(),
  // FIXED: Better validation for admins - checks ObjectId format
  admins: z.array(
    z.string().regex(/^[0-9a-f]{24}$/i, 'Invalid MongoDB ObjectId format'),
  ).optional(),
  slug: z.string().optional(),
  // Facilities array for turf update
  facilities: z.array(facilitySchema).optional(),
})
