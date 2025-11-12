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

// Dashboard route (accessible by admin and manager)
adminRouter.get('/dashboard', permitRoles('admin', 'manager'), getAdminDashboardHandler)

// Turfs for admin (for manual booking form)
adminRouter.get('/turfs', permitRoles('admin', 'manager'), getAdminTurfsHandler)

// Turf management routes (admin and manager)
adminRouter.patch('/turfs/:id/image', permitRoles('admin', 'manager'), upload.single('image'), uploadTurfImageHandler)

// Booking management routes for admins
adminRouter.get('/bookings', permitRoles('admin', 'manager'), getAdminBookingsHandler)
adminRouter.post('/bookings', permitRoles('admin', 'manager'), createAdminBookingHandler)
adminRouter.patch('/bookings/:id/payment', permitRoles('admin', 'manager'), updateBookingPaymentHandler)
adminRouter.patch('/bookings/:id/cancel', permitRoles('admin', 'manager'), cancelBookingHandler)
adminRouter.delete('/bookings/:id', permitRoles('admin', 'manager'), deleteBookingHandler)
// Add this new route for approving manual payments
adminRouter.patch('/bookings/:id/approve-payment', permitRoles('admin', 'manager'), approveBookingPaymentHandler)

// Report management routes (manager only)
adminRouter.get('/reports', permitRoles('manager', 'admin'), getReportsHandler)
adminRouter.get('/reports/:id', permitRoles('manager', 'admin'), getReportHandler)
adminRouter.patch('/reports/:id/status', permitRoles('manager', 'admin'), updateReportStatusHandler)
adminRouter.delete('/reports/:id', permitRoles('manager', 'admin'), deleteReportHandler)

// User management routes (manager only)
adminRouter.get('/users', permitRoles('manager'), getAllUsersHandler)
adminRouter.patch('/users/:id', permitRoles('manager'), updateUserHandler)
adminRouter.post('/users/admin', permitRoles('manager'), createAdminHandler)
adminRouter.patch('/users/:id/status', permitRoles('manager'), updateUserStatusHandler)

export default adminRouter
