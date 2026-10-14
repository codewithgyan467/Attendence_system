const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getQuery, runQuery } = require('../db/database');
const { v4: uuidv4 } = require('uuid');

const JWT_SECRET = process.env.JWT_SECRET || 'hostelguard-enterprise-jwt-key-9f82d1c7';
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || '15m';
const REFRESH_TOKEN_DAYS = parseInt(process.env.REFRESH_TOKEN_DAYS || '7', 10);
const JWT_ISSUER = 'hostelguard-auth';
const JWT_AUDIENCE = 'hostelguard-app';

// Helper to hash opaque refresh tokens for safe database storage
function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// Generate short-lived cryptographically signed Access Token
function generateAccessToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email || null,
      role: user.role,
      studentId: user.student_id || null
    },
    JWT_SECRET,
    {
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    }
  );
}

// Backward-compatible alias for existing callers
function generateToken(user) {
  return generateAccessToken(user);
}

// Create and store a new opaque Refresh Token (7-day validity)
async function createRefreshToken(userId, req = null) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const ipAddress = req?.headers['x-forwarded-for'] || req?.socket?.remoteAddress || '127.0.0.1';
  const deviceInfo = req?.headers['user-agent'] || 'Unknown Client';

  await runQuery(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, device_info, ip_address, expires_at, is_revoked)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `, [uuidv4(), userId, tokenHash, String(deviceInfo).slice(0, 255), String(ipAddress), expiresAt]);

  return {
    refreshToken: rawToken,
    expiresAt
  };
}

// Rotate Refresh Token with automatic Compromise Detection (Token Family Defense)
async function rotateRefreshToken(rawToken, req = null) {
  if (!rawToken || typeof rawToken !== 'string') {
    throw new Error('Refresh token is required.');
  }

  const tokenHash = hashToken(rawToken.trim());
  const record = await getQuery(`SELECT * FROM refresh_tokens WHERE token_hash = ?`, [tokenHash]);

  if (!record) {
    throw new Error('Invalid refresh token.');
  }

  // Token Reuse Attack Detected: If a revoked token is presented, compromise is assumed!
  // Invalidate all active sessions for this user immediately.
  if (record.is_revoked === 1) {
    await runQuery(`UPDATE refresh_tokens SET is_revoked = 1 WHERE user_id = ?`, [record.user_id]);
    throw new Error('Compromised refresh token detected. All active sessions have been terminated for security.');
  }

  if (new Date(record.expires_at).getTime() < Date.now()) {
    await runQuery(`UPDATE refresh_tokens SET is_revoked = 1 WHERE id = ?`, [record.id]);
    throw new Error('Refresh token has expired. Please sign in again.');
  }

  // Confirm user account is still valid and active
  const user = await getQuery(`SELECT id, username, email, role, student_id, is_active FROM users WHERE id = ?`, [record.user_id]);
  if (!user || user.is_active !== 1) {
    throw new Error('User account is deactivated or no longer exists.');
  }

  // Revoke current token (Single-use rotation)
  await runQuery(`UPDATE refresh_tokens SET is_revoked = 1 WHERE id = ?`, [record.id]);

  // Issue new Access Token and rotated Refresh Token
  const newAccessToken = generateAccessToken(user);
  const newRefresh = await createRefreshToken(user.id, req);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefresh.refreshToken,
    token: newAccessToken, // backward compatibility
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      studentId: user.student_id
    }
  };
}

// Revoke a single refresh token (e.g. standard logout)
async function revokeRefreshToken(rawToken) {
  if (!rawToken) return;
  const tokenHash = hashToken(rawToken.trim());
  await runQuery(`UPDATE refresh_tokens SET is_revoked = 1 WHERE token_hash = ?`, [tokenHash]);
}

// Revoke all refresh tokens for a user (e.g. password change, admin lockout, logout all)
async function revokeAllUserSessions(userId) {
  if (!userId) return;
  await runQuery(`UPDATE refresh_tokens SET is_revoked = 1 WHERE user_id = ?`, [userId]);
}

// Authentication Middleware: verifies Bearer token and checks user state in DB
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Please provide a valid Bearer token.'
      });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({
        success: false,
        error: err.name === 'TokenExpiredError' ? 'Session expired. Please log in again.' : 'Invalid authentication token.'
      });
    }

    // Verify user is still active in database (Immediate Revocation Enforcement)
    const user = await getQuery(`SELECT id, username, email, role, student_id, is_active FROM users WHERE id = ?`, [decoded.id]);
    if (!user || user.is_active !== 1) {
      return res.status(401).json({
        success: false,
        error: 'Account deactivated or no longer exists.'
      });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('Auth Middleware Error:', err);
    res.status(500).json({ success: false, error: 'Internal authentication error.' });
  }
}

// Optional Authentication Middleware: populates req.user if Bearer token present, but does not block if missing
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await getQuery(`SELECT id, username, email, role, student_id, is_active FROM users WHERE id = ?`, [decoded.id]);
        if (user && user.is_active === 1) {
          req.user = user;
        }
      } catch (_) {
        // Silently proceed for optional auth
      }
    }
    next();
  } catch (err) {
    next();
  }
}

// Role-Based Access Control Guard
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `Access denied. Requires one of the following roles: [${allowedRoles.join(', ')}].`
      });
    }

    next();
  };
}

// Audit Log Helper for Administrative & Staff actions
async function recordAuditEvent(userId, username, action, targetType, targetId, details, req = null) {
  try {
    const ipAddress = req?.headers['x-forwarded-for'] || req?.socket?.remoteAddress || '127.0.0.1';
    await runQuery(`
      INSERT INTO admin_audit_events (id, user_id, username, action, target_type, target_id, details, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [uuidv4(), userId, username, action, targetType, targetId || null, details || '', String(ipAddress)]);
  } catch (err) {
    console.error('Failed to log audit event:', err);
  }
}

module.exports = {
  generateToken,
  generateAccessToken,
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserSessions,
  requireAuth,
  optionalAuth,
  requireRole,
  recordAuditEvent,
  JWT_SECRET,
  ACCESS_TOKEN_EXPIRES_IN,
  REFRESH_TOKEN_DAYS
};


