import { z } from 'zod'
import { isValidDateKey, timeToMinutes } from '../utils/businessTime'

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid time format, expected HH:mm')
export const createMaintenanceBlockSchema = z.object({
  date: z.string().refine(isValidDateKey, 'Invalid date; expected a real date in YYYY-MM-DD format'),
  startTime: time,
  endTime: time,
  reason: z.string().trim().max(500).optional(),
}).superRefine((data, ctx) => {
  if (time.safeParse(data.startTime).success && time.safeParse(data.endTime).success
    && timeToMinutes(data.endTime) <= timeToMinutes(data.startTime)) {
    ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'End time must be after start time; overnight maintenance intervals are not supported' })
  }
})
export const releaseMaintenanceBlockSchema = z.object({
  reason: z.string().trim().max(500).optional(),
})
export const listMaintenanceBlocksSchema = z.object({
  date: z.string().refine(isValidDateKey, 'Invalid date; expected YYYY-MM-DD').optional(),
  includeReleased: z.enum(['true', 'false']).default('false'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  skip: z.coerce.number().int().min(0).default(0),
})
