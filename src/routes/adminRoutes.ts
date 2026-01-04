import { Router } from 'express'
import {
  approveBookingPaymentHandler,
  cancelBookingHandler,
  createAdminBookingHandler,
  createAdminHandler,
  deleteBookingHandler,
  deleteReportHandler,
  getAdminBookingsHandler,
  getAdminDashboardHandler,
  getAllUsersHandler,
  getReportHandler,
  getReportsHandler,
  searchUserByPhoneHandler,
  updateBookingPaymentHandler,
  updateReportStatusHandler,
  updateUserHandler,
  updateUserStatusHandler,
  uploadTurfImageHandler,
} from '../controllers/adminController'
import { getAdminTurfsHandler } from '../controllers/turfController'
import { requireAuth } from '../middlewares/authMiddleware'
import { permitRoles } from '../middlewares/roleMiddleware'
import { upload } from '../services/uploadService'

const adminRouter = Router()

// This middleware applies to all routes in this file
adminRouter.use(requireAuth)

// Dashboard route (accessible by admin, manager, and user who are turf admins)
adminRouter.get('/dashboard', permitRoles('admin', 'manager', 'user'), getAdminDashboardHandler)

// Turfs for admin (for manual booking form) - accessible by admin, manager, and user who are turf admins
adminRouter.get('/turfs', permitRoles('admin', 'manager', 'user'), getAdminTurfsHandler)

// Turf management routes (admin and manager)
adminRouter.patch('/turfs/:id/image', permitRoles('admin', 'manager'), upload.single('image'), uploadTurfImageHandler)

// Booking management routes for admins - accessible by admin, manager, and user who are turf admins
adminRouter.get('/bookings', permitRoles('admin', 'manager', 'user'), getAdminBookingsHandler)
adminRouter.post('/bookings', permitRoles('admin', 'manager', 'user'), createAdminBookingHandler)
adminRouter.patch('/bookings/:id/payment', permitRoles('admin', 'manager', 'user'), updateBookingPaymentHandler)
adminRouter.patch('/bookings/:id/cancel', permitRoles('admin', 'manager', 'user'), cancelBookingHandler)
adminRouter.delete('/bookings/:id', permitRoles('admin', 'manager', 'user'), deleteBookingHandler)
// Add this new route for approving manual payments
adminRouter.patch('/bookings/:id/approve-payment', permitRoles('admin', 'manager', 'user'), approveBookingPaymentHandler)

// Report management routes - accessible by manager, admin, and user who are turf admins
adminRouter.get('/reports', permitRoles('manager', 'admin', 'user'), getReportsHandler)
adminRouter.get('/reports/:id', permitRoles('manager', 'admin', 'user'), getReportHandler)
adminRouter.patch('/reports/:id/status', permitRoles('manager', 'admin', 'user'), updateReportStatusHandler)
adminRouter.delete('/reports/:id', permitRoles('manager', 'admin', 'user'), deleteReportHandler)

// User management routes
adminRouter.get('/users/search', permitRoles('admin', 'manager'), searchUserByPhoneHandler)
adminRouter.get('/users', permitRoles('manager'), getAllUsersHandler)
adminRouter.patch('/users/:id', permitRoles('manager'), updateUserHandler)
adminRouter.post('/users/admin', permitRoles('manager'), createAdminHandler)
adminRouter.patch('/users/:id/status', permitRoles('manager'), updateUserStatusHandler)

export default adminRouter
