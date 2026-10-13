const rateLimit = require('express-rate-limit');

// Login rate limiter: max 15 attempts per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many login attempts from this IP address. Please try again after 15 minutes.'
  }
});

// Attendance verification limiter: max 40 attempts per minute
const attendanceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Attendance verification rate limit reached. Please wait a moment before trying again.'
  }
});

// General API limiter: max 300 requests per 15 minutes
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many API requests from this client. Please slow down.'
  }
});

module.exports = {
  authLimiter,
  attendanceLimiter,
  generalLimiter
};
