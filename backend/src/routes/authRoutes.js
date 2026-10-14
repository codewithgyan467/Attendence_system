const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getQuery, runQuery } = require('../db/database');
const {
  generateToken,
  generateAccessToken,
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserSessions,
  requireAuth,
  recordAuditEvent,
  JWT_SECRET
} = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');

// 1. User Login (Issues Short-Lived Access Token + Rotated Refresh Token)
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required.' });
    }

    const user = await getQuery(`
      SELECT id, username, email, password_hash, role, student_id, is_active, must_change_password
      FROM users
      WHERE username = ? OR email = ?
    `, [username.trim(), username.trim()]);

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid username or password.' });
    }

    if (user.is_active !== 1) {
      return res.status(403).json({ success: false, error: 'Account has been deactivated. Please contact hostel administration.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid username or password.' });
    }

    // Fetch student profile if student
    let studentProfile = null;
    if (user.role === 'STUDENT' && user.student_id) {
      studentProfile = await getQuery(`SELECT * FROM students WHERE id = ?`, [user.student_id]);
    }

    const accessToken = generateAccessToken(user);
    const refreshResult = await createRefreshToken(user.id, req);

    // Audit log
    await recordAuditEvent(user.id, user.username, 'USER_LOGIN', 'USER', user.id, `User logged in with role ${user.role}`, req);

    res.json({
      success: true,
      message: 'Login successful.',
      token: accessToken, // backward compatibility
      accessToken,
      refreshToken: refreshResult.refreshToken,
      refreshTokenExpiresAt: refreshResult.expiresAt,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        studentId: user.student_id,
        mustChangePassword: Boolean(user.must_change_password),
        studentProfile
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: 'Server authentication failure: ' + err.message });
  }
});

// 2. Token Refresh Endpoint (Rotates Refresh Token & Detects Reused Compromised Tokens)
router.post('/refresh', authLimiter, async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, error: 'Refresh token is required.' });
    }

    const rotationResult = await rotateRefreshToken(refreshToken, req);
    res.json({
      success: true,
      message: 'Token refreshed successfully.',
      ...rotationResult
    });
  } catch (err) {
    res.status(401).json({ success: false, error: err.message });
  }
});

