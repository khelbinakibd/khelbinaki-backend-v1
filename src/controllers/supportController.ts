import type { Response } from 'express'
import type { AuthRequest } from '../middlewares/authMiddleware'
import { contactSchema, reportSchema } from '../schemas/supportSchema'
import { createContactMessage, createReport } from '../services/supportServices'
import asyncHandler from '../utils/asyncHandler'

export const submitContact = asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = contactSchema.parse(req.body)
  const saved = await createContactMessage(input)
  res.status(201).json({ success: true, message: 'Message received', data: saved })
})

export const submitReport = asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = reportSchema.parse(req.body)
  const saved = await createReport({ ...input, userId: req.user?.id })
  res.status(201).json({ success: true, message: 'Report submitted', data: saved })
})
