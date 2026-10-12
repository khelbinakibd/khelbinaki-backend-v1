import { Booking } from '../models/Booking'
import { Facility } from '../models/Facility'
import { Turf } from '../models/Turf'
import AppError from '../utils/AppError'
import { addDaysToDateKey, dhakaDateStart, isDhakaSlotInPast, timeToMinutes } from '../utils/businessTime'
import { calculateFacilityPrice } from './facilityPricingService'
import { MaintenanceBlock } from '../models/MaintenanceBlock'
import { ACTIVE_BOOKING_STATUSES, occupancyDateWindow, slotsOverlap } from './occupancyService'
export { createGuardedBooking as createBooking } from './bookingOccupancyService'

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

function minutesToTime(totalMinutes: number): string {
  const minutesInDay = 24 * 60
  const normalizedMinutes = ((totalMinutes % minutesInDay) + minutesInDay) % minutesInDay
  const hours = Math.floor(normalizedMinutes / 60)
  const minutes = normalizedMinutes % 60

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
}

// Turf Availability service (now facility-specific)
export async function getTurfAvailability(turfId: string, dateKey: string, facilityId: string) {
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

  // Pending and confirmed remain active until an explicit guarded transition.
  const dateWindow = occupancyDateWindow(dateKey)
  const unavailableBookings = await Booking.find({
    facility: facilityId, date: dateWindow, status: { $in: ACTIVE_BOOKING_STATUSES },
  }).select('date startTime endTime')
  const maintenanceBlocks = await MaintenanceBlock.find({
    facility: facilityId, date: dateWindow, releasedAt: null,
  }).select('date startTime endTime')

  // Generate all possible 1-hour slots based on operating hours
  const availableSlots = []
  const { start: operatingStart, end: operatingEnd } = turf.operatingHours
  const operatingStartMinutes = timeToMinutes(operatingStart)
  let operatingEndMinutes = timeToMinutes(operatingEnd)

  // Treat an earlier end time as an operating window that spans midnight.
  if (operatingEndMinutes < operatingStartMinutes) {
    operatingEndMinutes += 24 * 60
  }

  for (let currentMinutes = operatingStartMinutes; currentMinutes < operatingEndMinutes; currentMinutes += 60) {
    const startTimeString = minutesToTime(currentMinutes)
    const endTimeString = minutesToTime(currentMinutes + 60)

    // Calculate price for each slot using facility pricing (facility-only, no turf fallback)
    const pricing = calculateFacilityPrice(facility, dateKey, startTimeString, endTimeString)

    const slotDateKey = addDaysToDateKey(dateKey, Math.floor(currentMinutes / (24 * 60)))
    const slot = { date: dhakaDateStart(slotDateKey), startTime: startTimeString, endTime: endTimeString }
    const hasOverlap = unavailableBookings.some(booking => slotsOverlap(slot, booking))
      || maintenanceBlocks.some(block => slotsOverlap(slot, block))
    const isTimePassed = isDhakaSlotInPast(slotDateKey, startTimeString)

    availableSlots.push({
      startTime: startTimeString,
      endTime: endTimeString,
      isAvailable: !hasOverlap && !isTimePassed,
      isTimePassed,
      pricePerSlot: pricing.pricePerSlot,
      dayTypeLabel: pricing.dayType === 'friday-saturday' ? 'FRI-SAT' : 'SUN-THU',
    })
  }

  const dayType = calculateFacilityPrice(facility, dateKey, '00:00', '01:00').dayType
  return {
    date: dateKey,
    dayType,
    slots: availableSlots,
  }
}
