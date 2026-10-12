import type { Response } from 'express'
import type { AuthRequest } from '../middlewares/authMiddleware'
import { createMaintenanceBlockSchema, releaseMaintenanceBlockSchema } from '../schemas/maintenanceSchema'
import { createMaintenanceBlock, listMaintenanceBlocks, releaseMaintenanceBlock } from '../services/maintenanceService'
import asyncHandler from '../utils/asyncHandler'

export const listMaintenanceBlocksHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await listMaintenanceBlocks(req.params.facilityId, req.user!, req.query)
  res.json({ message: 'Maintenance blocks retrieved successfully.', data })
})
export const createMaintenanceBlockHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await createMaintenanceBlock(req.params.facilityId, req.user!, createMaintenanceBlockSchema.parse(req.body))
  res.status(201).json({ message: 'Maintenance block created successfully.', data })
})
export const releaseMaintenanceBlockHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { reason } = releaseMaintenanceBlockSchema.parse(req.body ?? {})
  const data = await releaseMaintenanceBlock(req.params.facilityId, req.params.blockId, req.user!, reason)
  res.json({ message: 'Maintenance block released successfully.', data })
})
