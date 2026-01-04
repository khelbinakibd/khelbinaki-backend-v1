import type { IFacility } from '../models/Facility'
import { Facility } from '../models/Facility'
import { Turf } from '../models/Turf'
import AppError from '../utils/AppError'
import mongoose from 'mongoose'

// Create facility for a turf
export async function createFacility(turfId: string, data: Partial<IFacility>) {
  if (!mongoose.Types.ObjectId.isValid(turfId)) {
    throw new AppError('Invalid turf ID', 400)
  }

  // Verify turf exists
  const turf = await Turf.findById(turfId)
  if (!turf) {
    throw new AppError('Turf not found', 404)
  }

  // Check for duplicate facility names within the same turf
  const existingFacility = await Facility.findOne({
    turf: turfId,
    name: data.name,
  })

  if (existingFacility) {
    throw new AppError(`A facility with the name "${data.name}" already exists for this turf`, 409)
  }

  // Validate that pricingRules are provided (required)
  if (!data.pricingRules || !Array.isArray(data.pricingRules) || data.pricingRules.length === 0) {
    throw new AppError('Facility must have at least one pricing rule', 400)
  }

  const facilityData = {
    ...data,
    turf: turfId,
  }

  const facility = await Facility.create(facilityData)
  return facility
}

// Find all facilities for a turf
export async function findFacilitiesByTurf(turfId: string, activeOnly?: boolean) {
  if (!mongoose.Types.ObjectId.isValid(turfId)) {
    return []
  }

  const query: any = { turf: turfId }
  if (activeOnly) {
    query.isActive = true
  }

  return Facility.find(query).sort({ name: 1 })
}

// Find facility by ID
export async function findFacilityById(facilityId: string) {
  if (!mongoose.Types.ObjectId.isValid(facilityId)) {
    return null
  }
  return Facility.findById(facilityId).populate('turf', 'name')
}

// Find facility by turf and ID (for validation)
export async function findFacilityByTurfAndId(turfId: string, facilityId: string) {
  if (!mongoose.Types.ObjectId.isValid(turfId) || !mongoose.Types.ObjectId.isValid(facilityId)) {
    return null
  }
  return Facility.findOne({ _id: facilityId, turf: turfId })
}

// Update facility
export async function updateFacility(facilityId: string, data: mongoose.UpdateQuery<IFacility>) {
  if (!mongoose.Types.ObjectId.isValid(facilityId)) {
    throw new AppError('Invalid facility ID', 400)
  }

  const facility = await Facility.findById(facilityId)
  if (!facility) {
    throw new AppError('Facility not found', 404)
  }

  // If updating name, check for duplicates within the same turf
  if (data.name && data.name !== facility.name) {
    const existingFacility = await Facility.findOne({
      turf: facility.turf,
      name: data.name,
      _id: { $ne: facilityId },
    })

    if (existingFacility) {
      throw new AppError(`A facility with the name "${data.name}" already exists for this turf`, 409)
    }
  }

  // If updating pricingRules, validate they are provided and not empty
  if (data.pricingRules !== undefined) {
    if (!Array.isArray(data.pricingRules) || data.pricingRules.length === 0) {
      throw new AppError('Facility must have at least one pricing rule', 400)
    }
  }

  return Facility.findByIdAndUpdate(facilityId, data, { new: true, runValidators: true })
}

// Delete facility (soft delete by default)
export async function deleteFacility(facilityId: string, hardDelete = false) {
  if (!mongoose.Types.ObjectId.isValid(facilityId)) {
    throw new AppError('Invalid facility ID', 400)
  }

  const facility = await Facility.findById(facilityId)
  if (!facility) {
    throw new AppError('Facility not found', 404)
  }

  if (hardDelete) {
    // Check if facility has any bookings
    const { Booking } = await import('../models/Booking')
    const bookingCount = await Booking.countDocuments({ facility: facilityId })

    if (bookingCount > 0) {
      throw new AppError('Cannot delete facility with existing bookings. Use soft delete instead.', 400)
    }

    return Facility.findByIdAndDelete(facilityId)
  }
  else {
    // Soft delete: set isActive to false
    return Facility.findByIdAndUpdate(facilityId, { isActive: false }, { new: true })
  }
}

