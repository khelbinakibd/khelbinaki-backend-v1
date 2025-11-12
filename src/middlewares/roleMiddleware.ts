import type { NextFunction, Response } from 'express'
import type { AuthRequest } from './authMiddleware'
import { Turf } from '../models/Turf'

export function permitRoles(...roles: Array<'user' | 'admin' | 'manager'>) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized' })
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: 'Forbidden: insufficient role',
        requiredRoles: roles,
        userRole: req.user.role,
      })
    }
    next()
  }
}

// New middleware for turf-specific permissions
export function requireTurfAccess() {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { id: turfId } = req.params

    if (req.user!.role === 'manager') {
      return next() // Managers have access to all turfs
    }

    if (req.user!.role === 'admin') {
      const turf = await Turf.findById(turfId)
      if (!turf || !turf.admins.some(adminId => adminId.equals(req.user!.id))) {
        return res.status(403).json({
          message: 'Forbidden: You do not manage this turf',
        })
      }
      return next()
    }

    return res.status(403).json({
      message: 'Forbidden: Insufficient permissions',
    })
  }
}
