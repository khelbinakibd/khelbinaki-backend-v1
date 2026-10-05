import type { Response } from 'express'
import type { Types } from 'mongoose'
import crypto from 'node:crypto'
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
import { calculateFacilityPrice } from '../services/facilityPricingService'
import { Facility } from '../models/Facility'
import { findTurfById, updateTurf } from '../services/turfServices'
import { uploadToCloudinary } from '../services/uploadService'
import { updateUserById } from '../services/userServices'
import AppError from '../utils/AppError'
import asyncHandler from '../utils/asyncHandler'
import { dhakaDateStart, getDhakaDayRange, getDhakaWeekday, timeToMinutes } from '../utils/businessTime'
import { paginate } from '../utils/pagination'

function ensureAdminCanAccessReport(req: AuthRequest, report: any) {
  // Managers can access all reports
  if (req.user?.role === 'manager') {
    return
  }

  // For turf admins (role 'admin' or 'user' who is in turf.admins), check if they manage this turf
  const turf = report.turfId as { admins?: Types.ObjectId[] } | undefined
  const admins = turf?.admins || []
  const manages = Array.isArray(admins) && admins.some((adminId: Types.ObjectId) => adminId.toString() === req.user!.id)

  if (!manages) {
    throw new AppError('Forbidden: you do not manage this turf report', 403)
  }
}

