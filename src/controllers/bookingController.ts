import type { Response } from 'express'
import type { AuthRequest } from '../middlewares/authMiddleware'
import { Facility } from '../models/Facility'
import { Turf } from '../models/Turf'
import { createBookingSchema, updateBookingStatusSchema } from '../schemas/bookingSchema'
import { createBooking, findBookingById, findBookingByUser, getTurfAvailability } from '../services/bookingServices'
import { calculateFacilityPrice } from '../services/facilityPricingService'
import AppError from '../utils/AppError'
import asyncHandler from '../utils/asyncHandler'
import { dhakaDateStart, isValidDateKey } from '../utils/businessTime'
import { mutateBookingOccupancy } from '../services/bookingOccupancyService'

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

  const newBooking = await createBooking(newBookingData, req.user!)

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

  const updatedBooking = await mutateBookingOccupancy(bookingId, req.user!, { kind: 'status', status })

  res.json({
    message: `Booking status updated to ${status} successfully.`,
    data: updatedBooking,
  })
})

export const cancelMyBookingHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id: bookingId } = req.params

  const updatedBooking = await mutateBookingOccupancy(bookingId, req.user!, { kind: 'cancel-own' })

  res.json({
    message: 'Booking cancelled successfully.',
    data: updatedBooking,
  })
})