// 3. Current User Profile
router.get('/me', requireAuth, async (req, res) => {
  try {
    let studentProfile = null;
    if (req.user.role === 'STUDENT') {
      studentProfile = await getQuery(`
        SELECT s.*,
          (SELECT COUNT(*) FROM student_face_embeddings e WHERE e.student_id = s.id) as embeddings_count
        FROM students s
        WHERE s.id = ? OR s.user_id = ?
      `, [req.user.student_id, req.user.id]);
    }

    res.json({
      success: true,
      user: {
        ...req.user,
        studentProfile
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Change Password (Forces Revocation of All Active Sessions on Other Devices)
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ success: false, error: 'Current password and new password are required.' });
    }

    if (new_password.length < 8) {
      return res.status(400).json({ success: false, error: 'New password must be at least 8 characters long.' });
    }

    const user = await getQuery(`SELECT password_hash FROM users WHERE id = ?`, [req.user.id]);
    const isMatch = await bcrypt.compare(current_password, user.password_hash);

    if (!isMatch) {
      return res.status(400).json({ success: false, error: 'Incorrect current password.' });
    }

    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(new_password, salt);

    await runQuery(`
      UPDATE users
      SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [newHash, req.user.id]);

    // Security Hardening: Invalidate all existing sessions / refresh tokens
    await revokeAllUserSessions(req.user.id);

    await recordAuditEvent(req.user.id, req.user.username, 'PASSWORD_CHANGE', 'USER', req.user.id, 'User changed their password (all prior sessions revoked)', req);

    res.json({ success: true, message: 'Password changed successfully. Please log in with your new credentials.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Logout Single Device / Session
router.post('/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    }
    if (req.headers.authorization) {
      try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded && decoded.id) {
          await recordAuditEvent(decoded.id, decoded.username || 'USER', 'USER_LOGOUT', 'USER', decoded.id, 'User logged out', req);
        }
      } catch (_) {}
    }
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    res.json({ success: true, message: 'Logged out.' });
  }
});

// 6. Logout All Devices / Force Revoke All Sessions
router.post('/logout-all', requireAuth, async (req, res) => {
  try {
    await revokeAllUserSessions(req.user.id);
    await recordAuditEvent(req.user.id, req.user.username, 'USER_LOGOUT_ALL', 'USER', req.user.id, 'User revoked all active sessions across devices', req);
    res.json({ success: true, message: 'All active sessions and refresh tokens have been revoked.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================================
// PASSWORD RESET SYSTEM (EMAIL OTP & PHONE SMS OTP)
// =========================================================================
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { sendEmailOtp, sendSmsOtp, maskEmail, maskPhone, verifyPhoneEmailJsonUrl } = require('../services/notificationService');

// Helper to find student & user identity across roll number, email, or phone
async function resolveStudentIdentity(identifier) {
  const clean = identifier.trim();

  // 1. Query students joined with users
  let record = await getQuery(`
    SELECT
      s.id as student_id,
      s.roll_number,
      s.full_name,
      s.email as student_email,
      s.phone as student_phone,
      s.user_id,
      s.is_active as student_active,
      u.id as user_account_id,
      u.username,
      u.email as user_email,
      u.role,
      u.is_active as user_active
    FROM students s
    LEFT JOIN users u ON (s.user_id = u.id OR s.roll_number = u.username)
    WHERE s.roll_number = ?
       OR s.email = ?
       OR s.phone = ?
       OR u.email = ?
       OR u.username = ?
    LIMIT 1
  `, [clean, clean, clean, clean, clean]);

  if (record) return record;

  // 2. Query users directly if not found in students (e.g. staff or pure user accounts)
  const user = await getQuery(`
    SELECT
      id as user_account_id,
      username,
      email as user_email,
      role,
      student_id,
      is_active as user_active
    FROM users
    WHERE username = ? OR email = ?
    LIMIT 1
  `, [clean, clean]);

  if (user) {
    return {
      student_id: user.student_id,
      roll_number: user.username,
      full_name: user.username,
      student_email: user.user_email,
      student_phone: null,
      user_id: user.user_account_id,
      student_active: user.user_active,
      user_account_id: user.user_account_id,
      username: user.username,
      user_email: user.user_email,
      role: user.role,
      user_active: user.user_active
    };
  }

  return null;
}

// 5. Request Password Reset OTP (Email or Phone)
router.post('/forgot-password/request-otp', authLimiter, async (req, res) => {
  try {
    const { identifier, method = 'EMAIL' } = req.body;

    if (!identifier || !identifier.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Please enter your Roll Number, registered Email, or Phone number.'
      });
    }

    const cleanMethod = String(method).toUpperCase();
    if (!['EMAIL', 'PHONE'].includes(cleanMethod)) {
      return res.status(400).json({ success: false, error: 'Reset method must be EMAIL or PHONE.' });
    }

    const identity = await resolveStudentIdentity(identifier);
    if (!identity) {
      return res.status(404).json({
        success: false,
        error: `No registered account found matching "${identifier.trim()}". Please verify your roll number or contact hostel administration.`
      });
    }

    if (identity.user_active === 0 || identity.student_active === 0) {
      return res.status(403).json({
        success: false,
        error: 'This account has been deactivated. Please contact the hostel administration or warden.'
      });
    }

    // Determine destination target
    let destination = '';
    if (cleanMethod === 'EMAIL') {
      destination = identity.student_email || identity.user_email;
      if (!destination) {
        return res.status(400).json({
          success: false,
          error: `No registered email address found for ${identity.roll_number || identity.full_name}. Please choose Phone/SMS reset or contact administration.`
        });
      }
    } else {
      destination = identity.student_phone;
      if (!destination) {
        return res.status(400).json({
          success: false,
          error: `No mobile phone number registered for ${identity.roll_number || identity.full_name}. Please choose Email reset or contact administration.`
        });
      }
    }

    // Rate-limit: Check recent OTP requests in last 10 minutes
    const recentOtps = await getQuery(`
      SELECT COUNT(*) as count
      FROM password_reset_otps
      WHERE (identifier = ? OR destination = ?)
        AND created_at > datetime('now', '-10 minutes')
    `, [identity.roll_number, destination]);

    if (process.env.NODE_ENV !== 'test' && recentOtps && recentOtps.count >= 5) {
      return res.status(429).json({
        success: false,
        error: 'Too many OTP requests for this account. Please wait 10 minutes before requesting a new code.'
      });
    }

    // Generate cryptographically random 6-digit OTP
    const otpCode = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const otpId = uuidv4();

    // Invalidate previous unexpired OTPs for this identifier
    await runQuery(`
      UPDATE password_reset_otps
      SET is_used = 1
      WHERE identifier = ? AND is_used = 0
    `, [identity.roll_number]);

    // Save OTP record
    await runQuery(`
      INSERT INTO password_reset_otps (
        id, identifier, user_id, otp_code, method, destination, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      otpId,
      identity.roll_number,
      identity.user_account_id || null,
      otpCode,
      cleanMethod,
      destination,
      expiresAt
    ]);

    // Dispatch OTP
    let dispatchResult;
    if (cleanMethod === 'EMAIL') {
      const origin = req.headers.origin || req.headers.referer?.replace(/\/+$/, '') || 'http://localhost:5173';
      const magicToken = jwt.sign(
        {
          resetOtpId: otpId,
          identifier: identity.roll_number,
          userId: identity.user_account_id,
          type: 'PASSWORD_RESET'
        },
        JWT_SECRET,
        { expiresIn: '15m' }
      );
      const magicLinkUrl = `${origin}?mode=reset&token=${encodeURIComponent(magicToken)}`;

      dispatchResult = await sendEmailOtp({
        email: destination,
        otpCode,
        studentName: identity.full_name,
        rollNumber: identity.roll_number,
        magicLinkUrl
      });
    } else {
      dispatchResult = await sendSmsOtp({
        phone: destination,
        otpCode,
        studentName: identity.full_name,
        rollNumber: identity.roll_number
      });
    }

    // Record audit event
    await recordAuditEvent(
      identity.user_account_id || 'ANONYMOUS',
      identity.roll_number || 'STUDENT',
      'PASSWORD_RESET_OTP_REQUEST',
      'USER',
      identity.user_account_id || null,
      `Requested ${cleanMethod} OTP reset sent to ${dispatchResult.maskedDestination}`,
      req
    );

    res.json({
      success: true,
      message: `A 6-digit verification code has been dispatched via ${cleanMethod === 'EMAIL' ? 'Email' : 'SMS'} to ${dispatchResult.maskedDestination}.`,
      identifier: identity.roll_number,
      method: cleanMethod,
      maskedDestination: dispatchResult.maskedDestination,
      expiresInMinutes: 10,
      magicLinkUrl: dispatchResult.magicLinkUrl || null,
      previewUrl: dispatchResult.previewUrl || null,
      ...(process.env.NODE_ENV === 'test' ? { debugOtp: dispatchResult.debugOtp } : {})
    });
  } catch (err) {
    console.error('Request OTP error:', err);
    res.status(500).json({ success: false, error: 'Failed to process OTP request: ' + err.message });
  }
});

