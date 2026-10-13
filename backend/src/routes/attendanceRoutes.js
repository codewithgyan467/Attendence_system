const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { runQuery, getQuery, allQuery, withTransaction } = require('../db/database');
const { validateLocation } = require('../services/geofenceService');
const { recordFailedLocationAttempt, resetFailedLocationAttempt } = require('../services/fraudService');
const { attendanceLimiter } = require('../middleware/rateLimiter');
const aiServiceClient = require('../services/aiServiceClient');

// Helper to get today's date in YYYY-MM-DD
function getTodayDateString() {
  return new Date().toISOString().split('T')[0];
}

// 1. Phase 3 Step 1: Coordinate Extraction & Geofence Validation
router.post('/verify-location', attendanceLimiter, async (req, res) => {
  try {
    const {
      roll_number,
      latitude,
      longitude,
      accuracy = 10,
      is_mock_location = false
    } = req.body;

    if (!roll_number) {
      return res.status(400).json({ success: false, error: 'Student roll number is required.' });
    }

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, error: 'GPS coordinates (latitude and longitude) are required.' });
    }

    // 1. Verify student exists and is active
    const student = await getQuery(`SELECT * FROM students WHERE roll_number = ? OR id = ?`, [roll_number.trim(), roll_number.trim()]);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student is not registered. Please complete Phase 2 Onboarding first.' });
    }

    if (student.is_active !== 1) {
      return res.status(403).json({ success: false, error: 'Student profile has been deactivated.' });
    }

    // 2. Enforce 3-Strike Forge Location Lockout
    if (student.is_flagged_forge === 1 || (student.failed_attempts || 0) >= 3) {
      return res.status(403).json({
        success: false,
        isLocked: true,
        error: 'Account locked due to 3 consecutive forge location strikes. Please contact hostel administrator to reset strikes.'
      });
    }

    // 2. Check if attendance already marked today
    const today = getTodayDateString();
    const alreadyMarked = await getQuery(`SELECT * FROM attendance_records WHERE student_id = ? AND date = ?`, [student.id, today]);
    if (alreadyMarked) {
      return res.status(400).json({
        success: false,
        error: `Attendance is already marked as ${alreadyMarked.status} for today (${alreadyMarked.date} at ${alreadyMarked.time_marked}).`,
        isAlreadyPresent: true,
        record: alreadyMarked
      });
    }

    // 3. Fetch active geofence configuration
    const geofence = await getQuery(`SELECT * FROM geofence_configs WHERE is_active = 1 LIMIT 1`);
    if (!geofence) {
      return res.status(500).json({ success: false, error: 'Active hostel geofence configuration missing.' });
    }

    // 4. Validate Location (Server calculates Haversine distance & checks mock spoofer)
    const validation = validateLocation({
      deviceLat: parseFloat(latitude),
      deviceLon: parseFloat(longitude),
      accuracy: parseFloat(accuracy) || 10,
      isMockLocation: Boolean(is_mock_location),
      hostelLat: geofence.latitude,
      hostelLon: geofence.longitude,
      permittedRadiusMeters: geofence.radius_meters || 20.0
    });

    // 5. Handle Location Failure (Out of boundary or Mock GPS Active)
    if (!validation.isValid) {
      const fraudRecord = await recordFailedLocationAttempt(
        student.id,
        student.roll_number,
        validation.distanceMeters || 999,
        validation.reason,
        validation.message
      );

      return res.status(403).json({
        success: false,
        stepPassed: false,
        reason: validation.reason,
        message: validation.message,
        distanceMeters: validation.distanceMeters,
        permittedRadiusMeters: validation.permittedRadiusMeters,
        failedAttempts: fraudRecord.failedAttempts,
        isFlaggedForge: fraudRecord.isFlaggedForge,
        alertTriggered: fraudRecord.alertTriggered
      });
    }

    // 6. Location Approved! Reset failed attempt counter
    await resetFailedLocationAttempt(student.id);

    // 7. Generate Persistent Single-Use Challenge Token (5-minute expiry)
    const challengeToken = uuidv4();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await runQuery(`
      INSERT INTO attendance_challenges (
        id, student_id, challenge_token, expires_at, is_used, verified_distance
      ) VALUES (?, ?, ?, ?, 0, ?)
    `, [uuidv4(), student.id, challengeToken, expiresAt, validation.distanceMeters]);

    res.json({
      success: true,
      stepPassed: true,
      message: 'Location verified! Device is within permitted hostel perimeter. Proceed to facial verification.',
      sessionToken: challengeToken, // Backward compatible field name
      challengeToken,
      distanceMeters: validation.distanceMeters,
      permittedRadiusMeters: validation.permittedRadiusMeters,
      studentName: student.full_name
    });
  } catch (err) {
    console.error('Location verification error:', err);
    res.status(500).json({ success: false, error: 'Location verification error: ' + err.message });
  }
});

