import { Router } from 'express'
import {
  createFacilityHandler,
  deleteFacilityHandler,
  getFacilityHandler,
  getFacilitiesByTurfHandler,
  updateFacilityHandler,
} from '../controllers/facilityController'
import { requireAuth } from '../middlewares/authMiddleware'
import { permitRoles } from '../middlewares/roleMiddleware'

const facilityRouter = Router()

// Public: Get facilities for a turf
facilityRouter.get('/turfs/:turfId/facilities', getFacilitiesByTurfHandler)

// Public: Get facility by ID
facilityRouter.get('/facilities/:facilityId', getFacilityHandler)

// Admin/Manager: Create facility
facilityRouter.post('/turfs/:turfId/facilities', requireAuth, permitRoles('admin', 'manager'), createFacilityHandler)

// Admin/Manager: Update facility
facilityRouter.put('/facilities/:facilityId', requireAuth, permitRoles('admin', 'manager'), updateFacilityHandler)

// Admin/Manager: Delete facility
facilityRouter.delete('/facilities/:facilityId', requireAuth, permitRoles('admin', 'manager'), deleteFacilityHandler)

export default facilityRouter

