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
import { createMaintenanceBlockHandler, listMaintenanceBlocksHandler, releaseMaintenanceBlockHandler } from '../controllers/maintenanceController'

const facilityRouter = Router()

// Turf membership is checked by the service for every operation, including IDs.
facilityRouter.get('/facilities/:facilityId/maintenance-blocks', requireAuth, listMaintenanceBlocksHandler)
facilityRouter.post('/facilities/:facilityId/maintenance-blocks', requireAuth, createMaintenanceBlockHandler)
facilityRouter.patch('/facilities/:facilityId/maintenance-blocks/:blockId/release', requireAuth, releaseMaintenanceBlockHandler)

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
