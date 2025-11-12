import { z } from 'zod'

export const contactSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: z.string().trim().email('Valid email is required'),
  message: z.string().trim().min(1, 'Message is required'),
})

export const reportSchema = z.object({
  // Legacy fields for turf reports (optional)
  turfId: z.string().trim().optional(),
  reason: z.string().trim().optional(),
  details: z.string().trim().optional(),
  // New fields for website feedback/reports
  name: z.string().trim().min(1, 'Name is required'),
  email: z.string().trim().email('Valid email is required'),
  phone: z.string().trim().optional(),
  subject: z.string().trim().min(1, 'Subject is required'),
  message: z.string().trim().min(1, 'Message is required'),
  reportType: z.enum(['bug', 'security', 'abuse', 'privacy', 'other', 'website', 'turf_issue']).default('other'),
}).superRefine((data, ctx) => {
  // Only turf_issue reports require a specific turf to be selected
  if (data.reportType === 'turf_issue' && (!data.turfId || data.turfId.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Please select the turf this report is about',
      path: ['turfId'],
    })
  }
})

export type ContactInput = z.infer<typeof contactSchema>
export type ReportInput = z.infer<typeof reportSchema>
