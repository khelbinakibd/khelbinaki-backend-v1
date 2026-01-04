import type { Request, Response } from 'express'
import type { AuthRequest } from '../middlewares/authMiddleware'
import mongoose from 'mongoose'
import { Turf } from '../models/Turf'
import { User } from '../models/User'
import { createTurfSchema, updatedTurfSchema } from '../schemas/turfSchema'
import { createTurf, deactivateTurf, findTurf, findTurfById, updateTurf } from '../services/turfServices'
import { createFacility } from '../services/facilityServices'
import { Facility } from '../models/Facility'
import AppError from '../utils/AppError'
import asyncHandler from '../utils/asyncHandler'
import { paginate } from '../utils/pagination'

// Create turf controller
export const createTurfHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const validate = createTurfSchema.parse(req.body)

  // Validate and convert admin IDs to ObjectIds
  let adminIds: mongoose.Types.ObjectId[] = []

  if (validate.admins && Array.isArray(validate.admins)) {
    // Validate each admin ID
    for (const adminId of validate.admins) {
      // Check if it's a valid ObjectId
      if (!mongoose.Types.ObjectId.isValid(adminId)) {
        throw new AppError(`Invalid admin ID format: ${adminId}`, 400)
      }

      // Check if the admin exists
      const admin = await User.findById(adminId)
      if (!admin) {
        throw new AppError(`Admin not found with ID: ${adminId}`, 404)
      }

      // Check if the user is actually an admin
      if (admin.role !== 'admin' && admin.role !== 'manager') {
        throw new AppError(`User ${adminId} is not an admin or manager`, 400)
      }

      adminIds.push(new mongoose.Types.ObjectId(adminId))
    }
  }

  // If no admins provided or empty array, use the creator (manager) as the admin
  if (adminIds.length === 0) {
    adminIds = [new mongoose.Types.ObjectId(req.user?.id)]
  }

  // Extract facilities from validate (if provided)
  const { facilities, pricingRules, defaultPricePerSlot, ...turfDataWithoutFacilities } = validate

  // Create turf data with properly formatted admin IDs
  // Note: pricingRules and defaultPricePerSlot are removed - all pricing is now at facility level
  const turfData = {
    ...turfDataWithoutFacilities,
    admins: adminIds,
  }

  const turf = await createTurf(turfData as any)

  // Create facilities if provided
  if (facilities && Array.isArray(facilities) && facilities.length > 0) {
    const createdFacilities = []
    for (const facilityData of facilities) {
      try {
        const facility = await createFacility(turf._id.toString(), facilityData)
        createdFacilities.push(facility)
      }
      catch (error: any) {
        // Log error but don't fail turf creation
        console.error(`Failed to create facility ${facilityData.name}:`, error.message)
      }
    }
    // Populate facilities in response
    const turfWithFacilities = await findTurfById(turf._id.toString())
    res.status(201).json({
      message: 'Turf created successfully',
      data: turfWithFacilities,
      facilities: createdFacilities,
    })
    return
  }

  res.status(201).json({
    message: 'Turf created successfully',
    data: turf,
  })
})

// Get all turf controller
export const getAllTurfsHandler = asyncHandler(async (req: Request, res: Response) => {
  // Only active turfs should be public
  const filters = { isActive: true }

  const result = await paginate(Turf, req, filters)

  res.status(200).json({
    message: 'Turfs retrieved successfully.',
    ...result,
  })
})

