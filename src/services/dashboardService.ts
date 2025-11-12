import mongoose from 'mongoose'
import { Booking } from '../models/Booking'
import { Turf } from '../models/Turf'
import { User } from '../models/User'

export async function getAdminDashboardStats(adminId: string) {
  // Ensure adminId is properly converted to ObjectId
  let adminObjectId: mongoose.Types.ObjectId
  try {
    adminObjectId = new mongoose.Types.ObjectId(adminId)
  }
  catch {
    return {
      totalTurfs: 0,
      totalRevenue: 0,
      totalBookings: 0,
      upcomingBookings: 0,
      recentBookings: [],
      monthlyBookings: [],
      revenueByDayType: {
        'sunday-thursday': 0,
        'friday-saturday': 0,
      },
      bookingStatusCounts: {
        pending: 0,
        confirmed: 0,
        cancelled: 0,
        expired: 0,
      },
    }
  }

  // Step 1: Find all turfs managed by this admin
  const turfs = await Turf.find({ admins: adminObjectId }).select('_id name')

  const turfIds = turfs.map(turf => turf._id)

  if (turfIds.length === 0) {
    return {
      totalTurfs: 0,
      totalRevenue: 0,
      totalBookings: 0,
      upcomingBookings: 0,
      recentBookings: [],
      monthlyBookings: [],
      revenueByDayType: {
        'sunday-thursday': 0,
        'friday-saturday': 0,
      },
      bookingStatusCounts: {
        pending: 0,
        confirmed: 0,
        cancelled: 0,
        expired: 0,
      },
    }
  }

  const [statsResult, recentBookings, monthlyStats] = await Promise.all([
    // Main statistics aggregation
    Booking.aggregate([
      {
        $match: { turf: { $in: turfIds } },
      },
      {
        $group: {
          _id: null,
          // FIXED: Only count paid bookings for revenue (exclude refunded)
          totalRevenue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$paymentStatus', 'paid'] },
                    { $ne: ['$status', 'cancelled'] },
                  ],
                },
                '$totalPrice',
                0,
              ],
            },
          },
          totalBookings: { $sum: 1 },
          // FIXED: Upcoming bookings should be confirmed AND in the future
          upcomingBookings: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$date', new Date()] },
                    { $eq: ['$status', 'confirmed'] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          // Revenue by day type
          revenueSundayThursday: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$dayType', 'sunday-thursday'] },
                    { $eq: ['$paymentStatus', 'paid'] },
                    { $ne: ['$status', 'cancelled'] },
                  ],
                },
                '$totalPrice',
                0,
              ],
            },
          },
          revenueFridaySaturday: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$dayType', 'friday-saturday'] },
                    { $eq: ['$paymentStatus', 'paid'] },
                    { $ne: ['$status', 'cancelled'] },
                  ],
                },
                '$totalPrice',
                0,
              ],
            },
          },
          // Booking status counts
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          confirmed: { $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          expired: { $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] } },
        },
      },
    ]),

    // Recent bookings
    Booking.find({ turf: { $in: turfIds } })
      .populate('user', 'name email')
      .populate('turf', 'name')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),

    // Monthly stats - FIXED: Last 30 days
    Booking.aggregate([
      {
        $match: {
          turf: { $in: turfIds },
          createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' },
          },
          bookings: { $sum: 1 },
          revenue: {
            $sum: {
              $cond: [{ $eq: ['$paymentStatus', 'paid'] }, '$totalPrice', 0],
            },
          },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
    ]),
  ])

  // Provide default values if no results
  const stats = statsResult[0] || {
    totalRevenue: 0,
    totalBookings: 0,
    upcomingBookings: 0,
    revenueSundayThursday: 0,
    revenueFridaySaturday: 0,
    pending: 0,
    confirmed: 0,
    cancelled: 0,
    expired: 0,
  }

  const finalStats = {
    totalTurfs: turfs.length,
    totalRevenue: stats.totalRevenue || 0,
    totalBookings: stats.totalBookings || 0,
    upcomingBookings: stats.upcomingBookings || 0,
    recentBookings,
    monthlyBookings: monthlyStats,
    revenueByDayType: {
      'sunday-thursday': stats.revenueSundayThursday || 0,
      'friday-saturday': stats.revenueFridaySaturday || 0,
    },
    bookingStatusCounts: {
      pending: stats.pending || 0,
      confirmed: stats.confirmed || 0,
      cancelled: stats.cancelled || 0,
      expired: stats.expired || 0,
    },
  }

  return finalStats
}

// Calculate dashboard statistics for the platform manager (super admin)
export async function getManagerDashboardStats() {
  // Run all promises in parallel for better performance
  const [userCount, adminCount, turfCount, bookingStats, revenueStats, recentBookings] = await Promise.all([
    User.countDocuments({ role: 'user' }),
    User.countDocuments({ role: 'admin' }),
    Turf.countDocuments({ isActive: true }),

    // Booking statistics
    Booking.aggregate([
      {
        $group: {
          _id: null,
          totalBookings: { $sum: 1 },
          confirmedBookings: { $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] } },
          pendingBookings: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          cancelledBookings: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        },
      },
    ]),

    // Revenue statistics - FIXED: Only count paid bookings (exclude refunded/cancelled)
    Booking.aggregate([
      {
        $match: {
          paymentStatus: 'paid',
          status: { $ne: 'cancelled' }, // Exclude cancelled bookings (refunded)
        },
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalPrice' },
          averageBookingValue: { $avg: '$totalPrice' },
        },
      },
    ]),

    // Recent bookings
    Booking.find()
      .populate('user', 'name email')
      .populate('turf', 'name location')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
  ])

  const bookingStat = bookingStats[0] || {
    totalBookings: 0,
    confirmedBookings: 0,
    pendingBookings: 0,
    cancelledBookings: 0,
  }

  const revenueStat = revenueStats[0] || {
    totalRevenue: 0,
    averageBookingValue: 0,
  }

  const finalStats = {
    // User statistics
    totalUsers: userCount,
    totalAdmins: adminCount,
    totalTurfs: turfCount,

    // Booking statistics
    totalBookings: bookingStat.totalBookings,
    confirmedBookings: bookingStat.confirmedBookings,
    pendingBookings: bookingStat.pendingBookings,
    cancelledBookings: bookingStat.cancelledBookings,

    // Revenue statistics
    totalRevenue: revenueStat.totalRevenue || 0,
    averageBookingValue: Math.round(revenueStat.averageBookingValue || 0),

    // Recent bookings
    recentBookings,
  }

  return finalStats
}
