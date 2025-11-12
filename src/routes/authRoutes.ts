import { Router } from 'express'
import { forgotPassword, login, logout, refreshToken, register, resetPassword, verifyOtp } from '../controllers/authController'
import { requireAuth } from '../middlewares/authMiddleware'
import { authRateLimit } from '../middlewares/rateLimitMiddleware'

const authRouter = Router()

// Public routes
authRouter.post('/register', register)
authRouter.post('/verify-otp', verifyOtp)
authRouter.post('/login', authRateLimit, login)

// FIXED: Remove rate limiting from refresh token for better UX
authRouter.post('/refresh-token', refreshToken)

// Password reset routes
authRouter.post('/forgot-password', authRateLimit, forgotPassword)
authRouter.patch('/reset-password/:token', resetPassword)

// Protected routes
authRouter.post('/logout', requireAuth, logout)

// FIXED: Add a route to check current auth status
authRouter.get('/me', requireAuth, (req, res) => {
  res.json({
    message: 'Authenticated',
    user: (req as any).user,
  })
})

export default authRouter
