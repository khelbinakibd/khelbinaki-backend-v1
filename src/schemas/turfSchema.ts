import { z } from 'zod'

export const operatingHoursSchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
})

const timeSlotSchema = z.object({
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format, expected HH:mm'),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format, expected HH:mm'),
  pricePerSlot: z.number().nonnegative(),
})

const pricingRuleSchema = z.object({
  dayType: z.enum(['sunday-thursday', 'friday-saturday', 'all-days']),
  timeSlots: z.array(timeSlotSchema).min(1, 'At least one time slot is required per rule.'),
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

  pricingRules: z.array(pricingRuleSchema).min(1, 'At least one pricing rule is required.'),
  defaultPricePerSlot: z.number().nonnegative('Default price must be a non-negative number.'),

  bkashNumber: z.string().min(11, 'Number must be 11 digit').max(11, 'Number must be 11 digit'),

  amenities: z.array(z.string()).optional(),
  images: z.array(z.url()).optional(),
  operatingHours: operatingHoursSchema,
  slug: z.string().optional(),

  // FIXED: Added admins field - array of MongoDB ObjectId strings
  admins: z.array(
    z.string().regex(/^[0-9a-f]{24}$/i, 'Invalid MongoDB ObjectId format'),
  ).optional(),
})

export const updatedTurfSchema = z.object({
  name: z.string().min(3).optional(),
  googleMap: z.string().optional(),
  location: z.object({
    address: z.string().min(3),
    city: z.string().min(3),
  }).optional(),
  description: z.string().optional(),
  pricingRules: z.array(pricingRuleSchema).min(1).optional(),
  defaultPricePerSlot: z.number().nonnegative().optional(),

  bkashNumber: z.string().min(11, 'Number must be 11 digit').max(11, 'Number must be 11 digit'),

  amenities: z.array(z.string()).optional(),
  images: z.array(z.url()).optional(),
  operatingHours: operatingHoursSchema.optional(),
  isActive: z.boolean().optional(),
  // FIXED: Better validation for admins - checks ObjectId format
  admins: z.array(
    z.string().regex(/^[0-9a-f]{24}$/i, 'Invalid MongoDB ObjectId format'),
  ).optional(),
  slug: z.string().optional(),
})
