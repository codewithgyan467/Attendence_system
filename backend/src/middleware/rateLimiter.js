const rateLimit = require('express-rate-limit');

// Login rate limiter: max 30 attempts per 15 minutes per IP (disabled in test)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 5000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: {
    success: false,
    error: 'Too many login attempts from this IP address. Please try again after 15 minutes.'
  }
});

// Attendance verification limiter: keyed per student/device to prevent shared hostel Wi-Fi NAT IP throttling
const attendanceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 5000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    return req.user?.id || req.body?.student_id || req.headers['x-device-id'] || req.ip;
  },
  skip: () => process.env.NODE_ENV === 'test',
  message: {
    success: false,
    error: 'Attendance verification rate limit reached. Please wait a moment before trying again.'
  }
});

// General API limiter: keyed per user/device to avoid shared hostel Wi-Fi NAT throttling
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 100000 : 5000,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    return req.user?.id || req.headers['x-device-id'] || req.ip;
  },
  skip: () => process.env.NODE_ENV === 'test',
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
