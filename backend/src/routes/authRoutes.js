const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getQuery, runQuery } = require('../db/database');
const { generateToken, requireAuth, recordAuditEvent } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');

// 1. User Login
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

    const token = generateToken(user);

    // Audit log
    await recordAuditEvent(user.id, user.username, 'USER_LOGIN', 'USER', user.id, `User logged in with role ${user.role}`, req);

    res.json({
      success: true,
      message: 'Login successful.',
      token,
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

// 2. Current User Profile
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

// 3. Change Password
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

    await recordAuditEvent(req.user.id, req.user.username, 'PASSWORD_CHANGE', 'USER', req.user.id, 'User changed their password', req);

    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Logout
router.post('/logout', requireAuth, async (req, res) => {
  await recordAuditEvent(req.user.id, req.user.username, 'USER_LOGOUT', 'USER', req.user.id, 'User logged out', req);
  res.json({ success: true, message: 'Logged out successfully.' });
});

module.exports = router;