// 6. Verify Reset OTP
router.post('/forgot-password/verify-otp', authLimiter, async (req, res) => {
  try {
    const { identifier, otp } = req.body;

    if (!identifier || !otp) {
      return res.status(400).json({ success: false, error: 'Identifier and 6-digit OTP code are required.' });
    }

    const cleanIdentifier = identifier.trim();
    const cleanOtp = String(otp).trim();

    // Find active OTP record
    const otpRecord = await getQuery(`
      SELECT * FROM password_reset_otps
      WHERE (identifier = ? OR destination = ?)
        AND is_used = 0
        AND datetime(expires_at) > datetime('now')
      ORDER BY created_at DESC
      LIMIT 1
    `, [cleanIdentifier, cleanIdentifier]);

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired verification code. Please request a new OTP.'
      });
    }

    if (otpRecord.attempts >= 5) {
      await runQuery(`UPDATE password_reset_otps SET is_used = 1 WHERE id = ?`, [otpRecord.id]);
      return res.status(400).json({
        success: false,
        error: 'Too many incorrect attempts. This OTP has been invalidated for security. Please request a new one.'
      });
    }

    // Increment attempts
    await runQuery(`UPDATE password_reset_otps SET attempts = attempts + 1 WHERE id = ?`, [otpRecord.id]);

    if (otpRecord.otp_code !== cleanOtp) {
      return res.status(400).json({
        success: false,
        error: 'Incorrect verification code. Please verify the 6 digits and try again.'
      });
    }

    // Generate signed temporary reset token valid for 15 minutes
    const resetToken = jwt.sign(
      {
        resetOtpId: otpRecord.id,
        identifier: otpRecord.identifier,
        userId: otpRecord.user_id,
        type: 'PASSWORD_RESET'
      },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.json({
      success: true,
      message: 'OTP verified successfully. You may now enter your new password.',
      resetToken,
      identifier: otpRecord.identifier
    });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ success: false, error: 'Failed to verify OTP: ' + err.message });
  }
});

