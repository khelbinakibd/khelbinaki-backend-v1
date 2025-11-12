import type { Response } from 'express'
import type { Types } from 'mongoose'
import type { AuthRequest } from '../middlewares/authMiddleware'
import { Booking } from '../models/Booking'
import { Turf } from '../models/Turf'
import { User } from '../models/User'
import { createAdminManualBookingSchema } from '../schemas/bookingSchema'
import { createAdminSchema, updateUserSchema, updateUserStatusSchema } from '../schemas/userSchema'
import { createBooking } from '../services/bookingServices'
import { getAdminDashboardStats, getManagerDashboardStats } from '../services/dashboardService'
import { sendBookingConfirmationEmail } from '../services/emailServices'
import { deleteReport, getReportById, getReports, updateReportStatus } from '../services/supportServices'
import { calculateBookingPrice } from '../services/turfPricingService'
import { findTurfById, updateTurf } from '../services/turfServices'
import { uploadToCloudinary } from '../services/uploadService'
import { updateUserById } from '../services/userServices'
import AppError from '../utils/AppError'
import asyncHandler from '../utils/asyncHandler'
import { paginate } from '../utils/pagination'

function ensureAdminCanAccessReport(req: AuthRequest, report: any) {
  if (req.user?.role !== 'admin') {
    return
  }

  const turf = report.turfId as { admins?: Types.ObjectId[] } | undefined
  const admins = turf?.admins || []
  const manages = Array.isArray(admins) && admins.some((adminId: Types.ObjectId) => adminId.toString() === req.user!.id)

  if (!manages) {
    throw new AppError('Forbidden: you do not manage this turf report', 403)
  }
}

// POST /api/v1/users/admin
export const createAdminHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name, email, password, phone } = createAdminSchema.parse(req.body)

  // Check if an admin with this email already exists
  const existingUser = await User.findOne({ email })
  if (existingUser) {
    throw new AppError('A user with this email already exists.', 409)
  }

  // Create the new user with the 'admin' role
  const adminUser = await User.create({ name, email, password, phone, role: 'admin', isVerified: true })

  // Exclude password from the response
  const { password: _, ...userResponse } = adminUser.toObject()

  // FIXED: Return the full user object including _id
  res.status(201).json({
    message: 'Admin account created successfully.',
    user: userResponse,
    // Make sure _id is explicitly included
    adminId: adminUser._id,
  })
})

// PATCH /api/v1/users/:id/status
export const updateUserStatusHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { isActive } = updateUserStatusSchema.parse(req.body)
  const { id: userId } = req.params

  if (req.user?.id === userId) {
    throw new AppError('You cannot deactivate your own account', 400)
  }

  const user = await User.findById(userId)

  if (!user) {
    throw new AppError('User not found', 404)
  }

  user.isActive = isActive
  await user.save()

  const { password: _, ...userResponse } = user.toObject()

  res.status(200).json({
    message: `User account has been ${isActive ? 'activated' : 'deactivated'}.`,
    user: userResponse,
  })
})

// GET /api/v1/admin/dashboard
export const getAdminDashboardHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  let stats

  // if the user is a manager, get platform-wide stats.
  if (req.user!.role === 'manager') {
    stats = await getManagerDashboardStats()
  }
  else {
    // otherwise, get stats only for the turfs this admin manages
    const adminId = req.user!.id
    stats = await getAdminDashboardStats(adminId)
  }

  res.status(200).json({
    message: 'Dashboard statistics retrieved successfully.',
    data: stats,
  })
})

// GET /api/v1/admin/users
export const getAllUsersHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await paginate(User, req)

  res.status(200).json({
    message: 'Users retrieved successfully.',
    ...result,
  })
})

// PATCH /api/v1/admin/users/:id
export const updateUserHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id: userId } = req.params
  const validatedData = updateUserSchema.parse(req.body)

  if (Object.keys(validatedData).length === 0) {
    throw new AppError('No update data provided.', 400)
  }

  // Prevent a manager from accidentally deactivating or changing their own role
  if (req.user?.id === userId) {
    throw new AppError('Managers cannot alter their own status or role.', 403)
  }

  const updatedUser = await updateUserById(userId, validatedData)

  if (!updatedUser) {
    throw new AppError('User not found.', 404)
  }

  res.status(200).json({
    message: 'User updated successfully.',
    data: updatedUser,
  })
})

