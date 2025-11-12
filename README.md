# Turf Booking System - Backend API

A robust Node.js/Express backend API for managing turf bookings, user authentication, and administrative operations.

## 📋 Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [Email Service Setup (Resend)](#email-service-setup-resend)
- [Running the Application](#running-the-application)
- [API Documentation](#api-documentation)
- [Project Structure](#project-structure)
- [Security Features](#security-features)
- [Troubleshooting](#troubleshooting)

## ✨ Features

- **User Authentication**: JWT-based authentication with access and refresh tokens
- **Role-Based Access Control**: Support for user, admin, and manager roles
- **Turf Management**: CRUD operations for turf facilities
- **Booking System**: Create, view, and manage bookings with availability checking
- **Payment Management**: Support for online and manual payment processing
- **Email Notifications**: Automated email notifications using Resend/Nodemailer
- **Image Upload**: Cloudinary integration for turf images
- **Admin Dashboard**: Comprehensive dashboard with analytics
- **Rate Limiting**: Protection against API abuse
- **Request Logging**: Detailed logging with Winston
- **Error Handling**: Centralized error handling with custom error classes

## 🛠 Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js v5
- **Database**: MongoDB with Mongoose
- **Authentication**: JWT (jsonwebtoken)
- **Validation**: Zod
- **Email Service**: Resend (production) / Nodemailer (development)
- **File Upload**: Multer + Cloudinary
- **Security**: Helmet, bcrypt, CORS
- **Logging**: Winston, Morgan
- **Language**: TypeScript

## 📦 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or higher)
- **pnpm** (v10.12.4 or higher) - `npm install -g pnpm`
- **MongoDB** (v6.0 or higher)
- **Git**

## 🚀 Installation

1. **Clone the repository**

```bash
git clone <repository-url>
cd production/backend
```

2. **Install dependencies**

```bash
pnpm install
```

3. **Set up environment variables**

Copy the example environment file and configure it:

```bash
cp .env.example .env.development
```

4. **Generate secure secrets** (Optional)

```bash
pnpm run generate-secrets
```

## 🔐 Environment Variables

Create a `.env.development` file in the backend root directory with the following variables:

### Basic Configuration

```env
NODE_ENV=development
PORT=9000
```

### Database Configuration

```env
# MongoDB connection string
MONGODB_URI=mongodb://127.0.0.1:27017/turf_booking_dev

# Connection pool settings
DB_MAX_POOL_SIZE=10
DB_MIN_POOL_SIZE=2
```

### URLs

```env
# Frontend URL (for CORS)
CLIENT_URL=http://localhost:5173

# Backend URL
SERVER_URL=http://localhost:9000

# Public URL (optional, for production)
PUBLIC_URL=
```

### JWT Configuration

```env
# Generate secure random strings (at least 32 characters for production)
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
JWT_EXPIRES_IN=1h

JWT_REFRESH_SECRET=your-super-secret-refresh-key-min-32-chars
REFRESH_EXPIRES_IN=7d
```

### Security

```env
BCRYPT_SALT_ROUND=10
SECURE_COOKIES=false  # Set to true in production with HTTPS
COOKIE_DOMAIN=        # Set to your domain in production (e.g., .yourdomain.com)
```

### CORS

```env
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
```

### Email Configuration

```env
# Email service (auto-selects: 'resend' in production, 'nodemailer' in development)
EMAIL_SERVICE=nodemailer

# For Nodemailer (Development)
EMAIL_HOST=localhost
EMAIL_PORT=1025
EMAIL_USER=
EMAIL_PASSWORD=
EMAIL_FROM=Khelbi Naki BD <noreply@khelbinaki.com>

# For Resend (Production)
RESEND_API_KEY=re_xxxxxxxxxxxx
```

### Cloudinary (Image Upload)

```env
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

### Manager Account (Default Admin)

```env
MANAGER_NAME=Super Admin
MANAGER_EMAIL=admin@example.com
MANAGER_PASSWORD=SecurePassword123!
```

### Rate Limiting

```env
RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
RATE_LIMIT_MAX_REQUESTS=100
```

### Development/Debug

```env
DEBUG_MODE=true
LOG_LEVEL=info
COMPRESSION=false
CACHE_TTL=3600
```

## 🗄 Database Setup

### Option 1: Local MongoDB Installation

1. **Install MongoDB**
   - **Windows**: Download from [MongoDB Download Center](https://www.mongodb.com/try/download/community)
   - **macOS**: `brew install mongodb-community`
   - **Linux**: Follow [official installation guide](https://docs.mongodb.com/manual/administration/install-on-linux/)

2. **Start MongoDB service**

```bash
# Windows
net start MongoDB

# macOS/Linux
brew services start mongodb-community
# or
sudo systemctl start mongod
```

3. **Verify connection**

```bash
mongosh
# Should connect to mongodb://127.0.0.1:27017
```

4. **Update your `.env.development`**

```env
MONGODB_URI=mongodb://127.0.0.1:27017/turf_booking_dev
```

### Option 2: MongoDB Atlas (Cloud)

1. **Create a MongoDB Atlas account**
   - Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
   - Sign up for a free account

2. **Create a new cluster**
   - Choose the free tier (M0)
   - Select your preferred region

3. **Configure database access**
   - Go to "Database Access"
   - Click "Add New Database User"
   - Create a username and password
   - Grant "Read and write to any database" privileges

4. **Configure network access**
   - Go to "Network Access"
   - Click "Add IP Address"
   - For development, you can choose "Allow Access from Anywhere" (0.0.0.0/0)
   - For production, add specific IP addresses

5. **Get your connection string**
   - Go to "Clusters" → Click "Connect"
   - Choose "Connect your application"
   - Copy the connection string
   - Replace `<password>` with your database user password
   - Replace `<dbname>` with your database name (e.g., `turf_booking_prod`)

6. **Update your `.env.development` or `.env.production`**

```env
MONGODB_URI=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/turf_booking_prod?retryWrites=true&w=majority
```

### Database Seeding

The application automatically creates a manager account on first run using the credentials from environment variables.

## 📧 Email Service Setup (Resend)

### Development (Nodemailer with Mailhog)

For development, use Mailhog to catch emails locally:

1. **Install Mailhog**

```bash
# macOS
brew install mailhog

# Windows - Download from GitHub
# https://github.com/mailhog/MailHog/releases

# Linux
sudo apt-get install mailhog
```

2. **Start Mailhog**

```bash
mailhog
```

3. **Access Mailhog UI**

Open browser to `http://localhost:8025` to view caught emails

4. **Configure `.env.development`**

```env
EMAIL_SERVICE=nodemailer
EMAIL_HOST=localhost
EMAIL_PORT=1025
EMAIL_FROM=Khelbi Naki BD <noreply@khelbinaki.com>
```

### Production (Resend)

Resend is a modern email API service with excellent deliverability.

1. **Create a Resend account**
   - Go to [Resend](https://resend.com)
   - Sign up for a free account (100 emails/day)

2. **Verify your domain** (Recommended for production)
   - Go to "Domains" in Resend dashboard
   - Click "Add Domain"
   - Enter your domain (e.g., `khelbinaki.com`)
   - Add the provided DNS records to your domain provider:
     - **SPF Record**: TXT record for email authentication
     - **DKIM Record**: TXT record for email signing
     - **DMARC Record**: TXT record for email policy
   - Wait for verification (usually takes a few minutes to 24 hours)

3. **Generate API Key**
   - Go to "API Keys" in Resend dashboard
   - Click "Create API Key"
   - Give it a name (e.g., "Production API Key")
   - Select permissions (Full Access for sending emails)
   - Copy the API key (starts with `re_`)

4. **Configure `.env.production`**

```env
EMAIL_SERVICE=resend
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=Khelbi Naki BD <noreply@yourdomain.com>
```

### Using Resend Without Custom Domain

If you don't have a custom domain, you can use Resend's testing domain:

```env
EMAIL_FROM=onboarding@resend.dev
```

**Note**: Emails from `resend.dev` may go to spam. For production, use a verified custom domain.

### Email Templates

The application sends emails for:
- **User Registration**: OTP verification
- **Password Reset**: Password reset link
- **Booking Confirmation**: Booking details and receipt
- **Booking Cancellation**: Cancellation notification
- **Payment Updates**: Payment status changes

## 🏃 Running the Application

### Development Mode

```bash
pnpm run dev
```

The server will start at `http://localhost:9000` with hot-reloading enabled.

### Production Build

```bash
# Build TypeScript to JavaScript
pnpm run build

# Start production server
pnpm start
```

### Available Scripts

```bash
pnpm run dev          # Start development server with hot-reload
pnpm run build        # Compile TypeScript to JavaScript
pnpm start            # Run production build
pnpm run lint         # Check code style
pnpm run lint:fix     # Fix code style issues
pnpm run type-check   # Check TypeScript types
```

## 📚 API Documentation

Base URL: `http://localhost:9000/api/v1`

### Authentication Endpoints

#### Register New User

```http
POST /auth/register
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "SecurePass123!",
  "phone": "+8801712345678"
}
```

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "Registration successful. Please verify your email with the OTP sent.",
  "data": {
    "userId": "user_id_here",
    "email": "john@example.com"
  }
}
```

#### Verify OTP

```http
POST /auth/verify-otp
Content-Type: application/json

{
  "email": "john@example.com",
  "otp": "123456"
}
```

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "Email verified successfully",
  "data": {
    "accessToken": "jwt_token_here",
    "user": {
      "id": "user_id",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "user"
    }
  }
}
```

#### Login

```http
POST /auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "SecurePass123!"
}
```

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "accessToken": "jwt_access_token",
    "user": {
      "id": "user_id",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "user",
      "isVerified": true
    }
  }
}
```

**Note**: Refresh token is sent as HTTP-only cookie.

#### Refresh Token

```http
POST /auth/refresh-token
Cookie: refreshToken=xxx
```

**Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "accessToken": "new_jwt_access_token"
  }
}
```

#### Forgot Password

```http
POST /auth/forgot-password
Content-Type: application/json

{
  "email": "john@example.com"
}
```

#### Reset Password

```http
PATCH /auth/reset-password/:token
Content-Type: application/json

{
  "password": "NewSecurePass123!"
}
```

#### Logout

```http
POST /auth/logout
Authorization: Bearer <access_token>
```

#### Get Current User

```http
GET /auth/me
Authorization: Bearer <access_token>
```

### User Endpoints

#### Get My Profile

```http
GET /users/me
Authorization: Bearer <access_token>
```

**Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "id": "user_id",
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+8801712345678",
    "role": "user",
    "isVerified": true,
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

#### Update My Profile

```http
PATCH /users/me
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "name": "John Updated",
  "phone": "+8801798765432"
}
```

### Turf Endpoints

#### Get All Turfs (Public)

```http
GET /turfs?page=1&limit=10&city=Dhaka&search=football
```

**Query Parameters**:
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)
- `city` (optional): Filter by city
- `search` (optional): Search in name and description
- `minPrice` (optional): Minimum price filter
- `maxPrice` (optional): Maximum price filter
- `amenities` (optional): Filter by amenities (comma-separated)

**Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "turfs": [
      {
        "id": "turf_id",
        "name": "Premier Football Turf",
        "slug": "premier-football-turf",
        "description": "Professional grade football turf",
        "location": {
          "address": "123 Stadium Road",
          "city": "Dhaka",
          "coordinates": {
            "lat": 23.8103,
            "lng": 90.4125
          }
        },
        "pricing": {
          "regular": 1500,
          "peak": 2000
        },
        "amenities": ["Parking", "Washroom", "Lighting"],
        "image": "cloudinary_url",
        "isActive": true
      }
    ],
    "pagination": {
      "total": 50,
      "page": 1,
      "limit": 10,
      "pages": 5
    }
  }
}
```

#### Get Single Turf (Public)

```http
GET /turfs/:identifier
```

`:identifier` can be either turf ID or slug

#### Get Turf Availability (Public)

```http
GET /turfs/:id/availability?date=2024-12-25
```

**Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "date": "2024-12-25",
    "availableSlots": [
      {
        "startTime": "06:00",
        "endTime": "08:00",
        "price": 1500,
        "isPeakHour": false
      },
      {
        "startTime": "08:00",
        "endTime": "10:00",
        "price": 2000,
        "isPeakHour": true
      }
    ]
  }
}
```

