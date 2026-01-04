import { z } from 'zod'

const isoDateString = z.string().refine(s => !Number.isNaN(Date.parse(s)), {
  message: 'Invalid date string (expected YYYY-MM-DD or ISO)',
}).transform(s => new Date(s))

export const createBookingSchema = z.object({
  turf: z.string().trim().min(1),
  facility: z.string().trim().min(1, 'Facility is required').regex(/^[0-9a-f]{24}$/i, 'Invalid facility ID format'),
  user: z.string().optional(),
  date: isoDateString,
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format, expected HH:mm'),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format, expected HH:mm'),
  transactionId: z.string().trim().min(1, 'Transaction ID is required'), // Add transactionId
  paidAmount: z.number().positive('Paid amount must be a positive number'), // Add paidAmount
  lastDigit: z.string().trim().min(4, 'Last 4 digit ID is required'),
}).refine((data) => {
  const start = new Date(`1970-01-01T${data.startTime}:00`)
  const end = new Date(`1970-01-01T${data.endTime}:00`)
  return end > start
}, {
  message: 'End time must be after start time',
  path: ['endTime'],
}).refine((data) => {
  const bookingDate = new Date(data.date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return bookingDate >= today
}, {
  message: 'Booking date cannot be in the past',
  path: ['date'],
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
  date: isoDateString,
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format, expected HH:mm'),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format, expected HH:mm'),
  totalPayment: z.number().positive('Total payment must be a positive number').nullable().optional(),
  paidAmount: z.number().nonnegative('Paid amount must be a non-negative number'),
  // New user fields (required only when creating new user)
  firstName: z.string().trim().min(1, 'First name is required').optional(),
  lastName: z.string().trim().min(1, 'Last name is required').optional(),
  email: z.string().email('Invalid email format').trim().toLowerCase().optional(),
}).refine((data) => {
  // Either userId or userPhone must be provided
  return !!(data.userId || data.userPhone)
}, {
  message: 'Either userId or userPhone must be provided',
  path: ['userPhone'],
}).refine((data) => {
  const start = new Date(`1970-01-01T${data.startTime}:00`)
  const end = new Date(`1970-01-01T${data.endTime}:00`)
  return end > start
}, {
  message: 'End time must be after start time',
  path: ['endTime'],
}).refine((data) => {
  const bookingDate = new Date(data.date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return bookingDate >= today
}, {
  message: 'Booking date cannot be in the past',
  path: ['date'],
})
