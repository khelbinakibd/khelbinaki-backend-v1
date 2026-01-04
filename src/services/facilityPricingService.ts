import type { IFacility } from '../models/Facility'
import type { IPricingRule, ITurf } from '../models/Turf'
import { calculateBookingPrice, type PricingCalculationResult } from './turfPricingService'

// Helper function to check if a time falls within a time slot (handles midnight-spanning slots)
function isTimeInSlot(time: string, slotStartTime: string, slotEndTime: string): boolean {
  const timeMinutes = timeToMinutes(time)
  const startMinutes = timeToMinutes(slotStartTime)
  const endMinutes = timeToMinutes(slotEndTime)

  // If endTime < startTime, the slot spans midnight
  if (endMinutes < startMinutes) {
    // Slot spans midnight: time is valid if it's >= startTime OR < endTime
    return timeMinutes >= startMinutes || timeMinutes < endMinutes
  }
  else {
    // Normal same-day slot: time is valid if it's >= startTime AND < endTime
    return timeMinutes >= startMinutes && timeMinutes < endMinutes
  }
}

// Helper function to convert HH:mm to minutes since midnight
function timeToMinutes(timeString: string): number {
  const [hours, minutes] = timeString.split(':').map(Number)
  return hours * 60 + minutes
}

// Finds the applicable pricing rule for a given day type and start time (for facilities)
function findApplicableTimeSlot(
  pricingRules: IPricingRule[],
  dayType: 'sunday-thursday' | 'friday-saturday',
  startTime: string,
): (IPricingRule['timeSlots'][0] & { ruleName: string }) | null {
  // Prioritize a rule specific to the dayType, then fall back to an 'all-days' rule.
  let applicableRule = pricingRules.find(rule => rule.dayType === dayType)

  if (!applicableRule) {
    applicableRule = pricingRules.find(rule => rule.dayType === 'all-days')
  }

  if (!applicableRule) {
    return null // No rule found for this day type or for 'all-days'.
  }

  for (const slot of applicableRule.timeSlots) {
    // Use helper function that handles midnight-spanning slots
    if (isTimeInSlot(startTime, slot.startTime, slot.endTime)) {
      // Return a plain object with the details of found slot.
      return {
        startTime: slot.startTime,
        endTime: slot.endTime,
        pricePerSlot: slot.pricePerSlot,
        ruleName: `${applicableRule.dayType}-${slot.startTime}-${slot.endTime}`,
      }
    }
  }
  return null // Not matching time slot found within the applicable rule.
}

// Calculate duration in hours (handles midnight-spanning slots)
function calculateDurationInHours(startTime: string, endTime: string): number {
  const startMinutes = timeToMinutes(startTime)
  const endMinutes = timeToMinutes(endTime)

  let durationMinutes: number

  // If endTime < startTime, the slot spans midnight
  if (endMinutes < startMinutes) {
    // Duration = (24 hours - start) + end
    durationMinutes = (24 * 60 - startMinutes) + endMinutes
  }
  else {
    // Normal same-day slot
    durationMinutes = endMinutes - startMinutes
  }

  const durationHours = durationMinutes / 60
  return Math.round(durationHours * 100) / 100
}

// Determine the day type for pricing based on the day of the week
function getDayType(date: Date): 'sunday-thursday' | 'friday-saturday' {
  const dayOfWeek = date.getDay() // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

  // Friday (5) and Saturday (6) are considered weekends
  return (dayOfWeek === 5 || dayOfWeek === 6) ? 'friday-saturday' : 'sunday-thursday'
}

/**
 * Calculate price for a facility booking.
 * Facility pricing is the only source - no turf fallback.
 * Priority: facility pricingRules > facility defaultPricePerSlot (display-only fallback)
 */
export function calculateFacilityPrice(
  facility: IFacility,
  date: Date,
  startTime: string,
  endTime: string,
): PricingCalculationResult {
  const dayType = getDayType(date)
  const durationInHours = calculateDurationInHours(startTime, endTime)

  // Validate facility has pricingRules
  if (!facility.pricingRules || !Array.isArray(facility.pricingRules) || facility.pricingRules.length === 0) {
    throw new Error('Facility must have pricing rules configured')
  }

  // Step 1: Check facility pricingRules (required)
  const applicableSlot = findApplicableTimeSlot(facility.pricingRules, dayType, startTime)
  if (applicableSlot) {
    const totalPrice = applicableSlot.pricePerSlot * durationInHours
    return {
      pricePerSlot: applicableSlot.pricePerSlot,
      totalPrice,
      appliedRule: `facility-${applicableSlot.ruleName}`,
      dayType,
      durationInHours,
    }
  }

  // Step 2: Fallback to defaultPricePerSlot (display-only, should rarely happen)
  // This is only used when no pricing rule matches the time slot
  if (facility.defaultPricePerSlot !== undefined && facility.defaultPricePerSlot !== null && facility.defaultPricePerSlot >= 0) {
    const totalPrice = facility.defaultPricePerSlot * durationInHours
    return {
      pricePerSlot: facility.defaultPricePerSlot,
      totalPrice,
      appliedRule: 'facility-default',
      dayType,
      durationInHours,
    }
  }

  // If no pricing rule matches and no default price, throw error
  throw new Error('No pricing rule found for the specified time slot and no default price configured')
}