#### Create Turf (Admin/Manager)

```http
POST /turfs
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "name": "New Football Turf",
  "description": "Brand new turf facility",
  "location": {
    "address": "456 Sports Avenue",
    "city": "Dhaka",
    "coordinates": {
      "lat": 23.8103,
      "lng": 90.4125
    }
  },
  "pricing": {
    "regular": 1500,
    "peak": 2000
  },
  "operatingHours": {
    "open": "06:00",
    "close": "23:00"
  },
  "amenities": ["Parking", "Washroom", "Lighting", "Cafeteria"]
}
```

#### Update Turf (Admin/Manager)

```http
PATCH /turfs/:id
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "name": "Updated Turf Name",
  "pricing": {
    "regular": 1600,
    "peak": 2100
  }
}
```

#### Delete Turf (Admin/Manager)

```http
DELETE /turfs/:id
Authorization: Bearer <admin_token>
```

### Booking Endpoints

#### Create Booking

```http
POST /bookings
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "turfId": "turf_id_here",
  "date": "2024-12-25",
  "startTime": "14:00",
  "endTime": "16:00",
  "paymentMethod": "online",
  "notes": "Birthday celebration"
}
```

**Response (201 Created)**:
```json
{
  "success": true,
  "message": "Booking created successfully",
  "data": {
    "id": "booking_id",
    "turf": {
      "name": "Premier Football Turf",
      "location": "Dhaka"
    },
    "date": "2024-12-25",
    "startTime": "14:00",
    "endTime": "16:00",
    "totalPrice": 4000,
    "paymentStatus": "pending",
    "bookingStatus": "pending"
  }
}
```

