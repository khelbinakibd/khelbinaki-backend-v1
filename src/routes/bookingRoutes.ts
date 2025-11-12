import { Router } from 'express'
import {
  cancelMyBookingHandler,
  createBookingHandler,
  getMyBookingDetailsHandler,
  getMyBookingHandler,
  updateBookingStatusHandler,
} from '../controllers/bookingController'
import { requireAuth } from '../middlewares/authMiddleware'

const bookingRouter = Router()

bookingRouter.post('/', requireAuth, createBookingHandler)
bookingRouter.get('/my-bookings', requireAuth, getMyBookingHandler)
bookingRouter.get('/:id', requireAuth, getMyBookingDetailsHandler)
bookingRouter.patch('/:id/status', requireAuth, updateBookingStatusHandler)

// ROUTE for users to cancel their own bookings
bookingRouter.patch('/:id/cancel', requireAuth, cancelMyBookingHandler)

export default bookingRouter
