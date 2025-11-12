import { Router } from 'express'
import { getMyProfile, updateMyProfile } from '../controllers/userController'
import { requireAuth } from '../middlewares/authMiddleware'

const userRouter = Router()

// Routes for the authenticate user ('me')
userRouter.get('/me', requireAuth, getMyProfile)
userRouter.patch('/me', requireAuth, updateMyProfile)

export default userRouter