// GET /api/v1/admin/users/search?phone={phoneNumber}
export const searchUserByPhoneHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { phone } = req.query

  // Check if phone parameter exists
  if (!phone || typeof phone !== 'string') {
    throw new AppError('Phone parameter is required', 400)
  }

  // Validate phone format: exactly 11 digits
  const phoneRegex = /^\d{11}$/
  if (!phoneRegex.test(phone)) {
    throw new AppError('Phone must be exactly 11 digits', 400)
  }

  // Search for user by phone number
  const user = await User.findOne({ phone }).select('-password -passwordResetToken -passwordResetExpires')

  if (!user) {
    return res.status(404).json({
      message: 'User not found',
      data: null,
    })
  }

  res.status(200).json({
    message: 'User found',
    data: {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
    },
  })
})

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
    // This includes both role 'admin' and role 'user' who are turf admins
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

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/8fbd04cc-7df6-4810-b434-f22cccd6f5f0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:185',message:'Image upload handler entry',data:{turfId,hasFile:!!req.file,userId:req.user?.id,userRole:req.user?.role},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

  console.log('📸 Image upload request for turf:', turfId)
  console.log('📸 File received:', req.file ? 'Yes' : 'No')

  if (!req.file) {
    throw new AppError('No image file provided', 400)
  }

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/8fbd04cc-7df6-4810-b434-f22cccd6f5f0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:194',message:'Before findTurfById',data:{turfId,fileSize:req.file.size,fileMimetype:req.file.mimetype},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion

  const turf = await findTurfById(turfId)
  if (!turf) {
    console.error('❌ Turf not found:', turfId)
    throw new AppError('Turf not found.', 404)
  }

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/8fbd04cc-7df6-4810-b434-f22cccd6f5f0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:200',message:'Turf found, checking admins structure',data:{turfName:turf.name,adminsType:Array.isArray(turf.admins)?turf.admins.length:'not-array',firstAdminType:turf.admins?.[0]?typeof turf.admins[0]:'no-admins',firstAdminHasEquals:typeof turf.admins?.[0]?.equals,firstAdminId:turf.admins?.[0]?._id?.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

  console.log('✅ Turf found:', turf.name)

  // Authorization check
  // Note: findTurfById returns lean objects with populated admins, so admins are plain objects with _id, not ObjectIds
  try {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/8fbd04cc-7df6-4810-b434-f22cccd6f5f0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:203',message:'Before authorization check',data:{userId:req.user!.id,adminsCount:turf.admins?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

    const isAdminForThisTurf = turf.admins.some((admin: any) => {
      // Handle both ObjectId and populated plain object cases
      const adminId = admin._id ? admin._id.toString() : admin.toString()
      return adminId === req.user!.id
    })
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/8fbd04cc-7df6-4810-b434-f22cccd6f5f0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:203',message:'Authorization check result',data:{isAdminForThisTurf,userRole:req.user?.role},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

    if (req.user?.role !== 'manager' && !isAdminForThisTurf) {
      throw new AppError('Forbidden: you do not manage this turf.', 403)
    }
  } catch (error: any) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/8fbd04cc-7df6-4810-b434-f22cccd6f5f0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:203',message:'Authorization check error',data:{errorMessage:error.message,errorName:error.name,errorStack:error.stack?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    throw error
  }

  console.log('📤 Uploading to Cloudinary...')

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/8fbd04cc-7df6-4810-b434-f22cccd6f5f0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:211',message:'Before Cloudinary upload',data:{fileSize:req.file.size,hasBuffer:!!req.file.buffer,bufferLength:req.file.buffer?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
  // #endregion

  // Upload the file to Cloudinary in a 'turfs' folder
  let imageUrl: string
  try {
    imageUrl = await uploadToCloudinary(req.file, 'turfs')
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/8fbd04cc-7df6-4810-b434-f22cccd6f5f0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:211',message:'Cloudinary upload success',data:{imageUrl},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
  } catch (error: any) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/8fbd04cc-7df6-4810-b434-f22cccd6f5f0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:211',message:'Cloudinary upload error',data:{errorMessage:error.message,errorName:error.name,errorStack:error.stack?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    throw error
  }

  console.log('✅ Image uploaded:', imageUrl)

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/8fbd04cc-7df6-4810-b434-f22cccd6f5f0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:216',message:'Before updateTurf',data:{turfId,imageUrl},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
  // #endregion

  // Add the new image URL to the turf's images array
  const updatedTurf = await updateTurf(turfId, { $push: { images: imageUrl } })

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/8fbd04cc-7df6-4810-b434-f22cccd6f5f0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'adminController.ts:216',message:'updateTurf success',data:{updatedTurfId:updatedTurf?._id?.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
  // #endregion

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
    // Turf admin (role 'admin' or 'user' who is in turf.admins) can only see their turf bookings
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
    { path: 'user', select: 'name email' },
    { path: 'turf', select: 'name location' },
    { path: 'facility', select: 'name' },
  ])

  // Transform response to include only specified fields
  const transformedData = populatedData.map((booking: any) => ({
    _id: booking._id,
    user: {
      name: booking.user?.name,
      email: booking.user?.email,
    },
    turf: {
      name: booking.turf?.name,
      location: {
        address: booking.turf?.location?.address,
        city: booking.turf?.location?.city,
      },
    },
    facility: booking.facility ? {
      name: booking.facility.name,
    } : null,
    date: booking.date,
    startTime: booking.startTime,
    endTime: booking.endTime,
    totalPrice: booking.totalPrice,
    paidAmount: booking.paidAmount,
    dayType: booking.dayType,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    transactionId: booking.transactionId,
    lastDigit: booking.lastDigit,
    createdAt: booking.createdAt,
  }))

  res.status(200).json({
    message: 'Bookings retrieved successfully.',
    data: transformedData,
    meta: result.meta,
  })
})

