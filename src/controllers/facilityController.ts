import type { Request, Response } from 'express'
import type { AuthRequest } from '../middlewares/authMiddleware'
import { Turf } from '../models/Turf'
import { createFacilitySchema, updateFacilitySchema } from '../schemas/facilitySchema'
import {
  createFacility,
  deleteFacility,
  findFacilityById,
  findFacilitiesByTurf,
  findFacilityByTurfAndId,
  updateFacility,
} from '../services/facilityServices'
import AppError from '../utils/AppError'
import asyncHandler from '../utils/asyncHandler'

// GET /api/turfs/:turfId/facilities
export const getFacilitiesByTurfHandler = asyncHandler(async (req: Request, res: Response) => {
  const { turfId } = req.params
  const { activeOnly } = req.query

  // Validate turf exists
  const turf = await Turf.findById(turfId)
  if (!turf) {
    throw new AppError('Turf not found', 404)
  }

  const activeOnlyBool = activeOnly === 'true' || activeOnly === true
  const facilities = await findFacilitiesByTurf(turfId, activeOnlyBool)

  res.status(200).json({
    message: 'Facilities retrieved successfully',
    data: facilities,
  })
})

// POST /api/turfs/:turfId/facilities
export const createFacilityHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { turfId } = req.params
  const validatedData = createFacilitySchema.parse(req.body)

  // Validate turf exists
  const turf = await Turf.findById(turfId)
  if (!turf) {
    throw new AppError('Turf not found', 404)
  }

  // Check authorization: user must be manager or admin of this turf
  const isAdminForThisTurf = turf.admins.some(
    adminId => adminId.toString() === req.user!.id,
  )

  if (req.user?.role !== 'manager' && !isAdminForThisTurf) {
    throw new AppError('Forbidden: you do not manage this turf', 403)
  }

  const facility = await createFacility(turfId, validatedData)

  res.status(201).json({
    message: 'Facility created successfully',
    data: facility,
  })
})

// GET /api/facilities/:facilityId
export const getFacilityHandler = asyncHandler(async (req: Request, res: Response) => {
  const { facilityId } = req.params

  const facility = await findFacilityById(facilityId)
  if (!facility) {
    throw new AppError('Facility not found', 404)
  }

  res.status(200).json({
    message: 'Facility retrieved successfully',
    data: facility,
  })
})

// PUT /api/facilities/:facilityId
export const updateFacilityHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { facilityId } = req.params
  const validatedData = updateFacilitySchema.parse(req.body)

  const facility = await findFacilityById(facilityId)
  if (!facility) {
    throw new AppError('Facility not found', 404)
  }

  // Check authorization: user must be manager or admin of the turf
  const turf = await Turf.findById(facility.turf)
  if (!turf) {
    throw new AppError('Associated turf not found', 404)
  }

  const isAdminForThisTurf = turf.admins.some(
    adminId => adminId.toString() === req.user!.id,
  )

  if (req.user?.role !== 'manager' && !isAdminForThisTurf) {
    throw new AppError('Forbidden: you do not manage this turf', 403)
  }

  const updatedFacility = await updateFacility(facilityId, validatedData)

  res.status(200).json({
    message: 'Facility updated successfully',
    data: updatedFacility,
  })
})

// DELETE /api/facilities/:facilityId
export const deleteFacilityHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { facilityId } = req.params
  const { hardDelete } = req.query

  const facility = await findFacilityById(facilityId)
  if (!facility) {
    throw new AppError('Facility not found', 404)
  }

  // Check authorization: user must be manager or admin of the turf
  const turf = await Turf.findById(facility.turf)
  if (!turf) {
    throw new AppError('Associated turf not found', 404)
  }

  const isAdminForThisTurf = turf.admins.some(
    adminId => adminId.toString() === req.user!.id,
  )

  if (req.user?.role !== 'manager' && !isAdminForThisTurf) {
    throw new AppError('Forbidden: you do not manage this turf', 403)
  }

  const hardDeleteBool = hardDelete === 'true' || hardDelete === true
  await deleteFacility(facilityId, hardDeleteBool)

  res.status(200).json({
    message: hardDeleteBool ? 'Facility deleted successfully' : 'Facility deactivated successfully',
  })
})

