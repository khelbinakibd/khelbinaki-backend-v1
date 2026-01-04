# Email Activation Guide for Khelbi Naki

## Current Status

- Email functionality is currently **disabled** (`EMAIL_ENABLED=false`)
- Users created via manual booking do not receive emails
- All email code is preserved and ready to activate
- Users created via manual booking are tracked with `createdViaManualBooking: true` and `welcomeEmailSent: false`

## Step 1: Enable Email Functionality

### 1.1 Set Environment Variable

Set the `EMAIL_ENABLED` environment variable to `true`:

```bash
# In your .env file or environment variables
EMAIL_ENABLED=true
```

### 1.2 Verify Email Service Configuration

Ensure your email service is properly configured:

**For Resend (production):**
```bash
EMAIL_SERVICE=resend
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=Khelbi Naki BD <noreply@yourdomain.com>
```

**For Nodemailer (development):**
```bash
EMAIL_SERVICE=nodemailer
EMAIL_HOST=localhost
EMAIL_PORT=1025
```

### 1.3 Verify CLIENT_URL

Ensure `CLIENT_URL` is set correctly for password reset links:

```bash
CLIENT_URL=https://yourdomain.com  # Production
# or
CLIENT_URL=http://localhost:5173  # Development
```

### 1.4 Restart Application

Restart your application to load the new environment variables:

```bash
# Development
pnpm run dev

# Production
pnpm start
```

## Step 2: Send Welcome Emails to Existing Users

### 2.1 Verify EMAIL_ENABLED is True

Before running the script, ensure `EMAIL_ENABLED=true` is set in your environment.

### 2.2 Run Welcome Email Script

```bash
pnpm run send-welcome-emails
```

### 2.3 Verify Results

- Check logs for success/failure counts
- Verify emails were sent (check email service dashboard)
- Check database: `welcomeEmailSent` should be `true` for sent users

### 2.4 Manual Verification (Optional)

Query the database to check users who still need welcome emails:

```javascript
// MongoDB query
db.users.find({
  createdViaManualBooking: true,
  welcomeEmailSent: false,
  isActive: true
})
```

## Step 3: Test Email Functionality

### 3.1 Test Registration Email

1. Register a new user via `POST /api/auth/register`
2. Verify OTP email is received
3. Check email service dashboard for delivery status

### 3.2 Test Booking Confirmation

1. Create a booking (user or admin)
2. Approve payment if needed
3. Verify confirmation email is received

### 3.3 Test Password Reset

1. Use "Forgot Password" feature
2. Verify reset email is received
3. Click reset link and verify it works

### 3.4 Test Welcome Email

1. Create a user via manual booking
2. Verify welcome email is sent immediately (if implemented)
3. Or run welcome email script for existing users

## Step 4: Monitor Email Sending

### 4.1 Check Application Logs

Monitor application logs for email sending status:
- Look for `📧 Email sending disabled` messages (should NOT appear when enabled)
- Look for `✅ Email successfully sent` messages
- Check for any error messages

### 4.2 Check Email Service Dashboard

- **Resend**: Check dashboard at https://resend.com/emails for sent emails
- **Nodemailer/MailHog**: Check local mail server interface

### 4.3 Handle Failures

If emails fail, check:
- `EMAIL_ENABLED=true` is set
- Email service credentials are correct
- Email service API is accessible
- Email addresses are valid
- Check application logs for specific error messages

## Step 5: Ongoing Maintenance

### 5.1 New Users via Manual Booking

When emails are enabled, new users created via manual booking will:
- Be marked with `createdViaManualBooking: true`
- Have `welcomeEmailSent: false` initially
- Receive welcome email if code is uncommented in `adminController.ts`
- Or can receive welcome email via the script

### 5.2 Users Who Missed Welcome Emails

If some users didn't receive welcome emails:
- They can use "Forgot Password" feature to set their password
- Or re-run the welcome email script: `pnpm run send-welcome-emails`

### 5.3 Disabling Emails Again (if needed)

If you need to disable emails again:

```bash
# Set EMAIL_ENABLED=false
EMAIL_ENABLED=false

# Restart application
```

## Code Review Checklist

When reactivating emails, review all TODO comments marked "When reactivating emails" in:

### Files to Review:

1. **`src/config/env.ts`**
   - [ ] Verify `EMAIL_ENABLED=true` is set
   - [ ] Verify email service credentials are correct
   - [ ] Verify `CLIENT_URL` is correct

2. **`src/utils/sendEmail.ts`**
   - [ ] Review EMAIL_ENABLED check (decide if it should remain)
   - [ ] Test email sending with actual email service
   - [ ] Verify error handling works correctly

