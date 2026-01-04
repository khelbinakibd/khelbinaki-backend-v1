import type { ITurf } from '../models/Turf'
import mongoose from 'mongoose'
import { Turf } from '../models/Turf'
import { Facility } from '../models/Facility'

// Creating new turf service
export async function createTurf(data: Partial<ITurf>) {
  const newTurf = await Turf.create(data)
  return newTurf
}

// Find indibiddual turf by id service
export async function findTurfById(id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return null
  }
  const turf = await Turf.findById(id).populate('admins', 'name email').lean()
  
  if (!turf) {
    return null
  }

  // Fetch facilities for this turf and attach to turf object
  const facilities = await Facility.find({ turf: id }).lean()
  
  // Convert to plain object and attach facilities
  return {
    ...turf,
    facilities: facilities || [],
  }
}

// Find turf by slug
export async function findTurfBySlug(slug: string) {
  if (!slug || typeof slug !== 'string') {
    return null
  }
  return Turf.findOne({ slug, isActive: true }).populate('admins', 'name email')
}

//  Get turf by ID or slug (flexible function)
export async function findTurf(identifier: string) {
  let turf
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    turf = await Turf.findById(identifier).lean()
  }
  else {
    turf = await Turf.findOne({ slug: identifier }).lean()
  }

  if (!turf) {
    return null
  }

  // Fetch facilities for this turf and attach to turf object
  const facilities = await Facility.find({ turf: turf._id }).lean()
  
  // Convert to plain object and attach facilities
  return {
    ...turf,
    facilities: facilities || [],
  }
}

// Update turf services
export async function updateTurf(id: string, data: mongoose.UpdateQuery<ITurf>) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return null
  }

  return Turf.findByIdAndUpdate(id, data, { new: true })
}

// Remove turf service
export async function deactivateTurf(id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return null
  }

  return Turf.findByIdAndUpdate(id, { isActive: false }, { new: true })
}