#### Get My Bookings

```http
GET /bookings/my-bookings?page=1&limit=10&status=confirmed
```

**Query Parameters**:
- `page` (optional): Page number
- `limit` (optional): Items per page
- `status` (optional): Filter by booking status (pending, confirmed, cancelled, completed)
- `paymentStatus` (optional): Filter by payment status

#### Get Booking Details

```http
GET /bookings/:id
Authorization: Bearer <access_token>
```

#### Update Booking Status (Admin/Manager)

```http
PATCH /bookings/:id/status
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "status": "confirmed"
}
```

**Booking Status Values**:
- `pending`: Initial state
- `confirmed`: Admin confirmed
- `cancelled`: Cancelled by user or admin
- `completed`: Booking completed

#### Cancel My Booking

```http
PATCH /bookings/:id/cancel
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "reason": "Change of plans"
}
```

### Admin Endpoints

All admin endpoints require authentication and appropriate role (admin/manager).

#### Get Dashboard Stats

```http
GET /admin/dashboard
Authorization: Bearer <admin_token>
```

**Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "totalRevenue": 150000,
    "totalBookings": 245,
    "activeUsers": 89,
    "activeTurfs": 12,
    "pendingBookings": 5,
    "recentBookings": [],
    "revenueByMonth": []
  }
}
```

#### Get All Bookings (Admin)

```http
GET /admin/bookings?page=1&limit=20&status=pending&date=2024-12-25
```

#### Create Admin Booking (Manual)

```http
POST /admin/bookings
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "turfId": "turf_id",
  "customerName": "Walk-in Customer",
  "customerPhone": "+8801712345678",
  "customerEmail": "customer@example.com",
  "date": "2024-12-25",
  "startTime": "14:00",
  "endTime": "16:00",
  "paymentMethod": "cash",
  "paymentStatus": "paid"
}
```

#### Update Booking Payment

```http
PATCH /admin/bookings/:id/payment
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "paymentStatus": "paid",
  "paymentMethod": "cash"
}
```

#### Approve Manual Payment

```http
PATCH /admin/bookings/:id/approve-payment
Authorization: Bearer <admin_token>
```

#### Cancel Booking (Admin)

```http
PATCH /admin/bookings/:id/cancel
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "reason": "Maintenance required"
}
```

#### Delete Booking (Admin)

```http
DELETE /admin/bookings/:id
Authorization: Bearer <admin_token>
```

#### Get All Users (Manager)

```http
GET /admin/users?page=1&limit=20&role=user&search=john
```

#### Update User (Manager)

```http
PATCH /admin/users/:id
Authorization: Bearer <manager_token>
Content-Type: application/json

