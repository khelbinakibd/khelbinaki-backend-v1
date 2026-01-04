import { z } from 'zod'

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

export const createFacilitySchema = z.object({
  name: z.string().min(1, 'Facility name is required').max(100, 'Facility name must be less than 100 characters'),
  isActive: z.boolean().optional().default(true),
  pricingRules: z.array(pricingRuleSchema).min(1, 'Facility must have at least one pricing rule'), // Required: must have at least one rule
  defaultPricePerSlot: z.number().nonnegative('Default price per slot must be a non-negative number').optional(),
}).refine((data) => {
  // Validate that each rule has at least one time slot
  return data.pricingRules.every(rule => rule.timeSlots && rule.timeSlots.length > 0)
}, {
  message: 'Each pricing rule must have at least one time slot',
  path: ['pricingRules'],
})

export const updateFacilitySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  pricingRules: z.array(pricingRuleSchema).min(1, 'Facility must have at least one pricing rule').optional(), // Optional in update, but if provided must have at least one
  defaultPricePerSlot: z.number().nonnegative('Default price per slot must be a non-negative number').optional(),
}).refine((data) => {
  // If pricingRules are provided, ensure they are valid
  if (data.pricingRules && data.pricingRules.length > 0) {
    // Validate that each rule has at least one time slot
    return data.pricingRules.every(rule => rule.timeSlots && rule.timeSlots.length > 0)
  }
  return true
}, {
  message: 'Each pricing rule must have at least one time slot',
  path: ['pricingRules'],
})

