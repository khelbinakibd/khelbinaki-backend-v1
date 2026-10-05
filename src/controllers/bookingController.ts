import type { Response } from 'express'
import type { AuthRequest } from '../middlewares/authMiddleware'
import { Booking } from '../models/Booking'
import { Facility } from '../models/Facility'
import { Turf } from '../models/Turf'
import { createBookingSchema, lookupBookingPaginationSchema, lookupBookingSchema, updateBookingStatusSchema } from '../schemas/bookingSchema'
import { createBooking, findBookingById, findBookingByUser, getTurfAvailability, lookupBookingsByPhone, updateBookingStatus } from '../services/bookingServices'
import { calculateFacilityPrice } from '../services/facilityPricingService'
import AppError from '../utils/AppError'
import asyncHandler from '../utils/asyncHandler'
import { dhakaDateStart, getDhakaDayRange, isValidDateKey } from '../utils/businessTime'

// Creating booking handler - COMPLETELY FIXED for manual payment
export const createBookingHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const validatedInput = createBookingSchema.parse(req.body)
  const dateKey = validatedInput.date

  // Find the turf to get its pricing rules
  const turf = await Turf.findById(validatedInput.turf)
  if (!turf) {
    throw new AppError('Turf not found', 404)
  }

  // Validate facility exists and belongs to turf
  const facility = await Facility.findById(validatedInput.facility)
  if (!facility) {
    throw new AppError('Facility not found', 404)
  }

  if (facility.turf.toString() !== validatedInput.turf) {
    throw new AppError('Facility does not belong to this turf', 400)
  }

  if (!facility.isActive) {
    throw new AppError('Facility is not active', 400)
  }

  // Validate facility has pricingRules (required)
  if (!facility.pricingRules || !Array.isArray(facility.pricingRules) || facility.pricingRules.length === 0) {
    throw new AppError('Facility must have pricing rules configured', 400)
  }

  // Helper function to convert HH:mm to minutes since midnight
  const timeToMinutes = (timeString: string): number => {
    const [hours, minutes] = timeString.split(':').map(Number)
    return hours * 60 + minutes
  }

  // Helper function to check if two time ranges overlap (handles midnight-spanning slots)
  const doTimeRangesOverlap = (
    start1: string,
    end1: string,
    start2: string,
    end2: string,
  ): boolean => {
    const start1Minutes = timeToMinutes(start1)
    const end1Minutes = timeToMinutes(end1)
    const start2Minutes = timeToMinutes(start2)
    const end2Minutes = timeToMinutes(end2)

    const range1SpansMidnight = end1Minutes < start1Minutes
    const range2SpansMidnight = end2Minutes < start2Minutes

    // If both ranges span midnight, they always overlap (simplified check)
    if (range1SpansMidnight && range2SpansMidnight) {
      return true
    }

    // If range1 spans midnight
    if (range1SpansMidnight) {
      // Range1: [start1, 24:00) U [00:00, end1)
      // Check if range2 overlaps with either part
      return (
        (start2Minutes >= start1Minutes && start2Minutes < 24 * 60) || // Overlaps with first part
        (end2Minutes > start1Minutes && end2Minutes <= 24 * 60) || // Overlaps with first part
        (start2Minutes >= 0 && start2Minutes < end1Minutes) || // Overlaps with second part
        (end2Minutes > 0 && end2Minutes <= end1Minutes) || // Overlaps with second part
        (start2Minutes < end1Minutes && end2Minutes > start1Minutes) // Spans across both parts
      )
    }

    // If range2 spans midnight
    if (range2SpansMidnight) {
      // Range2: [start2, 24:00) U [00:00, end2)
      // Check if range1 overlaps with either part
      return (
        (start1Minutes >= start2Minutes && start1Minutes < 24 * 60) || // Overlaps with first part
        (end1Minutes > start2Minutes && end1Minutes <= 24 * 60) || // Overlaps with first part
        (start1Minutes >= 0 && start1Minutes < end2Minutes) || // Overlaps with second part
        (end1Minutes > 0 && end1Minutes <= end2Minutes) || // Overlaps with second part
        (start1Minutes < end2Minutes && end1Minutes > start2Minutes) // Spans across both parts
      )
    }

    // Both ranges are same-day: standard overlap check
    // Overlap occurs if: range1 starts before range2 ends AND range1 ends after range2 starts
    return start1Minutes < end2Minutes && end1Minutes > start2Minutes
  }

  // Check for any conflicting confirmed or pending (awaiting approval) bookings
  // Must check if the entire time range overlaps with existing bookings (filtered by facility)
  const { start, endExclusive } = getDhakaDayRange(dateKey)
  const potentialConflicts = await Booking.find({
    turf: validatedInput.turf,
    facility: validatedInput.facility, // Filter by facility
    date: {
      $gte: start,
      $lt: endExclusive,
    },
    status: { $in: ['confirmed', 'pending'] }, // Check both confirmed and pending
  }).select('startTime endTime status')

  for (const booking of potentialConflicts) {
    // Use overlap function that handles midnight-spanning slots
    if (doTimeRangesOverlap(
      validatedInput.startTime,
      validatedInput.endTime,
      booking.startTime,
      booking.endTime,
    )) {
      const message = booking.status === 'confirmed'
        ? 'This time slot is already booked and confirmed'
        : 'This time slot is pending approval. Please try another slot.'
      throw new AppError(message, 409)
    }
  }

  // Calculate the price using facility pricing service (facility-only, no turf fallback)
  const pricingDetails = calculateFacilityPrice(
    facility,
    dateKey,
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
    facility: validatedInput.facility,
    date: dhakaDateStart(dateKey),
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

// Get turf availability handler - FIXED (now facility-specific)
export const getTurfAvailabilityHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { date, facility } = req.query
  const { id: turfId } = req.params

  if (!date || typeof date !== 'string') {
    throw new AppError('Date query parameter is required', 400)
  }

  if (!isValidDateKey(date)) {
    throw new AppError('Invalid date query parameter; expected YYYY-MM-DD', 400)
  }

  if (!facility || typeof facility !== 'string') {
    throw new AppError('Facility query parameter is required', 400)
  }

  const availabilityData = await getTurfAvailability(turfId, date, facility)

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

export const lookupBookingsHandler = asyncHandler(async (req, res: Response) => {
  const { phone } = lookupBookingSchema.parse(req.body)
  const { page, limit } = lookupBookingPaginationSchema.parse(req.query)
  res.status(200).json(await lookupBookingsByPhone(phone, page, limit))
})
