import { z } from 'zod'
import { getDhakaDateKey, isDhakaSlotInPast, isValidDateKey, timeToMinutes } from '../utils/businessTime'

const bookingTimePattern = /^([01]\d|2[0-3]):([0-5]\d)$/

export const createBookingSchema = z.object({
  turf: z.string().trim().min(1),
  facility: z.string().trim().min(1, 'Facility is required').regex(/^[0-9a-f]{24}$/i, 'Invalid facility ID format'),
  user: z.string().optional(),
  date: z.string().refine(isValidDateKey, {
    message: 'Invalid date; expected a real date in YYYY-MM-DD format',
  }),
  startTime: z.string().regex(bookingTimePattern, 'Invalid time format, expected HH:mm'),
  endTime: z.string().regex(bookingTimePattern, 'Invalid time format, expected HH:mm'),
  transactionId: z.string().trim().min(1, 'Transaction ID is required'), // Add transactionId
  paidAmount: z.number().positive('Paid amount must be a positive number'), // Add paidAmount
  lastDigit: z.string().trim().min(4, 'Last 4 digit ID is required'),
}).superRefine((data, ctx) => {
  if (!isValidDateKey(data.date)
    || !bookingTimePattern.test(data.startTime)
    || !bookingTimePattern.test(data.endTime)) {
    return
  }

  if (timeToMinutes(data.endTime) <= timeToMinutes(data.startTime)) {
    ctx.addIssue({
      code: 'custom',
      message: 'End time must be after start time',
      path: ['endTime'],
    })
  }

  const currentDhakaDate = getDhakaDateKey()
  if (data.date < currentDhakaDate) {
    ctx.addIssue({
      code: 'custom',
      message: 'Booking date cannot be in the past',
      path: ['date'],
    })
    return
  }

  if (isDhakaSlotInPast(data.date, data.startTime)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Booking start time has already passed',
      path: ['startTime'],
    })
  }
})

export const updateBookingStatusSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'cancelled']),
})

// Admin manual booking schema: no payment required and no transaction fields
export const createAdminManualBookingSchema = z.object({
  turf: z.string().trim().min(1),
  facility: z.string().trim().min(1, 'Facility is required').regex(/^[0-9a-f]{24}$/i, 'Invalid facility ID format'),
  userId: z.string().trim().optional(), // Keep for backward compatibility
  userPhone: z.string().regex(/^\d{11}$/, 'Phone must be exactly 11 digits').optional(), // Optional if userId is provided
  date: z.string().refine(isValidDateKey, {
    message: 'Invalid date; expected a real date in YYYY-MM-DD format',
  }),
  startTime: z.string().regex(bookingTimePattern, 'Invalid time format, expected HH:mm'),
  endTime: z.string().regex(bookingTimePattern, 'Invalid time format, expected HH:mm'),
  totalPayment: z.number().positive('Total payment must be a positive number').nullable().optional(),
  paidAmount: z.number().nonnegative('Paid amount must be a non-negative number'),
  // New user fields (required only when creating new user)
  firstName: z.string().trim().min(1, 'First name is required').optional(),
  lastName: z.string().trim().min(1, 'Last name is required').optional(),
  email: z.string().email('Invalid email format').trim().toLowerCase().optional(),
}).superRefine((data, ctx) => {
  if (!data.userId && !data.userPhone) {
    ctx.addIssue({
      code: 'custom',
      message: 'Either userId or userPhone must be provided',
      path: ['userPhone'],
    })
  }

  if (!isValidDateKey(data.date)
    || !bookingTimePattern.test(data.startTime)
    || !bookingTimePattern.test(data.endTime)) {
    return
  }

  if (timeToMinutes(data.endTime) <= timeToMinutes(data.startTime)) {
    ctx.addIssue({
      code: 'custom',
      message: 'End time must be after start time',
      path: ['endTime'],
    })
  }

  if (data.date < getDhakaDateKey()) {
    ctx.addIssue({
      code: 'custom',
      message: 'Booking date cannot be in the past',
      path: ['date'],
    })
  }
})