{
  "name": "Updated Name",
  "role": "admin"
}
```

#### Create Admin User (Manager)

```http
POST /admin/users/admin
Authorization: Bearer <manager_token>
Content-Type: application/json

{
  "name": "New Admin",
  "email": "admin@example.com",
  "password": "SecurePass123!",
  "phone": "+8801712345678",
  "role": "admin"
}
```

#### Update User Status (Manager)

```http
PATCH /admin/users/:id/status
Authorization: Bearer <manager_token>
Content-Type: application/json

{
  "isActive": false
}
```

#### Get Turfs for Admin

```http
GET /admin/turfs
Authorization: Bearer <admin_token>
```

#### Upload Turf Image

```http
POST /admin/turfs/:id/image
Authorization: Bearer <admin_token>
Content-Type: multipart/form-data

image: <file>
```

#### Get Reports (Manager)

```http
GET /admin/reports?page=1&limit=20&status=pending
```

#### Get Single Report

```http
GET /admin/reports/:id
Authorization: Bearer <admin_token>
```

#### Update Report Status

```http
PATCH /admin/reports/:id/status
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "status": "resolved",
  "adminNotes": "Issue has been resolved"
}
```

#### Delete Report

```http
DELETE /admin/reports/:id
Authorization: Bearer <admin_token>
```

### Support Endpoints

#### Submit Contact Message (Public)

```http
POST /contact
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "subject": "Question about booking",
  "message": "I would like to know..."
}
```

#### Submit Report (Optional Auth)

```http
POST /report
Authorization: Bearer <access_token> (optional)
Content-Type: application/json

