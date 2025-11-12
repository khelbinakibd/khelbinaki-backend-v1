import { env } from '../config/env'
import { ContactMessage } from '../models/ContactMessage'
import { Report } from '../models/Report'
import { logger } from '../utils/logger'
import { sendTemplatedEmail } from './emailServices'

export async function createContactMessage(data: { name: string, email: string, message: string }) {
  const doc = await ContactMessage.create(data)

  // Send notification email to admin/manager
  try {
    await sendTemplatedEmail({
      to: env.MANAGER_EMAIL,
      subject: 'New Contact Message Received',
      title: 'New Contact Message',
      body: `
        <p><strong>Name:</strong> ${data.name}</p>
        <p><strong>Email:</strong> ${data.email}</p>
        <p><strong>Message:</strong></p>
        <div style="background:#f9f9f9;padding:12px;border-radius:6px;border:1px solid #eee;">${data.message.replace(/\n/g, '<br/>')}</div>
      `,
    })
  }
  catch (err) {
    // Log but don't block user
    logger.error('Failed to send contact notification email', { error: err })
  }

  return doc
}

export async function createReport(data: {
  name: string
  email: string
  phone?: string
  subject: string
  message: string
  reportType: 'bug' | 'security' | 'abuse' | 'privacy' | 'other' | 'website' | 'turf_issue'
  // Legacy fields for turf reports
  turfId?: string
  reason?: string
  details?: string
  userId?: string
}) {
  const payload: any = {
    name: data.name,
    email: data.email,
    phone: data.phone || '',
    subject: data.subject,
    message: data.message,
    reportType: data.reportType || 'other',
    status: 'open',
  }

  // Add legacy fields if provided
  if (data.turfId)
    payload.turfId = data.turfId
  if (data.reason)
    payload.reason = data.reason
  if (data.details)
    payload.details = data.details
  if (data.userId)
    payload.userId = data.userId

  const doc = await Report.create(payload)
  return doc
}

export async function getReports(filters?: {
  status?: string
  reportType?: string
  turfIds?: string[]
  limit?: number
  skip?: number
}) {
  const query: any = {}

  if (filters?.status) {
    query.status = filters.status
  }
  if (filters?.reportType) {
    query.reportType = filters.reportType
  }

  // If turfIds are provided (for turf admins), only show turf_issue reports for their turfs
  if (filters?.turfIds && filters.turfIds.length > 0) {
    query.reportType = 'turf_issue' // Only turf issues
    query.turfId = { $in: filters.turfIds } // Only their turfs
  }

  const limit = filters?.limit || 50
  const skip = filters?.skip || 0

  const [reports, total] = await Promise.all([
    Report.find(query)
      .populate('userId', 'name email phone')
      .populate('turfId', 'name slug admins')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip),
    Report.countDocuments(query),
  ])

  return { reports, total, limit, skip }
}

export async function getReportById(reportId: string) {
  const report = await Report.findById(reportId)
    .populate('userId', 'name email phone')
    .populate('turfId', 'name slug admins')
  return report
}

export async function deleteReport(reportId: string) {
  const result = await Report.findByIdAndDelete(reportId)
  return result
}

export async function updateReportStatus(reportId: string, status: 'open' | 'in_review' | 'resolved' | 'closed') {
  const report = await Report.findByIdAndUpdate(
    reportId,
    { status },
    { new: true },
  )
  return report
}