// 7. Reset Password (Completes verification and updates password)
router.post('/forgot-password/reset', authLimiter, async (req, res) => {
  try {
    const { resetToken, identifier, otp, new_password, confirm_password } = req.body;

    const passwordToSet = new_password || req.body.newPassword;
    if (!passwordToSet) {
      return res.status(400).json({ success: false, error: 'New password is required.' });
    }

    if (passwordToSet.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters long.' });
    }

    if (confirm_password && confirm_password !== passwordToSet) {
      return res.status(400).json({ success: false, error: 'Passwords do not match.' });
    }

    let targetIdentifier = identifier ? identifier.trim() : null;
    let otpRecordId = null;

    // Verify via resetToken OR direct identifier + otp
    if (resetToken) {
      try {
        const decoded = jwt.verify(resetToken, JWT_SECRET);
        if (decoded.type !== 'PASSWORD_RESET') {
          return res.status(400).json({ success: false, error: 'Invalid reset token type.' });
        }
        targetIdentifier = decoded.identifier;
        otpRecordId = decoded.resetOtpId;
      } catch (tokenErr) {
        return res.status(400).json({ success: false, error: 'Reset session expired. Please request a new OTP.' });
      }
    } else if (targetIdentifier && otp) {
      const cleanOtp = String(otp).trim();
      const otpRow = await getQuery(`
        SELECT * FROM password_reset_otps
        WHERE (identifier = ? OR destination = ?)
          AND is_used = 0
          AND datetime(expires_at) > datetime('now')
        ORDER BY created_at DESC
        LIMIT 1
      `, [targetIdentifier, targetIdentifier]);

      if (!otpRow || otpRow.otp_code !== cleanOtp) {
        return res.status(400).json({ success: false, error: 'Invalid or expired OTP code.' });
      }
      otpRecordId = otpRow.id;
    } else {
      return res.status(400).json({ success: false, error: 'Verification token or OTP required.' });
    }

    // Resolve user account
    const identity = await resolveStudentIdentity(targetIdentifier);
    if (!identity) {
      return res.status(404).json({ success: false, error: 'Account not found for password update.' });
    }

    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(passwordToSet, salt);

    let updatedUserId = identity.user_account_id;

    if (updatedUserId) {
      // Update existing user
      await runQuery(`
        UPDATE users
        SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [newHash, updatedUserId]);
    } else {
      // Auto-provision user account for student if only student row existed
      updatedUserId = uuidv4();
      const userEmail = identity.student_email || `${identity.roll_number.toLowerCase()}@student.hostel.local`;
      await runQuery(`
        INSERT INTO users (id, username, email, password_hash, role, student_id, is_active, must_change_password)
        VALUES (?, ?, ?, ?, 'STUDENT', ?, 1, 0)
      `, [updatedUserId, identity.roll_number, userEmail, newHash, identity.student_id]);

      await runQuery(`UPDATE students SET user_id = ? WHERE roll_number = ?`, [updatedUserId, identity.roll_number]);
    }

    // Invalidate OTP record
    if (otpRecordId) {
      await runQuery(`UPDATE password_reset_otps SET is_used = 1 WHERE id = ?`, [otpRecordId]);
    }

    // Invalidate all active sessions for this user across all devices
    await revokeAllUserSessions(updatedUserId);

    // Audit event
    await recordAuditEvent(
      updatedUserId,
      identity.roll_number,
      'PASSWORD_RESET_SUCCESS',
      'USER',
      updatedUserId,
      `Password successfully reset for student ${identity.roll_number}`,
      req
    );

    res.json({
      success: true,
      message: 'Password has been successfully reset! You can now sign in with your new password.',
      username: identity.roll_number
    });
  } catch (err) {
    console.error('Password reset error:', err);
    res.status(500).json({ success: false, error: 'Failed to reset password: ' + err.message });
  }
});

// 8. Phone.Email ("Sign in with Phone") Server Verification
router.post('/forgot-password/phone-email-verify', authLimiter, async (req, res) => {
  try {
    const { user_json_url, identifier, simulated_phone } = req.body;

    if (!user_json_url && !simulated_phone) {
      return res.status(400).json({ success: false, error: 'Phone.Email user_json_url is required.' });
    }

    let verifiedPhone = '';
    let verifiedEmail = '';
    if (user_json_url) {
      const verifiedData = await verifyPhoneEmailJsonUrl(user_json_url);
      verifiedPhone = verifiedData.fullPhone;
      verifiedEmail = verifiedData.email;
    } else if (simulated_phone && process.env.NODE_ENV === 'test') {
      verifiedPhone = String(simulated_phone).trim();
    }

    if (!verifiedPhone && !verifiedEmail) {
      return res.status(400).json({ success: false, error: 'Valid Phone.Email verification token is required.' });
    }

    // Match with student
    const cleanDigits = verifiedPhone ? verifiedPhone.replace(/[^0-9]/g, '') : '';
    let identity = null;

    if (identifier && identifier.trim()) {
      identity = await resolveStudentIdentity(identifier);
    }

    if (!identity) {
      // Find student by email or phone in students table
      let student = null;
      if (verifiedEmail) {
        student = await getQuery(`
          SELECT s.*, u.id as user_account_id, u.is_active as user_active
          FROM students s
          LEFT JOIN users u ON (s.user_id = u.id OR s.roll_number = u.username)
          WHERE s.email = ? OR u.email = ?
          LIMIT 1
        `, [verifiedEmail, verifiedEmail]);
      }
      if (!student && verifiedPhone) {
        student = await getQuery(`
          SELECT s.*, u.id as user_account_id, u.is_active as user_active
          FROM students s
          LEFT JOIN users u ON (s.user_id = u.id OR s.roll_number = u.username)
          WHERE s.phone = ? OR s.phone LIKE ? OR s.phone LIKE ?
          LIMIT 1
        `, [verifiedPhone, `%${cleanDigits.slice(-10)}`, `%${cleanDigits}`]);
      }

      if (student) {
        identity = {
          student_id: student.id,
          roll_number: student.roll_number,
          full_name: student.full_name,
          student_email: student.email,
          student_phone: student.phone,
          user_account_id: student.user_account_id,
          user_active: student.user_active
        };
      }
    }

    if (!identity) {
      const targetLabel = verifiedEmail || verifiedPhone;
      return res.status(404).json({
        success: false,
        error: `Verified identity (${targetLabel}) is not registered with any student in the hostel system.`
      });
    }

    // Generate signed reset token
    const resetToken = jwt.sign(
      {
        resetOtpId: 'PHONE_EMAIL_VERIFIED',
        identifier: identity.roll_number,
        userId: identity.user_account_id,
        type: 'PASSWORD_RESET',
        method: 'PHONE_EMAIL'
      },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    const verifiedIdentity = verifiedPhone || verifiedEmail;
    await recordAuditEvent(
      identity.user_account_id || 'ANONYMOUS',
      identity.roll_number,
      'PHONE_EMAIL_VERIFY_SUCCESS',
      'USER',
      identity.user_account_id || null,
      `Verified identity ${verifiedIdentity} via Phone.Email`,
      req
    );

    res.json({
      success: true,
      message: `Identity ${verifiedIdentity} verified successfully via Phone.Email!`,
      resetToken,
      identifier: identity.roll_number,
      verifiedPhone,
      verifiedEmail
    });
  } catch (err) {
    console.error('Phone.Email verification error:', err);
    res.status(500).json({ success: false, error: 'Phone.Email verification failed: ' + err.message });
  }
});

// 9. Verify 1-Click Email Magic Link Token
router.post('/forgot-password/verify-magic-link', authLimiter, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, error: 'Magic link token is required.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(400).json({ success: false, error: 'Magic link has expired or is invalid. Please request a new link.' });
    }

    if (decoded.type !== 'PASSWORD_RESET') {
      return res.status(400).json({ success: false, error: 'Invalid token type.' });
    }

    res.json({
      success: true,
      message: 'Email magic link verified successfully! You may now set your new password.',
      resetToken: token,
      identifier: decoded.identifier
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. Phone.Email ("Sign in with Phone") Direct Login / Authentication
router.post('/phone-login', authLimiter, async (req, res) => {
  try {
    const { user_json_url, simulated_phone } = req.body;

    if (!user_json_url && !simulated_phone) {
      return res.status(400).json({ success: false, error: 'Phone.Email user_json_url is required.' });
    }

    let verifiedPhone = '';
    let verifiedEmail = '';
    if (user_json_url) {
      const verifiedData = await verifyPhoneEmailJsonUrl(user_json_url);
      verifiedPhone = verifiedData.fullPhone;
      verifiedEmail = verifiedData.email;
    } else if (simulated_phone && process.env.NODE_ENV === 'test') {
      verifiedPhone = String(simulated_phone).trim();
    }

    if (!verifiedPhone && !verifiedEmail) {
      return res.status(400).json({ success: false, error: 'Valid Phone.Email verification data is required.' });
    }

    const cleanDigits = verifiedPhone ? verifiedPhone.replace(/[^0-9]/g, '') : '';

    // Look up student by email or phone in students table
    let student = null;
    if (verifiedEmail) {
      student = await getQuery(`
        SELECT s.*, 
               u.id as user_account_id, 
               u.username, 
               u.email as user_email, 
               u.role, 
               u.is_active as user_active, 
               u.must_change_password
        FROM students s
        LEFT JOIN users u ON (s.user_id = u.id OR s.roll_number = u.username)
        WHERE s.email = ? OR u.email = ?
        LIMIT 1
      `, [verifiedEmail, verifiedEmail]);
    }
    if (!student && verifiedPhone) {
      student = await getQuery(`
        SELECT s.*, 
               u.id as user_account_id, 
               u.username, 
               u.email as user_email, 
               u.role, 
               u.is_active as user_active, 
               u.must_change_password
        FROM students s
        LEFT JOIN users u ON (s.user_id = u.id OR s.roll_number = u.username)
        WHERE s.phone = ? OR s.phone LIKE ? OR s.phone LIKE ?
        LIMIT 1
      `, [verifiedPhone, `%${cleanDigits.slice(-10)}`, `%${cleanDigits}`]);
    }

    if (!student) {
      const targetLabel = verifiedEmail || verifiedPhone;
      return res.status(404).json({
        success: false,
        error: `Verified identity (${targetLabel}) is not registered with any student in the hostel system. Please contact your hostel warden or register as a resident.`
      });
    }

    if (student.user_active === 0 || student.is_active === 0) {
      return res.status(403).json({
        success: false,
        error: 'Your account has been deactivated. Please contact the hostel administration or warden.'
      });
    }

    // Determine or construct user object
    let user = null;
    if (student.user_account_id) {
      user = {
        id: student.user_account_id,
        username: student.username || student.roll_number,
        email: student.user_email || student.email,
        role: student.role || 'STUDENT',
        student_id: student.id,
        must_change_password: student.must_change_password || 0
      };
    } else {
      // Find or create user record for this registered student
      let existingUser = await getQuery(`SELECT * FROM users WHERE username = ? OR student_id = ?`, [student.roll_number, student.id]);
      if (existingUser) {
        user = existingUser;
        await runQuery(`UPDATE students SET user_id = ? WHERE id = ?`, [existingUser.id, student.id]);
      } else {
        const newUserId = uuidv4();
        const salt = await bcrypt.genSalt(10);
        const defaultHash = await bcrypt.hash('Student@12345', salt);
        await runQuery(`
          INSERT INTO users (id, username, email, password_hash, role, student_id, is_active)
          VALUES (?, ?, ?, ?, 'STUDENT', ?, 1)
        `, [newUserId, student.roll_number, student.email, defaultHash, student.id]);
        await runQuery(`UPDATE students SET user_id = ? WHERE id = ?`, [newUserId, student.id]);
        user = {
          id: newUserId,
          username: student.roll_number,
          email: student.email,
          role: 'STUDENT',
          student_id: student.id,
          must_change_password: 0
        };
      }
    }

    const accessToken = generateAccessToken(user);
    const refreshResult = await createRefreshToken(user.id, req);

    const verifiedIdentity = verifiedPhone || verifiedEmail;
    await recordAuditEvent(
      user.id,
      user.username,
      'USER_LOGIN_PHONE_EMAIL',
      'USER',
      user.id,
      `User logged in via Phone.Email verified identity: ${verifiedIdentity}`,
      req
    );

    res.json({
      success: true,
      message: `Welcome back, ${student.full_name}! (Username: ${user.username})`,
      token: accessToken,
      accessToken,
      refreshToken: refreshResult.refreshToken,
      refreshTokenExpiresAt: refreshResult.expiresAt,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        studentId: student.id,
        mustChangePassword: Boolean(user.must_change_password),
        studentProfile: student
      },
      verifiedPhone
    });
  } catch (err) {
    console.error('Phone login error:', err);
    res.status(500).json({ success: false, error: 'Phone login failed: ' + err.message });
  }
});

// 11. Direct OTP Login - Request OTP (SMS or Email) - NO FIRST/LAST NAME REQUIRED
router.post('/otp-login/request', authLimiter, async (req, res) => {
  try {
    const { identifier, method = 'SMS' } = req.body;

    if (!identifier || !identifier.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Please enter your registered mobile number, email, or roll number.'
      });
    }

    const cleanMethod = String(method).toUpperCase() === 'EMAIL' ? 'EMAIL' : 'PHONE';
    const identity = await resolveStudentIdentity(identifier);

    if (!identity) {
      return res.status(404).json({
        success: false,
        error: `No registered student found matching "${identifier.trim()}". Please check your details or contact your hostel warden.`
      });
    }

    if (identity.user_active === 0 || identity.student_active === 0) {
      return res.status(403).json({
        success: false,
        error: 'This account has been deactivated. Please contact the hostel administration.'
      });
    }

    let destination = cleanMethod === 'EMAIL' ? identity.student_email : identity.student_phone;
    if (!destination) {
      destination = identity.student_phone || identity.student_email;
    }

    if (!destination) {
      return res.status(400).json({
        success: false,
        error: `No registered ${cleanMethod === 'EMAIL' ? 'email' : 'phone number'} found for this student.`
      });
    }

    // Rate-limit check in last 10 minutes
    const recentOtps = await getQuery(`
      SELECT COUNT(*) as count
      FROM password_reset_otps
      WHERE (identifier = ? OR destination = ?)
        AND created_at > datetime('now', '-10 minutes')
    `, [identity.roll_number, destination]);

    if (process.env.NODE_ENV !== 'test' && recentOtps && recentOtps.count >= 5) {
      return res.status(429).json({
        success: false,
        error: 'Too many OTP requests for this account. Please wait 10 minutes before requesting a new code.'
      });
    }

    const otpCode = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const otpId = uuidv4();

    // Invalidate previous unexpired OTPs
    await runQuery(`
      UPDATE password_reset_otps
      SET is_used = 1
      WHERE identifier = ? AND is_used = 0
    `, [identity.roll_number]);

    await runQuery(`
      INSERT INTO password_reset_otps (
        id, identifier, user_id, otp_code, method, destination, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      otpId,
      identity.roll_number,
      identity.user_account_id || null,
      otpCode,
      cleanMethod,
      destination,
      expiresAt
    ]);

    let dispatchResult;
    if (cleanMethod === 'EMAIL') {
      dispatchResult = await sendEmailOtp({
        email: destination,
        otpCode,
        studentName: identity.full_name,
        rollNumber: identity.roll_number
      });
    } else {
      dispatchResult = await sendSmsOtp({
        phone: destination,
        otpCode,
        studentName: identity.full_name,
        rollNumber: identity.roll_number
      });
    }

    await recordAuditEvent(
      identity.user_account_id || 'ANONYMOUS',
      identity.roll_number || 'STUDENT',
      'LOGIN_OTP_REQUEST',
      'USER',
      identity.user_account_id || null,
      `Requested login OTP sent to ${dispatchResult.maskedDestination}`,
      req
    );

    res.json({
      success: true,
      message: `A 6-digit OTP code has been dispatched to ${dispatchResult.maskedDestination}.`,
      identifier: identity.roll_number,
      maskedDestination: dispatchResult.maskedDestination,
      expiresInMinutes: 10,
      ...(process.env.NODE_ENV !== 'production' ? { debugOtp: otpCode } : {})
    });
  } catch (err) {
    console.error('Login OTP request error:', err);
    res.status(500).json({ success: false, error: 'Failed to dispatch login OTP: ' + err.message });
  }
});

// 12. Direct OTP Login - Verify OTP (Takes ONLY the 6-digit OTP from user)
router.post('/otp-login/verify', authLimiter, async (req, res) => {
  try {
    const { identifier, otp } = req.body;

    if (!identifier || !otp) {
      return res.status(400).json({ success: false, error: 'Identifier and 6-digit OTP code are required.' });
    }

    const cleanIdentifier = identifier.trim();
    const cleanOtp = String(otp).trim();

    // Find active OTP record
    const otpRecord = await getQuery(`
      SELECT * FROM password_reset_otps
      WHERE (identifier = ? OR destination = ?)
        AND is_used = 0
        AND datetime(expires_at) > datetime('now')
      ORDER BY created_at DESC
      LIMIT 1
    `, [cleanIdentifier, cleanIdentifier]);

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired verification code. Please request a new OTP.'
      });
    }

    if (otpRecord.attempts >= 5) {
      await runQuery(`UPDATE password_reset_otps SET is_used = 1 WHERE id = ?`, [otpRecord.id]);
      return res.status(400).json({
        success: false,
        error: 'Too many incorrect attempts. This OTP has been invalidated for security. Please request a new one.'
      });
    }

    await runQuery(`UPDATE password_reset_otps SET attempts = attempts + 1 WHERE id = ?`, [otpRecord.id]);

    if (otpRecord.otp_code !== cleanOtp) {
      return res.status(400).json({
        success: false,
        error: 'Incorrect verification code. Please check the 6 digits and try again.'
      });
    }

    // Mark OTP as used
    await runQuery(`UPDATE password_reset_otps SET is_used = 1 WHERE id = ?`, [otpRecord.id]);

    // Retrieve or provision student user account
    const cleanDigits = cleanIdentifier.replace(/[^0-9]/g, '');
    let student = await getQuery(`
      SELECT s.*, 
             u.id as user_account_id, 
             u.username, 
             u.email as user_email, 
             u.role, 
             u.is_active as user_active, 
             u.must_change_password
      FROM students s
      LEFT JOIN users u ON (s.user_id = u.id OR s.roll_number = u.username)
      WHERE s.roll_number = ? OR s.phone = ? OR s.email = ?
         OR (length(?) >= 10 AND (s.phone LIKE ? OR s.phone LIKE ?))
      LIMIT 1
    `, [
      otpRecord.identifier,
      cleanIdentifier,
      cleanIdentifier,
      cleanDigits,
      `%${cleanDigits.slice(-10)}`,
      `%${cleanDigits}`
    ]);

    if (!student) {
      return res.status(404).json({
        success: false,
        error: 'Registered student account could not be found.'
      });
    }

    if (student.user_active === 0 || student.is_active === 0) {
      return res.status(403).json({
        success: false,
        error: 'Your account has been deactivated. Please contact hostel administration.'
      });
    }

    let user = null;
    if (student.user_account_id) {
      user = {
        id: student.user_account_id,
        username: student.username || student.roll_number,
        email: student.user_email || student.email,
        role: student.role || 'STUDENT',
        student_id: student.id,
        must_change_password: student.must_change_password || 0
      };
    } else {
      let existingUser = await getQuery(`SELECT * FROM users WHERE username = ? OR student_id = ?`, [student.roll_number, student.id]);
      if (existingUser) {
        user = existingUser;
        await runQuery(`UPDATE students SET user_id = ? WHERE id = ?`, [existingUser.id, student.id]);
      } else {
        const newUserId = uuidv4();
        const salt = await bcrypt.genSalt(10);
        const defaultHash = await bcrypt.hash('Student@12345', salt);
        await runQuery(`
          INSERT INTO users (id, username, email, password_hash, role, student_id, is_active)
          VALUES (?, ?, ?, ?, 'STUDENT', ?, 1)
        `, [newUserId, student.roll_number, student.email, defaultHash, student.id]);
        await runQuery(`UPDATE students SET user_id = ? WHERE id = ?`, [newUserId, student.id]);
        user = {
          id: newUserId,
          username: student.roll_number,
          email: student.email,
          role: 'STUDENT',
          student_id: student.id,
          must_change_password: 0
        };
      }
    }

    const accessToken = generateAccessToken(user);
    const refreshResult = await createRefreshToken(user.id, req);

    await recordAuditEvent(
      user.id,
      user.username,
      'USER_LOGIN_DIRECT_OTP',
      'USER',
      user.id,
      `User logged in via direct 6-digit OTP verification`,
      req
    );

    res.json({
      success: true,
      message: `Welcome back, ${student.full_name || user.username}!`,
      token: accessToken,
      accessToken,
      refreshToken: refreshResult.refreshToken,
      refreshTokenExpiresAt: refreshResult.expiresAt,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        studentId: student.id,
        mustChangePassword: Boolean(user.must_change_password),
        studentProfile: student
      }
    });
  } catch (err) {
    console.error('Direct OTP login error:', err);
    res.status(500).json({ success: false, error: 'Failed to verify login OTP: ' + err.message });
  }
});

module.exports = router;