// 2. Phase 3 Step 2: Facial Verification & Atomic Attendance Commit
router.post('/verify-face', attendanceLimiter, async (req, res) => {
  try {
    const { session_token, challenge_token, live_photo } = req.body;
    const token = challenge_token || session_token;

    if (!token || !live_photo) {
      return res.status(400).json({ success: false, error: 'Challenge token and live camera photo are required.' });
    }

    // 1. Verify Challenge Token from Database
    const challenge = await getQuery(`SELECT * FROM attendance_challenges WHERE challenge_token = ?`, [token]);

    if (!challenge) {
      return res.status(401).json({ success: false, error: 'Attendance challenge token is invalid or expired. Please re-verify location.' });
    }

    if (challenge.is_used === 1) {
      return res.status(403).json({ success: false, error: 'Attendance challenge token has already been used (replay rejected).' });
    }

    if (new Date(challenge.expires_at).getTime() < Date.now()) {
      return res.status(401).json({ success: false, error: 'Attendance session expired (5-minute window exceeded). Please re-verify location.' });
    }

    // 2. Fetch student and stored embeddings
    const student = await getQuery(`SELECT * FROM students WHERE id = ?`, [challenge.student_id]);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found.' });
    }

    const storedRows = await allQuery(`
      SELECT embedding_vector FROM student_face_embeddings
      WHERE student_id = ?
    `, [student.id]);

    if (!storedRows || storedRows.length === 0) {
      return res.status(400).json({ success: false, error: 'No facial embeddings registered for this student. Please complete onboarding.' });
    }

    const storedEmbeddings = storedRows.map((r) => JSON.parse(r.embedding_vector));

    // 3. Call AI Microservice for Anti-Spoofing & Cosine Matching
    let aiResult;
    try {
      aiResult = await aiServiceClient.verifyLiveFace(live_photo, storedEmbeddings, 0.65);
    } catch (aiErr) {
      return res.status(500).json({ success: false, error: `AI Microservice Error: ${aiErr.message}` });
    }

    // 4. Check Liveness / Anti-Spoofing
    if (!aiResult.is_live) {
      await runQuery(`
        INSERT INTO security_audit_logs (id, student_id, roll_number, incident_type, calculated_distance, details)
        VALUES (?, ?, ?, 'FACE_SPOOF_ATTEMPT', ?, ?)
      `, [
        uuidv4(),
        student.id,
        student.roll_number,
        challenge.verified_distance,
        aiResult.details?.message || 'Liveness anti-spoof check failed'
      ]);

      return res.status(403).json({
        success: false,
        status: 'SPOOF_DETECTED',
        error: 'Anti-spoofing check failed: Live human presence required. Digital screens and printed photos are rejected.',
        details: aiResult.details
      });
    }

    // 5. Check Cosine Similarity Match
    if (!aiResult.is_match) {
      return res.status(403).json({
        success: false,
        status: 'FACE_MISMATCH',
        error: 'Facial recognition failed: Live scan does not match registered student profile.',
        similarityScore: aiResult.similarity_score,
        details: aiResult.details
      });
    }

    // 6. Commit Attendance and Consume Challenge Atomically
    const today = getTodayDateString();
    const timeMarked = new Date().toLocaleTimeString('en-US', { hour12: false });
    const recordId = uuidv4();

    await withTransaction(async ({ runQuery }) => {
      // Consume challenge token (Single-use replay protection)
      await runQuery(`UPDATE attendance_challenges SET is_used = 1 WHERE id = ?`, [challenge.id]);

      // Insert attendance record
      await runQuery(`
        INSERT INTO attendance_records (
          id, student_id, roll_number, full_name, date, time_marked, status,
          verified_distance, similarity_score, liveness_score
        ) VALUES (?, ?, ?, ?, ?, ?, 'PRESENT', ?, ?, ?)
      `, [
        recordId,
        student.id,
        student.roll_number,
        student.full_name,
        today,
        timeMarked,
        challenge.verified_distance,
        aiResult.similarity_score,
        aiResult.liveness_score
      ]);
    });

    res.json({
      success: true,
      status: 'PRESENT',
      message: `🎉 Attendance marked successfully for ${student.full_name}!`,
      attendanceRecord: {
        id: recordId,
        studentId: student.id,
        rollNumber: student.roll_number,
        fullName: student.full_name,
        date: today,
        timeMarked,
        status: 'PRESENT',
        distanceMeters: challenge.verified_distance,
        similarityScore: aiResult.similarity_score,
        livenessScore: aiResult.liveness_score
      }
    });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ success: false, error: 'Attendance already recorded for today.' });
    }
    console.error('Face verification failed:', err);
    res.status(500).json({ success: false, error: 'Face verification error: ' + err.message });
  }
});

// 3. Attendance Status Lookup
router.get('/status/:identifier', async (req, res) => {
  try {
    const id = req.params.identifier;
    const today = getTodayDateString();

    const student = await getQuery(`SELECT * FROM students WHERE id = ? OR roll_number = ?`, [id, id]);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found.' });
    }

    const record = await getQuery(`
      SELECT * FROM attendance_records
      WHERE student_id = ? AND date = ?
    `, [student.id, today]);

    res.json({
      success: true,
      rollNumber: student.roll_number,
      fullName: student.full_name,
      isMarkedToday: Boolean(record),
      status: record ? record.status : 'PENDING',
      record: record || null
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
