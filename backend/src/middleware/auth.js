const jwt = require('jsonwebtoken');
const { getQuery, runQuery } = require('../db/database');
const { v4: uuidv4 } = require('uuid');

const JWT_SECRET = process.env.JWT_SECRET || 'hostelguard-enterprise-jwt-key-9f82d1c7';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// Generate signed JWT token
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      studentId: user.student_id || null
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
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

    // Verify user is still active in database
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
  requireAuth,
  requireRole,
  recordAuditEvent,
  JWT_SECRET
};
