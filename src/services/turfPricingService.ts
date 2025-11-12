import type { IPricingRule, ITimeSlot, ITurf } from '../models/Turf'

export interface PricingCalculationResult {
  pricePerSlot: number
  totalPrice: number
  appliedRule: string
  dayType: 'sunday-thursday' | 'friday-saturday'
  durationInHours: number
}

// Determine the day type for pricing based on the day of the week
function getDayType(date: Date): 'sunday-thursday' | 'friday-saturday' {
  const dayOfWeek = date.getDay() // 0 = Sunday, 1 = Saturday and so on

  // Friday (5) and Saturday (6) are considered weekends
  return (dayOfWeek === 5 || dayOfWeek === 6) ? 'friday-saturday' : 'sunday-thursday'
}

// Calculate the duration between two time string in hours
function calculateDurationInHours(startTime: string, endTime: string): number {
  const start = new Date(`1970-01-01T${startTime}:00`)
  const end = new Date(`1970-01-01T${endTime}:00`)

  const diffMilliseconds = end.getTime() - start.getTime()
  return Math.round((diffMilliseconds / (1000 * 60 * 60)) * 100) / 100
}

// Finds the applicable pricing rule for a given day type and start time.
function findApplicableTimeSlot(
  pricingRules: IPricingRule[],
  dayType: 'sunday-thursday' | 'friday-saturday',
  startTime: string,
): (ITimeSlot & { ruleName: string }) | null {
  // Prioritize a rule specific to the dayType, then fall back to an 'all-days' rule.
  let applicableRule = pricingRules.find(rule => rule.dayType === dayType)

  if (!applicableRule) {
    applicableRule = pricingRules.find(rule => rule.dayType === 'all-days')
  }

  if (!applicableRule) {
    return null // No rule found for this day type or for 'all-days'.
  }

  const bookingStartTime = new Date(`1970-01-01T${startTime}:00`).getTime()

  for (const slot of applicableRule.timeSlots) {
    const slotStartTime = new Date(`1970-01-01T${slot.startTime}:00`).getTime()
    const slotEndTime = new Date(`1970-01-01T${slot.endTime}:00`).getTime()

    if (bookingStartTime >= slotStartTime && bookingStartTime < slotEndTime) {
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

// Calculates the final price for a booking based on the turf's flexible pricing rules.

export function calculateBookingPrice(
  turf: ITurf,
  date: Date,
  startTime: string,
  endTime: string,
): PricingCalculationResult {
  const dayType = getDayType(date)
  const durationInHours = calculateDurationInHours(startTime, endTime)

  // Ensure turf.pricingRules is treated as an array before passing.
  const rules = Array.isArray(turf.pricingRules) ? turf.pricingRules : []
  const applicableSlot = findApplicableTimeSlot(rules, dayType, startTime)

  const pricePerSlot = applicableSlot ? applicableSlot.pricePerSlot : turf.defaultPricePerSlot
  const totalPrice = pricePerSlot * durationInHours

  return {
    pricePerSlot,
    totalPrice,
    appliedRule: applicableSlot ? applicableSlot.ruleName : 'default',
    dayType,
    durationInHours,
  }
}
