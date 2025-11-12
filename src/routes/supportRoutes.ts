import { Router } from 'express'
import { submitContact, submitReport } from '../controllers/supportController'
import { optionalAuth } from '../middlewares/authMiddleware'

const supportRouter = Router()

// POST /api/v1/contact
supportRouter.post('/contact', submitContact)

// POST /api/v1/report (optional auth)
supportRouter.post('/report', optionalAuth, submitReport)

export default supportRouter
