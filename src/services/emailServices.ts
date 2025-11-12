import type { IBooking } from '../models/Booking'
import type { ITurf } from '../models/Turf'
import type { IUser } from '../models/User'
import { sendEmail } from '../utils/sendEmail'

export async function sendBookingConfirmationEmail(user: IUser, booking: IBooking, turf: ITurf) {
  const formattedDate = new Date(booking.date).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>Booking Confirmation</h2>
      <p>Hello ${user.name},</p>
      <p>Your booking for <strong>${turf.name}</strong> has been successfully confirmed. Thank you!</p>
      <h3>Booking Details:</h3>
      <ul>
        <li><strong>Turf:</strong> ${turf.name}</li>
        <li><strong>Location:</strong> ${turf.location.address}, ${turf.location.city}</li>
        <li><strong>Date:</strong> ${formattedDate}</li>
        <li><strong>Time:</strong> ${booking.startTime} - ${booking.endTime}</li>
        <li><strong>Total Price:</strong> BDT ${booking.totalPrice}</li>
        <li><strong>Payment Status:</strong> ${booking.paymentStatus}</li>
      </ul>
      <p>We look forward to seeing you!</p>
      <p>Sincerely,<br/>The Khelbi Naki Team</p>
    </div>  
  `

  await sendEmail({
    to: user.email,
    subject: `Booking Confirmed for ${turf.name}`,
    html: emailHtml,
  })
}

interface TemplatedEmailOption {
  to: string
  subject: string
  title: string
  body: string
}

export async function sendTemplatedEmail(options: TemplatedEmailOption) {
  const { to, subject, title, body } = options
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
      <h2 style="color: #333;">${title}</h2>
      ${body}
      <p style="margin-top: 20px;">Sincerely,<br/>The Khelbi Naki Team</p>
    </div>
  `
  await sendEmail({ to, subject, html: emailHtml })
}
