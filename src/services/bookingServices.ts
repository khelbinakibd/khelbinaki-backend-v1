import type { IBooking } from '../models/Booking'
import { Booking } from '../models/Booking'
import { Facility } from '../models/Facility'
import { Turf } from '../models/Turf'
import AppError from '../utils/AppError'
import { calculateFacilityPrice } from './facilityPricingService'

// Creating booking service
export async function createBooking(data: Partial<IBooking>) {
  const newBooking = await Booking.create(data)
  return newBooking
}

// Find booking service
export async function findBookingByUser(userId: string) {
  return await Booking.find({ user: userId })
    .populate('turf', 'name location images')
    .populate('facility', 'name')
    .select('-__v')
    .sort({ createdAt: -1 })
    .lean()
}

// Find booking service by id
export async function findBookingById(bookingId: string) {
  return await Booking.findById(bookingId)
    .populate('user', 'name email')
    .populate('turf')
    .populate('facility', 'name')
}

// Helper function to check if two time ranges overlap (handles midnight-spanning slots)
function doTimeRangesOverlap(
  start1: string,
  end1: string,
  start2: string,
  end2: string,
): boolean {
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

// Helper function to check if a time slot overlaps with any existing booking range
function isSlotOverlapWithBookings(
  slotStartTime: string,
  slotEndTime: string,
  bookings: Array<{ startTime: string, endTime: string }>,
): boolean {
  for (const booking of bookings) {
    if (doTimeRangesOverlap(slotStartTime, slotEndTime, booking.startTime, booking.endTime)) {
      return true
    }
  }

  return false
}

// Helper function to convert HH:mm to minutes since midnight
function timeToMinutes(timeString: string): number {
  const [hours, minutes] = timeString.split(':').map(Number)
  return hours * 60 + minutes
}

// Turf Availability service (now facility-specific)
export async function getTurfAvailability(turfId: string, date: Date, facilityId: string) {
  const turf = await Turf.findById(turfId)
  if (!turf) {
    throw new AppError('Turf not found', 404)
  }

  // Validate facility exists and belongs to turf
  const facility = await Facility.findById(facilityId)
  if (!facility) {
    throw new AppError('Facility not found', 404)
  }

  if (facility.turf.toString() !== turfId) {
    throw new AppError('Facility does not belong to this turf', 400)
  }

  // Check facility is active
  if (!facility.isActive) {
    throw new AppError('Facility is not active', 400)
  }

  // Validate facility has pricingRules (required)
  if (!facility.pricingRules || !Array.isArray(facility.pricingRules) || facility.pricingRules.length === 0) {
    throw new AppError('Facility must have pricing rules configured', 400)
  }

  const startOfDay = new Date(date)
  startOfDay.setHours(0, 0, 0, 0)

  const endOfDay = new Date(date)
  endOfDay.setHours(23, 59, 59, 999)

  //  Get all bookings that make slots unavailable (filtered by facility)
  const unavailableBookings = await Booking.find({
    turf: turfId,
    facility: facilityId, // Filter by facility
    date: {
      $gte: startOfDay,
      $lt: endOfDay,
    },
    // A slot is unavailable if:
    // 1. Booking is confirmed (paid or unpaid)
    // 2. Booking is pending and created within last 15 minutes (temporary hold)
    $or: [
      { status: 'confirmed' }, // Always unavailable regardless of payment
      {
        status: 'pending',
        createdAt: { $gte: new Date(Date.now() - 15 * 60 * 1000) },
      },
    ],
  }).select('startTime endTime status paymentStatus')

  // Generate all possible 1-hour slots based on operating hours
  const availableSlots = []
  const { start: operatingStart, end: operatingEnd } = turf.operatingHours

  let currentTime = new Date(`${date.toISOString().split('T')[0]}T${operatingStart}:00`)
  const endTime = new Date(`${date.toISOString().split('T')[0]}T${operatingEnd}:00`)

  while (currentTime < endTime) {
    const startTimeString = currentTime.toTimeString().substring(0, 5) // "HH:mm"

    const nextHour = new Date(currentTime)
    nextHour.setHours(nextHour.getHours() + 1)

    const endTimeString = nextHour.toTimeString().substring(0, 5)

    // Calculate price for each slot using facility pricing (facility-only, no turf fallback)
    const pricing = calculateFacilityPrice(facility, date, startTimeString, endTimeString)

    // Check if this 1-hour slot overlaps with ANY existing booking range
    const hasOverlap = isSlotOverlapWithBookings(
      startTimeString,
      endTimeString,
      unavailableBookings.map(b => ({ startTime: b.startTime, endTime: b.endTime })),
    )

    availableSlots.push({
      startTime: startTimeString,
      endTime: endTimeString,
      isAvailable: !hasOverlap, // TRUE: slot is available, FALSE: overlaps with any booking
      pricePerSlot: pricing.pricePerSlot,
      dayTypeLabel: pricing.dayType === 'friday-saturday' ? 'FRI-SAT' : 'SUN-THU',
    })
    currentTime = nextHour
  }

  const dayType = calculateFacilityPrice(facility, date, '00:00', '01:00').dayType
  return {
    date: date.toISOString().split('T')[0],
    dayType,
    slots: availableSlots,
  }
}

// Update booking status service
export async function updateBookingStatus(bookingId: string, status: 'pending' | 'confirmed' | 'cancelled') {
  const updatedBooking = await Booking.findByIdAndUpdate(
    bookingId,
    { status },
    { new: true, runValidators: true },
  )
  return updatedBooking
}