// PATCH /api/v1/admin/turfs/:id/image
export const uploadTurfImageHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id: turfId } = req.params

  console.log('📸 Image upload request for turf:', turfId)
  console.log('📸 File received:', req.file ? 'Yes' : 'No')

  if (!req.file) {
    throw new AppError('No image file provided', 400)
  }

  const turf = await findTurfById(turfId)
  if (!turf) {
    console.error('❌ Turf not found:', turfId)
    throw new AppError('Turf not found.', 404)
  }

  console.log('✅ Turf found:', turf.name)

  // Authorization check
  const isAdminForThisTurf = turf.admins.some(adminId => adminId.equals(req.user!.id))
  if (req.user?.role !== 'manager' && !isAdminForThisTurf) {
    throw new AppError('Forbidden: you do not manage this turf.', 403)
  }

  console.log('📤 Uploading to Cloudinary...')

  // Upload the file to Cloudinary in a 'turfs' folder
  const imageUrl = await uploadToCloudinary(req.file, 'turfs')

  console.log('✅ Image uploaded:', imageUrl)

  // Add the new image URL to the turf's images array
  const updatedTurf = await updateTurf(turfId, { $push: { images: imageUrl } })

  console.log('✅ Turf updated with new image')

  res.status(200).json({
    message: 'Image uploaded and turf updated successfully.',
    data: updatedTurf,
    imageUrl, // Return the image URL for frontend reference
  })
})

// NEW: GET /api/v1/admin/bookings - Get bookings for admin's turfs only
export const getAdminBookingsHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  let turfIds: string[]

  if (req.user!.role === 'manager') {
    // Manager can see all bookings
    const allTurfs = await Turf.find({ isActive: true }).select('_id').lean<{ _id: Types.ObjectId }[]>()
    turfIds = allTurfs.map(turf => turf._id.toString())
  }
  else {
    // Admin can only see their turf bookings
    const adminTurfs = await Turf.find({ admins: req.user!.id }).select('_id').lean<{ _id: Types.ObjectId }[]>()
    turfIds = adminTurfs.map(turf => turf._id.toString())

    if (turfIds.length === 0) {
      return res.status(200).json({
        message: 'No turfs assigned to you.',
        data: [],
        meta: {
          totalItems: 0,
          totalPage: 0,
          currentPage: 1,
          itemsPerPage: 10,
        },
      })
    }
  }

  const result = await paginate(
    Booking,
    req,
    { turf: { $in: turfIds } },
  )

  // Populate the results
  const populatedData = await Booking.populate(result.data, [
    { path: 'user', select: 'name email phone' },
    { path: 'turf', select: 'name location' },
  ])

  res.status(200).json({
    message: 'Bookings retrieved successfully.',
    data: populatedData,
    meta: result.meta,
  })
})

// NEW: POST /api/v1/admin/bookings - Create booking (for walk-ins, phone bookings)
export const createAdminBookingHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const validatedInput = createAdminManualBookingSchema.parse(req.body)
  const { userId } = validatedInput // Admin can book for specific user

  const turf = await findTurfById(validatedInput.turf)
  if (!turf) {
    throw new AppError('Turf not found', 404)
  }

  // Check admin permissions for this turf
  const isAdminForThisTurf = turf.admins.some(adminId => adminId.equals(req.user!.id))
  if (req.user!.role !== 'manager' && !isAdminForThisTurf) {
    throw new AppError('Forbidden: you do not manage this turf', 403)
  }

  // Check if user exists (if booking for someone else)
  if (userId) {
    const user = await User.findById(userId)
    if (!user) {
      throw new AppError('User not found', 404)
    }
  }

  // Check slot availability (same logic as regular booking)
  // Must check if the entire time range overlaps with existing bookings
  const timeToMinutes = (timeString: string): number => {
    const [hours, minutes] = timeString.split(':').map(Number)
    return hours * 60 + minutes
  }

  const newBookingStart = timeToMinutes(validatedInput.startTime)
  const newBookingEnd = timeToMinutes(validatedInput.endTime)

  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000)
  const potentialConflicts = await Booking.find({
    turf: validatedInput.turf,
    date: validatedInput.date,
    $or: [
      { status: 'confirmed' },
      {
        status: 'pending',
        createdAt: { $gte: fifteenMinutesAgo },
      },
    ],
  }).select('startTime endTime status createdAt')

  for (const booking of potentialConflicts) {
    const existingStart = timeToMinutes(booking.startTime)
    const existingEnd = timeToMinutes(booking.endTime)

    // Overlap occurs if: new booking starts before existing ends AND new booking ends after existing starts
    if (newBookingStart < existingEnd && newBookingEnd > existingStart) {
      throw new AppError('This time slot is already booked or temporarily reserved', 409)
    }
  }

  // Calculate pricing
  const pricingDetails = calculateBookingPrice(turf, validatedInput.date, validatedInput.startTime, validatedInput.endTime)

  // Admin manual bookings are immediately confirmed and marked manual
  const bookingData = {
    ...validatedInput,
    user: userId || req.user!.id, // Book for specified user or admin themselves
    appliedPricePerSlot: pricingDetails.pricePerSlot,
    totalPrice: pricingDetails.totalPrice,
    pricingRule: pricingDetails.appliedRule,
    dayType: pricingDetails.dayType,
    status: 'confirmed',
    paymentStatus: 'paid', // Mark as paid for manual offline bookings
    isManual: true,
    createdBy: 'admin',
    createdByAdmin: req.user!.id,
    expiresAt: undefined, // No expiration for confirmed bookings
  } as any

  const newBooking = await createBooking(bookingData)

  res.status(201).json({
    message: 'Admin booking created successfully.',
    data: newBooking,
  })
})