// Flexible handler that works with both slug and ID
// Public endpoint, but if user is authenticated and accessing for admin purposes, check authorization
export const getTurfFlexibleHandler = asyncHandler(async (req: Request | AuthRequest, res: Response) => {
  const { identifier } = req.params // Can be either slug or ID

  const turf = await findTurf(identifier)

  if (!turf) {
    throw new AppError('Turf not found', 404)
  }

  // If user is authenticated and this is an admin request (check via query param or header)
  // Check authorization for turf admins
  if ('user' in req && req.user) {
    const authReq = req as AuthRequest
    // If user is not a manager, check if they are admin of this turf
    if (authReq.user.role !== 'manager') {
      const isAdminForThisTurf = turf.admins.some(
        adminId => adminId.toString() === authReq.user!.id,
      )
      if (!isAdminForThisTurf) {
        // For public access, still allow but for admin access, require authorization
        // Only block if explicitly an admin request (we'll let frontend handle this)
        // For now, allow access but backend will filter data appropriately
      }
    }
  }

  res.json({
    message: 'Turf retrieved successfully.',
    data: turf,
  })
})

// Update turf controller
export const updateTurfHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id: turfId } = req.params

  const validate = updatedTurfSchema.parse(req.body)

  const existingTurf = await findTurfById(turfId)
  if (!existingTurf) {
    throw new AppError('Turf not found', 404)
  }

  // FIXED: Check if user is authorized to update this turf
  const isAdminForThisTurf = existingTurf.admins.some(
    adminId => adminId.toString() === req.user!.id,
  )

  if (req.user?.role !== 'manager' && !isAdminForThisTurf) {
    throw new AppError('Forbidden: you do not manage this turf', 403)
  }

  // If updating admins, validate them
  if (validate.admins && Array.isArray(validate.admins)) {
    const adminIds: mongoose.Types.ObjectId[] = []

    for (const adminId of validate.admins) {
      if (!mongoose.Types.ObjectId.isValid(adminId)) {
        throw new AppError(`Invalid admin ID format: ${adminId}`, 400)
      }

      const admin = await User.findById(adminId)
      if (!admin) {
        throw new AppError(`Admin not found with ID: ${adminId}`, 404)
      }

      if (admin.role !== 'admin' && admin.role !== 'manager') {
        throw new AppError(`User ${adminId} is not an admin or manager`, 400)
      }

      adminIds.push(new mongoose.Types.ObjectId(adminId))
    }

    validate.admins = adminIds as any
  }

  // If updating name, regenerate slug
  if (validate.name) {
    // eslint-disable-next-line ts/no-require-imports
    const slugify = require('slugify')
    validate.slug = slugify(validate.name, { lower: true, strict: true })
  }

  // Extract facilities from validate (if provided)
  const { facilities, pricingRules, defaultPricePerSlot, ...turfDataWithoutFacilities } = validate

  // Update turf
  // Note: pricingRules and defaultPricePerSlot are removed - all pricing is now at facility level
  const updatedTurf = await updateTurf(turfId, turfDataWithoutFacilities)

  // Handle facilities update if provided
  if (facilities && Array.isArray(facilities)) {
    // Validate: At least one facility required
    if (facilities.length === 0) {
      throw new AppError('At least one facility is required', 400)
    }

    // Validate each facility
    for (const facilityData of facilities) {
      // Validate facility has required fields
      if (!facilityData.name || typeof facilityData.name !== 'string' || facilityData.name.trim().length === 0) {
        throw new AppError('Facility name is required', 400)
      }

      // Validate pricing rules are provided and valid
      if (!facilityData.pricingRules || !Array.isArray(facilityData.pricingRules) || facilityData.pricingRules.length === 0) {
        throw new AppError('Each facility must have at least one pricing rule', 400)
      }

      // Validate each pricing rule
      for (const rule of facilityData.pricingRules) {
        if (!rule.dayType || !['sunday-thursday', 'friday-saturday', 'all-days'].includes(rule.dayType)) {
          throw new AppError('Invalid dayType in pricing rule', 400)
        }
        if (!rule.timeSlots || !Array.isArray(rule.timeSlots) || rule.timeSlots.length === 0) {
          throw new AppError('Each pricing rule must have at least one time slot', 400)
        }
        for (const slot of rule.timeSlots) {
          if (!slot.startTime || !slot.endTime || typeof slot.pricePerSlot !== 'number') {
            throw new AppError('Invalid time slot format', 400)
          }
        }
      }

      // If updating existing facility, validate it belongs to this turf
      if (facilityData._id) {
        const existingFacility = await Facility.findById(facilityData._id)
        if (!existingFacility) {
          throw new AppError(`Facility with ID ${facilityData._id} not found`, 404)
        }
        if (existingFacility.turf.toString() !== turfId) {
          throw new AppError('Cannot update facility that does not belong to this turf', 403)
        }
      }
    }

    // Get existing facilities for this turf
    const existingFacilities = await Facility.find({ turf: turfId })
    const existingFacilityMap = new Map(
      existingFacilities.map(f => [f._id.toString(), f]),
    )

    // Separate facilities into new, existing, and to-delete
    const facilityIdsInRequest = new Set<string>()
    const facilitiesToCreate: any[] = []
    const facilitiesToUpdate: Array<{ id: string, data: any }> = []

    for (const facilityData of facilities) {
      if (facilityData._id && existingFacilityMap.has(facilityData._id)) {
        // Existing facility - update
        facilityIdsInRequest.add(facilityData._id)
        const { _id, ...updateData } = facilityData
        facilitiesToUpdate.push({ id: _id, data: updateData })
      }
      else {
        // New facility - create
        const { _id, ...createData } = facilityData
        facilitiesToCreate.push(createData)
      }
    }

    // Identify facilities to delete (soft delete)
    const facilitiesToDelete = existingFacilities.filter(
      f => !facilityIdsInRequest.has(f._id.toString()),
    )

    // Perform operations
    try {
      // Create new facilities
      for (const facilityData of facilitiesToCreate) {
        await createFacility(turfId, facilityData)
      }

      // Update existing facilities
      for (const { id, data } of facilitiesToUpdate) {
        // Ensure turf field is not changed
        const updateData = { ...data, turf: turfId }
        await Facility.findByIdAndUpdate(id, updateData, { new: true, runValidators: true })
      }

      // Soft delete removed facilities
      for (const facility of facilitiesToDelete) {
        await Facility.findByIdAndUpdate(facility._id, { isActive: false }, { new: true })
      }
    }
    catch (error: any) {
      console.error('Error updating facilities:', error)
      // Re-throw validation errors
      if (error.name === 'ValidationError' || error.message?.includes('pricing rule')) {
        throw new AppError(error.message || 'Facility validation failed', 400)
      }
      throw new AppError('Failed to update facilities', 500)
    }
  }

  // Fetch updated turf with facilities for response
  const turfWithFacilities = await findTurfById(turfId)

  res.json({
    message: 'Turf updated successfully.',
    data: turfWithFacilities,
  })
})

// Deactivate turf controller (soft delete)
export const deleteTurfHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id: turfId } = req.params

  const existingTurf = await findTurfById(turfId)
  if (!existingTurf || !existingTurf.isActive) {
    throw new AppError('Turf not found', 404)
  }

  // Authorization check
  const isAdminForThisTurf = existingTurf.admins.some(
    adminId => adminId.toString() === req.user!.id,
  )

  if (req.user?.role !== 'manager' && !isAdminForThisTurf) {
    throw new AppError('Forbidden: you do not manage this turf', 403)
  }

  await deactivateTurf(turfId)

  res.json({
    message: 'Turf deactivated successfully.',
  })
})

// Get turfs for admin dashboard
export const getAdminTurfsHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  let filters = {}

  // If the user is not a manager, only show turfs where they are admin
  // This includes both role 'admin' and role 'user' who are turf admins
  if (req.user?.role !== 'manager') {
    filters = { admins: req.user!.id }
  }
  // Managers can see all turfs (no filter needed)

  const result = await paginate(Turf, req, filters)

  res.status(200).json({
    message: 'Turfs retrieved successfully.',
    ...result,
  })
})
