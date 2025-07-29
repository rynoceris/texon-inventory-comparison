// Security middleware (middleware/security.js)
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

// Rate limiting for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: {
	error: 'Too many login attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// General rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
	error: 'Too many requests, please try again later.'
  }
});

// Security headers
const securityHeaders = helmet({
  contentSecurityPolicy: {
	directives: {
	  defaultSrc: ["'self'"],
	  styleSrc: ["'self'", "'unsafe-inline'"],
	  scriptSrc: ["'self'"],
	  imgSrc: ["'self'", "data:", "https:"],
	  connectSrc: ["'self'"],
	  fontSrc: ["'self'"],
	  objectSrc: ["'none'"],
	  mediaSrc: ["'self'"],
	  frameSrc: ["'none'"],
	},
  },
  crossOriginEmbedderPolicy: false
});

module.exports = {
  loginLimiter,
  generalLimiter,
  securityHeaders
};