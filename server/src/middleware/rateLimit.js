const rateLimit = require('express-rate-limit');

// Generous on purpose — this is an internal tool for ~20 employees, not a
// public API. The goal is only to stop obvious abuse (a broken client stuck
// in a retry loop, a brute-force password guesser), never to get in the way
// of normal use. No OTP endpoints exist in this app to protect.
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30, // 30 attempts / 10 min / IP — plenty for a mistyped password a few times
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait a few minutes and try again.' },
});

module.exports = { loginLimiter };
