import { Router } from 'express'

import { getTurfAvailabilityHandler } from '../controllers/bookingController'
import {
  createTurfHandler,
  deleteTurfHandler,
  getAllTurfsHandler,
  getTurfFlexibleHandler,
  updateTurfHandler,
} from '../controllers/turfController'
import { requireAuth } from '../middlewares/authMiddleware'
import { permitRoles } from '../middlewares/roleMiddleware'

const turfRouter = Router()

// Public
turfRouter.get('/', getAllTurfsHandler)
turfRouter.get('/:id/availability', getTurfAvailabilityHandler)
turfRouter.get('/:identifier', getTurfFlexibleHandler)

// Admin/Manager/Turf Admin (user role who are turf admins)
turfRouter.post('/', requireAuth, permitRoles('admin', 'manager'), createTurfHandler)
turfRouter.patch('/:id', requireAuth, permitRoles('admin', 'manager', 'user'), updateTurfHandler)
turfRouter.delete('/:id', requireAuth, permitRoles('admin', 'manager', 'user'), deleteTurfHandler)

export default turfRouter