3. **`src/models/User.ts`**
   - [ ] Verify tracking fields are added correctly
   - [ ] Verify indexes are created for efficient queries

4. **`src/controllers/adminController.ts`**
   - [ ] Review manual booking user creation
   - [ ] Consider uncommenting welcome email code if emails should be sent immediately
   - [ ] Test manual booking flow

5. **`src/services/emailServices.ts`**
   - [ ] Test `sendWelcomeEmail()` function
   - [ ] Verify email template is correct
   - [ ] Verify password reset link works
   - [ ] Test with actual users

6. **`scripts/send-welcome-emails-to-existing-users.ts`**
   - [ ] Add EMAIL_ENABLED check before running
   - [ ] Test with small batch first
   - [ ] Consider rate limiting for large batches
   - [ ] Verify script handles errors gracefully

7. **`src/controllers/authController.ts`**
   - [ ] Review OTP email error handling (line 93)
   - [ ] Review password reset email error handling (line 270)
   - [ ] Test both email types

8. **`src/services/supportServices.ts`**
   - [ ] Verify manager email address is correct
   - [ ] Test contact notification delivery

## Critical Review Points

### 1. Environment Configuration (`src/config/env.ts`)
- Verify `EMAIL_ENABLED=true` is set
- Verify email service credentials are correct (RESEND_API_KEY, EMAIL_FROM, etc.)
- Verify CLIENT_URL is correct for password reset links

### 2. Email Sending Function (`src/utils/sendEmail.ts`)
- Review the EMAIL_ENABLED check - decide if it should remain or be removed
- Test email sending with actual email service
- Verify error handling works correctly

### 3. User Registration (`src/controllers/authController.ts` line 93)
- Review error handling - currently throws error in production if email fails
- Consider if registration should succeed even if OTP email fails
- Test OTP email delivery

### 4. Password Reset (`src/controllers/authController.ts` line 270)
- Review error handling - currently throws error if email fails
- Test password reset email delivery
- Verify reset link works correctly

### 5. Booking Confirmation (`src/controllers/adminController.ts` line 648)
- Review if booking confirmation should be sent immediately for manual bookings
- Consider sending confirmation for regular bookings when payment is approved
- Test booking confirmation email template

### 6. Contact Notifications (`src/services/supportServices.ts` line 12)
- Verify manager email address is correct
- Test contact notification delivery
- Consider if notifications should be sent for reports as well

### 7. Welcome Email Function (`src/services/emailServices.ts`)
- Test welcome email template
- Verify password reset token generation works
- Verify email link expiration (10 minutes)
- Test with actual users

### 8. Welcome Email Script (`scripts/send-welcome-emails-to-existing-users.ts`)
- Add EMAIL_ENABLED check before running
- Test with small batch first
- Consider rate limiting for large batches
- Verify script handles errors gracefully

## Troubleshooting

### Emails Not Sending

1. **Check EMAIL_ENABLED:**
   ```bash
   # Verify environment variable is set
   echo $EMAIL_ENABLED  # Should output "true"
   ```

2. **Check Email Service:**
   - Verify RESEND_API_KEY is set (for Resend)
   - Verify EMAIL_HOST and EMAIL_PORT are correct (for Nodemailer)
   - Check email service dashboard for errors

3. **Check Logs:**
   - Look for error messages in application logs
   - Check for "Email sending disabled" messages (should not appear when enabled)

4. **Test Email Service:**
   - Try sending a test email manually
   - Check email service status/health

### Welcome Emails Not Sent

1. **Check User Tracking:**
   ```javascript
   // Verify users are marked correctly
   db.users.find({ createdViaManualBooking: true, welcomeEmailSent: false })
   ```

2. **Check Script Execution:**
   - Verify script ran successfully
   - Check logs for errors
   - Verify EMAIL_ENABLED was true when script ran

3. **Manual Retry:**
   - Re-run the script: `pnpm run send-welcome-emails`
   - Or manually send welcome emails to specific users

### Password Reset Links Not Working

1. **Check CLIENT_URL:**
   - Verify CLIENT_URL is set correctly
   - Ensure it matches your frontend URL
   - Check if URL uses HTTPS in production

2. **Check Token Expiration:**
   - Tokens expire in 10 minutes
   - Verify token generation is working
   - Check if token is being saved correctly

## Notes

- All email code is preserved - no code was deleted
- Email functionality can be toggled via `EMAIL_ENABLED` environment variable
- Users created via manual booking are tracked for future welcome emails
- Welcome email script can be run multiple times safely (idempotent)
- All TODO comments should be reviewed when reactivating emails

