import { Router } from 'express'
import {
  cancelMyBookingHandler,
  createBookingHandler,
  getMyBookingDetailsHandler,
  getMyBookingHandler,
  lookupBookingsHandler,
  updateBookingStatusHandler,
} from '../controllers/bookingController'
import { requireAuth } from '../middlewares/authMiddleware'
import { bookingLookupRateLimit } from '../middlewares/rateLimitMiddleware'

const bookingRouter = Router()

// Set before validation/limiting so lookup errors and 429s are also no-store.
bookingRouter.post('/lookup', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
}, bookingLookupRateLimit, lookupBookingsHandler)

bookingRouter.post('/', requireAuth, createBookingHandler)
bookingRouter.get('/my-bookings', requireAuth, getMyBookingHandler)
bookingRouter.get('/:id', requireAuth, getMyBookingDetailsHandler)
bookingRouter.patch('/:id/status', requireAuth, updateBookingStatusHandler)

// ROUTE for users to cancel their own bookings
bookingRouter.patch('/:id/cancel', requireAuth, cancelMyBookingHandler)

export default bookingRouter
