import { z } from 'zod'

const isoDateString = z.string().refine(s => !Number.isNaN(Date.parse(s)), {
  message: 'Invalid date string (expected YYYY-MM-DD or ISO)',
}).transform(s => new Date(s))

export const createBookingSchema = z.object({
  turf: z.string().trim().min(1),
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
  userId: z.string().trim().optional(),
  date: isoDateString,
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format, expected HH:mm'),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format, expected HH:mm'),
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
