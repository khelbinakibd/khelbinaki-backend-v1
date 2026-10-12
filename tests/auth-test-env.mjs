// Synthetic environment only: production mode prevents dotenv from reading files.
process.env.NODE_ENV = 'production'
Object.assign(process.env, {
  JWT_SECRET: 'synthetic-access-secret-for-offline-tests-only',
  JWT_REFRESH_SECRET: 'synthetic-refresh-secret-for-offline-tests-only',
  MONGODB_URI: 'mongodb://127.0.0.1:1/never_connect',
  CLIENT_URL: 'https://example.invalid',
  SERVER_URL: 'https://example.invalid',
  CLOUDINARY_CLOUD_NAME: 'test',
  CLOUDINARY_API_KEY: 'test',
  CLOUDINARY_API_SECRET: 'test',
  MANAGER_EMAIL: 'test@example.invalid',
  MANAGER_PASSWORD: 'synthetic-test-password',
  EMAIL_SERVICE: 'nodemailer',
  EMAIL_ENABLED: 'false',
})