{
  "type": "bug",
  "title": "Issue with payment",
  "description": "Detailed description of the issue",
  "priority": "high"
}
```

**Report Types**:
- `bug`: Technical bug
- `feature`: Feature request
- `complaint`: Service complaint
- `other`: Other issues

### Health Check

```http
GET /health
```

**Response (200 OK)**:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "uptime": 3600,
  "environment": "development",
  "version": "1.0.0",
  "services": {
    "database": {
      "status": "connected",
      "connected": true
    },
    "email": {
      "service": "nodemailer",
      "configured": true
    }
  },
  "memory": {
    "used": "45MB",
    "total": "128MB"
  }
}
```

## 📁 Project Structure

```
backend/
├── src/
│   ├── config/
│   │   └── env.ts              # Environment configuration
│   ├── controllers/            # Route controllers
│   │   ├── authController.ts
│   │   ├── userController.ts
│   │   ├── turfController.ts
│   │   ├── bookingController.ts
│   │   ├── adminController.ts
│   │   └── supportController.ts
│   ├── middlewares/            # Express middlewares
│   │   ├── authMiddleware.ts   # JWT authentication
│   │   ├── roleMiddleware.ts   # Role-based access control
│   │   ├── errorHandler.ts     # Error handling
│   │   ├── rateLimitMiddleware.ts
│   │   └── requestLogger.ts
│   ├── models/                 # Mongoose models
│   │   ├── User.ts
│   │   ├── Turf.ts
│   │   ├── Booking.ts
│   │   ├── Otp.ts
│   │   ├── RefreshToken.ts
│   │   ├── ContactMessage.ts
│   │   └── Report.ts
│   ├── routes/                 # API routes
│   │   ├── authRoutes.ts
│   │   ├── userRoutes.ts
│   │   ├── turfRoutes.ts
│   │   ├── bookingRoutes.ts
│   │   ├── adminRoutes.ts
│   │   └── supportRoutes.ts
│   ├── schemas/                # Zod validation schemas
│   │   ├── authSchema.ts
│   │   ├── userSchema.ts
│   │   ├── turfSchema.ts
│   │   ├── bookingSchema.ts
│   │   └── supportSchema.ts
│   ├── services/               # Business logic
│   │   ├── emailServices.ts
│   │   ├── bookingServices.ts
│   │   ├── turfServices.ts
│   │   ├── userServices.ts
│   │   ├── uploadService.ts
│   │   ├── dashboardService.ts
│   │   └── cleanupServices.ts
│   ├── utils/                  # Utility functions
│   │   ├── AppError.ts         # Custom error class
│   │   ├── asyncHandler.ts     # Async error wrapper
│   │   ├── jwt.ts              # JWT utilities
│   │   ├── logger.ts           # Winston logger
│   │   ├── pagination.ts       # Pagination helper
│   │   └── sendEmail.ts        # Email sending utility
│   ├── lib/                    # Library code
│   │   ├── db.ts               # Database connection
│   │   └── seed.ts             # Database seeding
│   ├── app.ts                  # Express app configuration
│   └── index.ts                # Server entry point
├── scripts/
│   └── generate-secrets.sh     # Generate JWT secrets
├── .env.example                # Example environment file
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## 🔒 Security Features

- **JWT Authentication**: Secure access and refresh token implementation
- **Password Hashing**: bcrypt with configurable salt rounds
- **HTTP-Only Cookies**: Secure refresh token storage
- **Rate Limiting**: Protection against brute force attacks
- **CORS Configuration**: Strict origin validation
- **Helmet**: Security headers middleware
- **Input Validation**: Zod schema validation for all inputs
- **Role-Based Access**: Fine-grained permission system
- **Request Logging**: Comprehensive audit trail
- **Error Sanitization**: No sensitive data in error responses

## 🐛 Troubleshooting

### Database Connection Issues

**Problem**: Cannot connect to MongoDB

**Solutions**:
- Verify MongoDB is running: `mongosh`
- Check `MONGODB_URI` in your `.env` file
- For Atlas: Verify IP whitelist and credentials
- Check firewall settings

### Email Not Sending

**Problem**: Emails are not being sent

**Solutions**:
- **Development**: Ensure Mailhog is running on port 1025
- **Production**: Verify Resend API key is correct
- Check `EMAIL_SERVICE` is set correctly
- Verify email configuration in `.env` file
- Check application logs for email errors

### JWT Token Errors

**Problem**: "Invalid token" or "Token expired"

**Solutions**:
- Ensure `JWT_SECRET` and `JWT_REFRESH_SECRET` are set
- Check token expiration times
- Clear cookies and login again
- Verify clock sync on server

### CORS Errors

**Problem**: Cross-origin request blocked

**Solutions**:
- Add frontend URL to `CLIENT_URL` in `.env`
- Verify `CORS_ORIGINS` includes your frontend
- Check `withCredentials: true` in frontend requests
- Ensure proper cookie configuration

### Port Already in Use

**Problem**: Port 9000 already in use

**Solutions**:
```bash
# Find process using port
# Windows
netstat -ano | findstr :9000

# macOS/Linux
lsof -ti:9000

# Kill the process
# Windows
taskkill /PID <PID> /F

# macOS/Linux
kill -9 <PID>
```

### Build Errors

**Problem**: TypeScript compilation errors

**Solutions**:
```bash
# Clean install
rm -rf node_modules pnpm-lock.yaml
pnpm install

# Type check
pnpm run type-check

# Check for missing dependencies
pnpm install --force
```

## 📝 Additional Resources

- [Express.js Documentation](https://expressjs.com/)
- [MongoDB Documentation](https://docs.mongodb.com/)
- [Mongoose Documentation](https://mongoosejs.com/)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
- [Resend Documentation](https://resend.com/docs)
- [Cloudinary Documentation](https://cloudinary.com/documentation)

## 📄 License

ISC

## 👥 Support

For issues and questions:
- Create an issue in the repository
- Contact the development team
- Check the troubleshooting section above

---

**Happy Coding! 🚀**