// NEW: POST /api/v1/admin/bookings - Create booking (for walk-ins, phone bookings)
export const createAdminBookingHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const validatedInput = createAdminManualBookingSchema.parse(req.body)
  const { userId, userPhone, firstName, lastName, email } = validatedInput
  const dateKey = validatedInput.date

  const turf = await findTurfById(validatedInput.turf)
  if (!turf) {
    throw new AppError('Turf not found', 404)
  }

  // Validate facility exists and belongs to turf
  const facility = await Facility.findById(validatedInput.facility)
  if (!facility) {
    throw new AppError('Facility not found', 404)
  }

  if (facility.turf.toString() !== validatedInput.turf) {
    throw new AppError('Facility does not belong to this turf', 400)
  }

  if (!facility.isActive) {
    throw new AppError('Facility is not active', 400)
  }

  // Validate facility has pricingRules (required)
  if (!facility.pricingRules || !Array.isArray(facility.pricingRules) || facility.pricingRules.length === 0) {
    throw new AppError('Facility must have pricing rules configured', 400)
  }

  // Check admin permissions for this turf
  const isAdminForThisTurf = turf.admins.some(adminId => adminId.equals(req.user!.id))
  if (req.user!.role !== 'manager' && !isAdminForThisTurf) {
    throw new AppError('Forbidden: you do not manage this turf', 403)
  }

  // User lookup/creation logic
  let bookingUser

  // Backward compatibility: if userId is provided, use it
  if (userId) {
    bookingUser = await User.findById(userId)
    if (!bookingUser) {
      throw new AppError('User not found', 404)
    }
  }
  // New logic: lookup user by phone
  else if (userPhone) {
    // Search for existing user by phone
    bookingUser = await User.findOne({ phone: userPhone })

    // If user not found, create new user
    if (!bookingUser) {
      // Validate that firstName, lastName, and email are provided
      if (!firstName || !lastName || !email) {
        throw new AppError('User not found. firstName, lastName, and email are required to create a new user', 400)
      }

      // Check if email already exists
      const existingUserByEmail = await User.findOne({ email: email.toLowerCase().trim() })
      if (existingUserByEmail) {
        throw new AppError('A user with this email already exists', 409)
      }

      // Generate a random password for the new user
      // Password will be hashed automatically by the pre-save hook
      const randomPassword = crypto.randomBytes(16).toString('hex')

      // Combine firstName and lastName into full name
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim()

      // Create new user
      bookingUser = await User.create({
        name: fullName,
        email: email.toLowerCase().trim(),
        phone: userPhone,
        password: randomPassword, // Will be hashed by pre-save hook
        role: 'user',
        isActive: true,
        isVerified: false,
        // TODO: When reactivating emails, consider sending welcome email here immediately
        // TODO: When reactivating emails, remove these flags or set welcomeEmailSent: true if email sent
        createdViaManualBooking: true, // Track that user was created via manual booking
        welcomeEmailSent: false, // Will be sent later when emails are enabled
      })

      // TODO: When reactivating emails, uncomment and implement welcome email sending:
      // try {
      //   const resetToken = bookingUser.createPasswordResetToken()
      //   await bookingUser.save({ validateBeforeSave: false })
      //   await sendWelcomeEmail(bookingUser)
      // } catch (emailError) {
      //   logger.error('Failed to send welcome email during manual booking', { error: emailError })
      //   // Don't fail booking creation if email fails
      // }
    }
  }
  else {
    // Fallback to admin themselves if no user specified
    bookingUser = await User.findById(req.user!.id)
    if (!bookingUser) {
      throw new AppError('Admin user not found', 404)
    }
  }

  // Check slot availability (same logic as regular booking)
  // Must check if the entire time range overlaps with existing bookings
  // Helper function to check if two time ranges overlap (handles midnight-spanning slots)
  const doTimeRangesOverlap = (
    start1: string,
    end1: string,
    start2: string,
    end2: string,
  ): boolean => {
    const start1Minutes = timeToMinutes(start1)
    const end1Minutes = timeToMinutes(end1)
    const start2Minutes = timeToMinutes(start2)
    const end2Minutes = timeToMinutes(end2)

    const range1SpansMidnight = end1Minutes < start1Minutes
    const range2SpansMidnight = end2Minutes < start2Minutes

    // If both ranges span midnight, they always overlap (simplified check)
    if (range1SpansMidnight && range2SpansMidnight) {
      return true
    }

    // If range1 spans midnight
    if (range1SpansMidnight) {
      // Range1: [start1, 24:00) U [00:00, end1)
      // Check if range2 overlaps with either part
      return (
        (start2Minutes >= start1Minutes && start2Minutes < 24 * 60) || // Overlaps with first part
        (end2Minutes > start1Minutes && end2Minutes <= 24 * 60) || // Overlaps with first part
        (start2Minutes >= 0 && start2Minutes < end1Minutes) || // Overlaps with second part
        (end2Minutes > 0 && end2Minutes <= end1Minutes) || // Overlaps with second part
        (start2Minutes < end1Minutes && end2Minutes > start1Minutes) // Spans across both parts
      )
    }

    // If range2 spans midnight
    if (range2SpansMidnight) {
      // Range2: [start2, 24:00) U [00:00, end2)
      // Check if range1 overlaps with either part
      return (
        (start1Minutes >= start2Minutes && start1Minutes < 24 * 60) || // Overlaps with first part
        (end1Minutes > start2Minutes && end1Minutes <= 24 * 60) || // Overlaps with first part
        (start1Minutes >= 0 && start1Minutes < end2Minutes) || // Overlaps with second part
        (end1Minutes > 0 && end1Minutes <= end2Minutes) || // Overlaps with second part
        (start1Minutes < end2Minutes && end1Minutes > start2Minutes) // Spans across both parts
      )
    }

    // Both ranges are same-day: standard overlap check
    // Overlap occurs if: range1 starts before range2 ends AND range1 ends after range2 starts
    return start1Minutes < end2Minutes && end1Minutes > start2Minutes
  }

  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000)
  const { start, endExclusive } = getDhakaDayRange(dateKey)
  const potentialConflicts = await Booking.find({
    turf: validatedInput.turf,
    facility: validatedInput.facility, // Filter by facility
    date: {
      $gte: start,
      $lt: endExclusive,
    },
    $or: [
      { status: 'confirmed' },
      {
        status: 'pending',
        createdAt: { $gte: fifteenMinutesAgo },
      },
    ],
  }).select('startTime endTime status createdAt')

  for (const booking of potentialConflicts) {
    // Use overlap function that handles midnight-spanning slots
    if (doTimeRangesOverlap(
      validatedInput.startTime,
      validatedInput.endTime,
      booking.startTime,
      booking.endTime,
    )) {
      throw new AppError('This time slot is already booked or temporarily reserved', 409)
    }
  }

  // Helper function to determine day type
  const getDayType = (bookingDateKey: string): 'sunday-thursday' | 'friday-saturday' => {
    const dayOfWeek = getDhakaWeekday(bookingDateKey) // 0 = Sunday, ..., 6 = Saturday
    // Friday (5) and Saturday (6) are considered weekends
    return (dayOfWeek === 5 || dayOfWeek === 6) ? 'friday-saturday' : 'sunday-thursday'
  }

  // Helper function to calculate duration in hours
  const calculateDurationInHours = (startTime: string, endTime: string): number => {
    const durationMinutes = timeToMinutes(endTime) - timeToMinutes(startTime)
    return Math.round((durationMinutes / 60) * 100) / 100
  }

  // Calculate pricing - check if totalPayment override is provided
  let pricingDetails
  const { totalPayment } = validatedInput

  if (totalPayment !== undefined && totalPayment !== null) {
    // Override mode: use provided totalPayment
    const dayType = getDayType(dateKey)
    const durationInHours = calculateDurationInHours(validatedInput.startTime, validatedInput.endTime)
    
    pricingDetails = {
      pricePerSlot: 0,
      totalPrice: totalPayment,
      appliedRule: 'manual-override',
      dayType,
      durationInHours,
    }
  } else {
    // Normal mode: calculate pricing using facility pricing only (no turf fallback)
    pricingDetails = calculateFacilityPrice(facility, dateKey, validatedInput.startTime, validatedInput.endTime)
  }

  // Admin manual bookings are immediately confirmed and marked manual
  const bookingData = {
    ...validatedInput,
    user: bookingUser._id, // Use the found or created user
    facility: validatedInput.facility, // Include facility
    date: dhakaDateStart(dateKey),
    appliedPricePerSlot: pricingDetails.pricePerSlot,
    totalPrice: pricingDetails.totalPrice,
    pricingRule: pricingDetails.appliedRule,
    dayType: pricingDetails.dayType,
    status: 'confirmed',
    paymentStatus: 'paid', // Mark as paid for manual offline bookings
    paidAmount: validatedInput.paidAmount,
    isManual: true,
    createdBy: 'admin',
    createdByAdmin: req.user!.id,
    expiresAt: undefined, // No expiration for confirmed bookings
  } as any

  // Remove fields that shouldn't be stored in booking
  delete bookingData.userId
  delete bookingData.userPhone
  delete bookingData.firstName
  delete bookingData.lastName
  delete bookingData.email

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

  // If user is not a manager, filter reports to only their turfs
  // This includes both role 'admin' and role 'user' who are turf admins
  if (req.user?.role !== 'manager') {
    const adminTurfs = await Turf.find({ admins: req.user!.id }).select('_id').lean<{ _id: Types.ObjectId }[]>()
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
