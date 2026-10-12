import type { ClientSession, Types } from 'mongoose'
import { Booking } from '../models/Booking'
import { MaintenanceBlock } from '../models/MaintenanceBlock'
import { Turf } from '../models/Turf'
import AppError from '../utils/AppError'
import { addDaysToDateKey, dhakaDateStart, dhakaDateTimeToInstant, getDhakaDateKey } from '../utils/businessTime'

export interface OccupancyActor { id: string, role: 'user' | 'admin' | 'manager' }
export interface OccupancySlot { date: Date, startTime: string, endTime: string }
export const ACTIVE_BOOKING_STATUSES = ['pending', 'confirmed']

export function assertTurfAssignment(actor: OccupancyActor, admins: Types.ObjectId[], message = 'Forbidden: you do not manage this turf') {
  if (actor.role !== 'manager' && !admins.some(id => id.toString() === actor.id))
    throw new AppError(message, 403)
}

export async function authorizeTurfOccupancy(actor: OccupancyActor, turfId: Types.ObjectId, session?: ClientSession, forbiddenMessage?: string) {
  const turf = await Turf.findById(turfId).session(session ?? null)
  if (!turf)
    throw new AppError('Associated turf not found', 404)
  assertTurfAssignment(actor, turf.admins, forbiddenMessage)
  return turf
}

// Legacy bookings may span midnight. Compare absolute Dhaka instants so a
// previous day's overnight booking also conflicts with the next day's block.
export function occupancyInterval(slot: OccupancySlot) {
  const dateKey = getDhakaDateKey(slot.date)
  const start = dhakaDateTimeToInstant(dateKey, slot.startTime).getTime()
  let end = dhakaDateTimeToInstant(dateKey, slot.endTime).getTime()
  if (end <= start)
    end = dhakaDateTimeToInstant(addDaysToDateKey(dateKey, 1), slot.endTime).getTime()
  return { start, end }
}

export function slotsOverlap(a: OccupancySlot, b: OccupancySlot) {
  const first = occupancyInterval(a)
  const second = occupancyInterval(b)
  return first.start < second.end && second.start < first.end
}

export function occupancyDateWindow(dateKey: string) {
  return { $gte: dhakaDateStart(addDaysToDateKey(dateKey, -1)), $lt: dhakaDateStart(addDaysToDateKey(dateKey, 2)) }
}

export async function assertSlotUnoccupied(
  facility: Types.ObjectId,
  slot: OccupancySlot,
  session: ClientSession,
  excludeBooking?: Types.ObjectId,
  manual = false,
) {
  const date = occupancyDateWindow(getDhakaDateKey(slot.date))
  const bookings = await Booking.find({
    facility, date, status: { $in: ACTIVE_BOOKING_STATUSES },
    ...(excludeBooking ? { _id: { $ne: excludeBooking } } : {}),
  }).select('date startTime endTime status').session(session)
  for (const booking of bookings) {
    if (slotsOverlap(slot, booking)) {
      throw new AppError(manual
        ? 'This time slot is already booked or temporarily reserved'
        : booking.status === 'confirmed'
          ? 'This time slot is already booked and confirmed'
          : 'This time slot is pending approval. Please try another slot.', 409)
    }
  }
  const blocks = await MaintenanceBlock.find({ facility, date, releasedAt: null })
    .select('date startTime endTime').session(session)
  if (blocks.some(block => slotsOverlap(slot, block)))
    throw new AppError('This time slot is unavailable due to maintenance', 409)
}