// NEW: PATCH /api/v1/admin/bookings/:id/cancel - Cancel booking
export const cancelBookingHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id: bookingId } = req.params

  const booking = await Booking.findById(bookingId).populate('turf')
  if (!booking) {
    throw new AppError('Booking not found', 404)
  }

  // Check permissions
  const turf = booking.turf as any
  const isAdminOfThisTurf = turf && turf.admins.some((adminId: any) => adminId.equals(req.user!.id))

  if (req.user!.role !== 'manager' && !isAdminOfThisTurf) {
    throw new AppError('Forbidden: You are not authorized to cancel this booking.', 403)
  }

  // Can't cancel already cancelled bookings
  if (booking.status === 'cancelled') {
    throw new AppError('Booking is already cancelled', 400)
  }

  // Handle refund logic for paid bookings
  const updateData: any = booking.paymentStatus === 'paid'
    ? { status: 'cancelled', paymentStatus: 'refunded' }
    : { status: 'cancelled' }

  const updatedBooking = await Booking.findByIdAndUpdate(
    bookingId,
    updateData,
    { new: true, runValidators: true },
  )

  const refundMessage = booking.paymentStatus === 'paid'
    ? 'Booking cancelled and payment marked as refunded. Please process the refund to the user.'
    : 'Booking cancelled successfully.'

  res.json({
    message: refundMessage,
    data: updatedBooking,
  })
})

export const updateBookingPaymentHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id: bookingId } = req.params
  const { paymentStatus } = req.body

  if (paymentStatus !== 'paid') {
    throw new AppError('Invalid payment status. Only "paid" is allowed.', 400)
  }

  const booking = await Booking.findById(bookingId).populate('turf')
  if (!booking) {
    throw new AppError('Booking not found', 404)
  }

  // Authorization check
  const turf = booking.turf as any
  const isAdminOfThisTurf = turf && turf.admins.some((adminId: any) => adminId.equals(req.user!.id))
  if (req.user!.role !== 'manager' && !isAdminOfThisTurf) {
    throw new AppError('Forbidden: You are not authorized to modify this booking.', 403)
  }

  booking.paymentStatus = 'paid'
  // If the booking was pending, confirming it is a logical next step
  if (booking.status === 'pending') {
    booking.status = 'confirmed'
  }

  await booking.save()

  res.json({
    message: 'Booking has been marked as paid.',
    data: booking,
  })
})

// Find the existing deleteBookingHandler and replace it with this corrected version
export const deleteBookingHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id: bookingId } = req.params

  const booking = await Booking.findById(bookingId).populate('turf')
  if (!booking) {
    throw new AppError('Booking not found', 404)
  }

  // CORRECTED PERMISSION LOGIC
  if (req.user!.role !== 'manager') {
    const turf = booking.turf as any
    const isAdminOfThisTurf = turf && turf.admins.some((adminId: any) => adminId.equals(req.user!.id))

    if (!isAdminOfThisTurf) {
      throw new AppError('Forbidden: You are not authorized to delete this booking.', 403)
    }
  }

  await Booking.findByIdAndDelete(bookingId)

  res.json({
    message: 'Booking deleted successfully.',
  })
})

// NEW: Handler for approving manual bKash payments
export const approveBookingPaymentHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id: bookingId } = req.params

  const booking = await Booking.findById(bookingId).populate('user turf')

  if (!booking) {
    throw new AppError('Booking not found', 404)
  }

  // Authorization check
  const turf = booking.turf as any
  const isAdminForThisTurf = turf.admins.some((adminId: any) => adminId.equals(req.user!.id))
  if (req.user!.role !== 'manager' && !isAdminForThisTurf) {
    throw new AppError('Forbidden: you do not manage this turf', 403)
  }

  if (booking.paymentStatus === 'paid') {
    throw new AppError('Booking is already paid and confirmed', 400)
  }

  booking.paymentStatus = 'paid'
  booking.status = 'confirmed'
  await booking.save()

  // Send confirmation email
  try {
    await sendBookingConfirmationEmail(booking.user as any, booking, booking.turf as any)
  }
  catch (error) {
    console.error('Failed to send confirmation email:', error)
  }

  res.status(200).json({
    message: 'Booking payment approved and confirmed successfully.',
    data: booking,
  })
})

