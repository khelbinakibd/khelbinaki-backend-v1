import type { Response } from 'express'
import type { AuthRequest } from '../middlewares/authMiddleware'
import { Booking } from '../models/Booking'
import { Turf } from '../models/Turf'
import { createBookingSchema, updateBookingStatusSchema } from '../schemas/bookingSchema'
import { createBooking, findBookingById, findBookingByUser, getTurfAvailability, updateBookingStatus } from '../services/bookingServices'
import { calculateBookingPrice } from '../services/turfPricingService'
import AppError from '../utils/AppError'
import asyncHandler from '../utils/asyncHandler'

// Creating booking handler - COMPLETELY FIXED for manual payment
export const createBookingHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const validatedInput = createBookingSchema.parse(req.body)

  // Find the turf to get its pricing rules
  const turf = await Turf.findById(validatedInput.turf)
  if (!turf) {
    throw new AppError('Turf not found', 404)
  }

  // Helper function to check if two time ranges overlap
  const timeToMinutes = (timeString: string): number => {
    const [hours, minutes] = timeString.split(':').map(Number)
    return hours * 60 + minutes
  }

  const newBookingStart = timeToMinutes(validatedInput.startTime)
  const newBookingEnd = timeToMinutes(validatedInput.endTime)

  // Check for any conflicting confirmed or pending (awaiting approval) bookings
  // Must check if the entire time range overlaps with existing bookings
  const potentialConflicts = await Booking.find({
    turf: validatedInput.turf,
    date: validatedInput.date,
    status: { $in: ['confirmed', 'pending'] }, // Check both confirmed and pending
  }).select('startTime endTime status')

  for (const booking of potentialConflicts) {
    const existingStart = timeToMinutes(booking.startTime)
    const existingEnd = timeToMinutes(booking.endTime)

    // Overlap occurs if: new booking starts before existing ends AND new booking ends after existing starts
    if (newBookingStart < existingEnd && newBookingEnd > existingStart) {
      const message = booking.status === 'confirmed'
        ? 'This time slot is already booked and confirmed'
        : 'This time slot is pending approval. Please try another slot.'
      throw new AppError(message, 409)
    }
  }

  // Calculate the price using the pricing service
  const pricingDetails = calculateBookingPrice(
    turf,
    validatedInput.date,
    validatedInput.startTime,
    validatedInput.endTime,
  )

  // Validate that the paid amount is at least 10%
  const requiredAdvance = pricingDetails.totalPrice * 0.10
  if (validatedInput.paidAmount < requiredAdvance) {
    throw new AppError(`A minimum advance of 10% (BDT ${requiredAdvance.toFixed(2)}) is required.`, 400)
  }

  // Create a pending booking that waits for admin approval
  const newBookingData = {
    ...validatedInput,
    user: req.user!.id,
    appliedPricePerSlot: pricingDetails.pricePerSlot,
    totalPrice: pricingDetails.totalPrice,
    pricingRule: pricingDetails.appliedRule,
    dayType: pricingDetails.dayType,
    status: 'pending',
    paymentStatus: 'pending_approval', // Set new status
    transactionId: validatedInput.transactionId,
    paidAmount: validatedInput.paidAmount,
    lastDigit: validatedInput.lastDigit,
  } as any

  const newBooking = await createBooking(newBookingData)

  res.status(201).json({
    message: 'Booking request received. Your booking will be confirmed after payment verification by the admin.',
    booking: newBooking,
  })
})

// Get my booking handler
export const getMyBookingHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const bookings = await findBookingByUser(req.user?.id as any)

  res.json({
    message: 'Your bookings retrieved successfully.',
    count: bookings.length,
    data: bookings,
  })
})

// Get my booking details handler
export const getMyBookingDetailsHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const booking = await findBookingById(req.params.id) as any
  if (!booking) {
    throw new AppError('Booking not found', 404)
  }

  const turf = await Turf.findById(booking.turf)
  if (!turf) {
    throw new AppError('Associated turf not found', 404)
  }

  // Authorization check
  const isOwner = booking.user.equals(req.user!.id)
  const isAdmin = turf.admins.some(adminId => adminId.equals(req.user!.id))
  const isManager = req.user!.role === 'manager'

  if (!isOwner && !isAdmin && !isManager) {
    throw new AppError('Forbidden: You do not have permission to view this booking', 403)
  }

  res.json({
    message: 'Booking details retrieved successfully.',
    data: booking,
  })
})

// Get turf availability handler - FIXED
export const getTurfAvailabilityHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { date } = req.query
  const { id: turfId } = req.params

  if (!date || typeof date !== 'string') {
    throw new AppError('Date query parameter is required', 400)
  }

  const availabilityData = await getTurfAvailability(turfId, new Date(date))

  res.status(200).json({
    message: 'Turf availability retrieved successfully.',
    success: true,
    data: availabilityData,
  })
})

// Update booking status handler - FIXED
export const updateBookingStatusHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status } = updateBookingStatusSchema.parse(req.body)
  const { id: bookingId } = req.params

  const booking = await findBookingById(bookingId)
  if (!booking) {
    throw new AppError('Booking not found', 404)
  }

  // Authorization check: Only a manager or the admin of the specific turf can update the status
  const turf = await Turf.findById(booking.turf)
  const isAdminOfThisTurf = turf && turf.admins.some(adminId => adminId.equals(req.user!.id))

  if (req.user!.role !== 'manager' && !isAdminOfThisTurf) {
    throw new AppError('Forbidden: You are not authorized to perform this action.', 403)
  }

  // FIXED: Business logic validation
  if (status === 'confirmed' && booking.paymentStatus !== 'paid') {
    throw new AppError('Cannot confirm booking without successful payment', 400)
  }

  const updatedBooking = await updateBookingStatus(bookingId, status)

  res.json({
    message: `Booking status updated to ${status} successfully.`,
    data: updatedBooking,
  })
})

export const cancelMyBookingHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id: bookingId } = req.params

  const booking = await findBookingById(bookingId)
  if (!booking) {
    throw new AppError('Booking not found', 404)
  }

  // Ensure the booking belongs to the authenticated user
  if (booking.user._id.toString() !== req.user!.id) {
    throw new AppError('Forbidden: You are not authorized to cancel this booking.', 403)
  }

  // Optional: Add business logic here, e.g., prevent cancellation if the booking is too soon.

  // Only allow cancellation of pending bookings
  if (booking.status !== 'pending') {
    throw new AppError('Only pending bookings can be cancelled.', 400)
  }

  const updatedBooking = await updateBookingStatus(bookingId, 'cancelled')

  res.json({
    message: 'Booking cancelled successfully.',
    data: updatedBooking,
  })
})
