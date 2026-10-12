import type { IBooking } from '../models/Booking'
import mongoose from 'mongoose'
import { Booking } from '../models/Booking'
import { Facility } from '../models/Facility'
import AppError from '../utils/AppError'
import { withFacilityOccupancyGuard } from './facilityOccupancyGuard'
import type { OccupancyActor } from './occupancyService'
import { ACTIVE_BOOKING_STATUSES, assertSlotUnoccupied, authorizeTurfOccupancy } from './occupancyService'

export async function createGuardedBooking(data: Partial<IBooking>, actor: OccupancyActor) {
  if (!data.facility || !data.turf || !data.date || !data.startTime || !data.endTime)
    throw new AppError('Facility, turf, date and time are required', 400)
  const facilityId = new mongoose.Types.ObjectId(String(data.facility))
  const turfId = new mongoose.Types.ObjectId(String(data.turf))
  const booking = await withFacilityOccupancyGuard(facilityId, turfId, async (session) => {
    const facility = await Facility.findById(facilityId).session(session)
    if (!facility?.isActive)
      throw new AppError('Facility is not active', 400)
    if (data.isManual)
      await authorizeTurfOccupancy(actor, turfId, session)
    else if (String(data.user) !== actor.id)
      throw new AppError('Forbidden: you cannot create a booking for this user', 403)
    await assertSlotUnoccupied(facilityId, {
      date: data.date!, startTime: data.startTime!, endTime: data.endTime!,
    }, session, undefined, data.isManual)
    const [created] = await Booking.create([data], { session })
    return created
  })
  booking.$session(null)
  return booking
}

export type BookingMutation =
  | { kind: 'status', status: 'pending' | 'confirmed' | 'cancelled' }
  | { kind: 'cancel-own' | 'cancel-admin' | 'paid' | 'approve' | 'delete' }

/** Outside read is used only to select the immutable guard reference. All
 * authorization, business validation and occupancy checks use fresh session reads.
 */
export async function mutateBookingOccupancy(bookingId: string, actor: OccupancyActor, mutation: BookingMutation) {
  const reference = await Booking.findById(bookingId).select('facility turf')
  if (!reference)
    throw new AppError('Booking not found', 404)
  if (!reference.facility || !reference.turf)
    throw new AppError('Cannot change occupancy of legacy bookings without a facility; run the offline migration first', 409)

  const result = await withFacilityOccupancyGuard(reference.facility, reference.turf, async (session) => {
    const booking = await Booking.findById(bookingId).session(session)
    if (!booking)
      throw new AppError('Booking not found', 404)
    if (!booking.facility?.equals(reference.facility) || !booking.turf.equals(reference.turf))
      throw new AppError('Booking facility changed; retry the request', 409)

    if (mutation.kind === 'cancel-own') {
      if (booking.user.toString() !== actor.id)
        throw new AppError('Forbidden: You are not authorized to cancel this booking.', 403)
      if (booking.status !== 'pending')
        throw new AppError('Only pending bookings can be cancelled.', 400)
      booking.status = 'cancelled'
    }
    else {
      const forbiddenMessage = {
        status: 'Forbidden: You are not authorized to perform this action.',
        'cancel-admin': 'Forbidden: You are not authorized to cancel this booking.',
        paid: 'Forbidden: You are not authorized to modify this booking.',
        approve: 'Forbidden: you do not manage this turf',
        delete: 'Forbidden: You are not authorized to delete this booking.',
      }[mutation.kind]
      await authorizeTurfOccupancy(actor, booking.turf, session, forbiddenMessage)
      if (mutation.kind === 'delete') {
        await Booking.deleteOne({ _id: booking._id }, { session })
        return booking
      }
      if (mutation.kind === 'status') {
        if (mutation.status === 'confirmed' && booking.paymentStatus !== 'paid')
          throw new AppError('Cannot confirm booking without successful payment', 400)
        booking.status = mutation.status
      }
      else if (mutation.kind === 'cancel-admin') {
        if (booking.status === 'cancelled')
          throw new AppError('Booking is already cancelled', 400)
        booking.$locals.refundRequired = booking.paymentStatus === 'paid'
        booking.status = 'cancelled'
        if (booking.paymentStatus === 'paid')
          booking.paymentStatus = 'refunded'
      }
      else if (mutation.kind === 'approve') {
        if (booking.paymentStatus === 'paid')
          throw new AppError('Booking is already paid and confirmed', 400)
        booking.paymentStatus = 'paid'
        booking.status = 'confirmed'
      }
      else if (mutation.kind === 'paid') {
        booking.paymentStatus = 'paid'
        if (booking.status === 'pending')
          booking.status = 'confirmed'
      }
    }

    if (ACTIVE_BOOKING_STATUSES.includes(booking.status)) {
      await assertSlotUnoccupied(booking.facility, booking, session, booking._id as mongoose.Types.ObjectId)
    }
    // Paid/confirmed records must not retain a legacy automatic-deletion deadline.
    // The actual TTL index migration is still an independent deployment prerequisite.
    if (booking.status === 'confirmed' || booking.paymentStatus === 'paid')
      booking.expiresAt = undefined
    await booking.save({ session })
    return booking
  })
  result.$session(null)
  return result
}