// GET /api/v1/admin/reports - Get all reports with optional filtering
export const getReportsHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status, reportType, page = '1', limit = '50' } = req.query

  const pageNum = Number.parseInt(page as string, 10) || 1
  const limitNum = Number.parseInt(limit as string, 10) || 50
  const skip = (pageNum - 1) * limitNum

  let turfIds: string[] | undefined

  if (req.user?.role === 'admin') {
    const adminTurfs = await Turf.find({ admins: req.user.id }).select('_id').lean<{ _id: Types.ObjectId }[]>()
    turfIds = adminTurfs.map(turf => turf._id.toString())

    if (turfIds.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Reports retrieved successfully',
        data: [],
        pagination: {
          total: 0,
          page: pageNum,
          limit: limitNum,
          pages: 0,
        },
      })
    }
  }

  const filters = {
    status: status as string | undefined,
    reportType: reportType as string | undefined,
    turfIds,
    limit: limitNum,
    skip,
  }

  const { reports, total } = await getReports(filters)

  const totalPages = Math.ceil(total / limitNum)

  // Map backend model to the Manager UI-friendly shape
  const formatDate = (d: Date) => new Date(d).toLocaleDateString('en-CA') // YYYY-MM-DD
  const formatTime = (d: Date) => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const mapStatus = (s: string): 'pending' | 'resolved' => (s === 'resolved' || s === 'closed' ? 'resolved' : 'pending')

  const data = reports.map((r: any) => {
    const turf = r.turfId as { _id?: Types.ObjectId, name?: string } | undefined

    return {
      id: String(r._id),
      name: r.name,
      email: r.email,
      reportType: r.reportType,
      subject: r.subject,
      message: r.message,
      date: formatDate(r.createdAt),
      time: formatTime(r.createdAt),
      status: mapStatus(r.status),
      turfId: turf?._id ? turf._id.toString() : undefined,
      turfName: turf?.name,
    }
  })

  res.status(200).json({
    success: true,
    message: 'Reports retrieved successfully',
    data,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      pages: totalPages,
    },
  })
})

// GET /api/v1/admin/reports/:id - Get a single report
export const getReportHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id: reportId } = req.params

  const report = await getReportById(reportId)
  if (!report) {
    throw new AppError('Report not found', 404)
  }

  ensureAdminCanAccessReport(req, report)

  const formatDate = (d: Date) => new Date(d).toLocaleDateString('en-CA')
  const formatTime = (d: Date) => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const mapStatus = (s: string): 'pending' | 'resolved' => (s === 'resolved' || s === 'closed' ? 'resolved' : 'pending')

  const turf = (report as any).turfId as { _id?: Types.ObjectId, name?: string } | undefined

  const data = {
    id: String(report._id),
    name: report.name,
    email: report.email,
    reportType: report.reportType,
    subject: report.subject,
    message: report.message,
    date: formatDate(report.createdAt),
    time: formatTime(report.createdAt),
    status: mapStatus(report.status),
    turfId: turf?._id ? turf._id.toString() : undefined,
    turfName: turf?.name,
  }

  res.status(200).json({
    success: true,
    message: 'Report retrieved successfully',
    data,
  })
})

// PATCH /api/v1/admin/reports/:id/status - Update report status
export const updateReportStatusHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id: reportId } = req.params
  const { status } = req.body

  if (!['open', 'in_review', 'resolved', 'closed'].includes(status)) {
    throw new AppError('Invalid status value', 400)
  }

  const existingReport = await getReportById(reportId)
  if (!existingReport) {
    throw new AppError('Report not found', 404)
  }

  ensureAdminCanAccessReport(req, existingReport)

  const report = await updateReportStatus(reportId, status)
  if (!report) {
    throw new AppError('Report not found', 404)
  }

  res.status(200).json({
    success: true,
    message: 'Report status updated successfully',
    data: report,
  })
})

// DELETE /api/v1/admin/reports/:id - Delete a report
export const deleteReportHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id: reportId } = req.params

  const existingReport = await getReportById(reportId)
  if (!existingReport) {
    throw new AppError('Report not found', 404)
  }

  ensureAdminCanAccessReport(req, existingReport)

  await deleteReport(reportId)

  res.status(200).json({
    success: true,
    message: 'Report deleted successfully',
    data: existingReport,
  })
})
