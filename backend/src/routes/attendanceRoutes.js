const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { runQuery, getQuery, allQuery, withTransaction } = require('../db/database');
const { validateLocation } = require('../services/geofenceService');
const { recordFailedLocationAttempt, resetFailedLocationAttempt } = require('../services/fraudService');
const { attendanceLimiter } = require('../middleware/rateLimiter');
const aiServiceClient = require('../services/aiServiceClient');
const { optionalAuth } = require('../middleware/auth');
const { getAttendanceWindowStatus } = require('../services/scheduleService');
const antiSpoofPolicyEngine = require('../services/antiSpoofPolicyEngine');
const embeddingCache = require('../services/embeddingCache');

// Helper to get today's date in YYYY-MM-DD
function getTodayDateString() {
  return new Date().toISOString().split('T')[0];
}

// Attach optional JWT authentication to attendance router
router.use(optionalAuth);

// Public / Authenticated Live Attendance Schedule Status
router.get('/schedule', async (req, res) => {
  try {
    const schedule = await getAttendanceWindowStatus();
    res.json({ success: true, schedule });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Phase 3 Step 1: Coordinate Extraction, Multi-Layer Telemetry & Geofence Validation
 * Supports both /verify-location and /check-geofence
 */
const verifyLocationHandler = async (req, res) => {
  try {
    // 0. Enforce real-world attendance schedule window
    const windowStatus = await getAttendanceWindowStatus();
    if (windowStatus.enforced && !windowStatus.isOpen) {
      if (process.env.NODE_ENV !== 'test' || req.headers['x-test-enforce-schedule'] === 'true') {
        return res.status(403).json({
          success: false,
          isWindowClosed: true,
          error: windowStatus.message,
          schedule: windowStatus
        });
      }
    }
    const {
      roll_number,
      latitude,
      longitude,
      accuracy = 10,
      is_mock_location = false,
      adb_enabled = false,
      samples = [],
      wifi_scan = null,
      ble_proof = null,
      play_integrity_token = null,
      device_id = null,
      device_info = {},
      is_native = false
    } = req.body;

    const studentRoll = roll_number ? roll_number.trim() : (req.user?.role === 'STUDENT' ? req.user.username : null);

    if (!studentRoll) {
      return res.status(400).json({ success: false, error: 'Student roll number is required.' });
    }

    if (latitude === undefined || longitude === undefined || latitude === null || longitude === null) {
      return res.status(400).json({ success: false, error: 'GPS coordinates (latitude and longitude) are required.' });
    }

    const parsedLat = parseFloat(latitude);
    const parsedLon = parseFloat(longitude);
    const parsedAcc = parseFloat(accuracy) || 10;

    if (isNaN(parsedLat) || isNaN(parsedLon) || parsedLat < -90 || parsedLat > 90 || parsedLon < -180 || parsedLon > 180) {
      return res.status(400).json({
        success: false,
        error: 'Invalid GPS coordinates: latitude must be between -90 and 90, and longitude between -180 and 180.'
      });
    }

    if (parsedAcc > 100) {
      return res.status(400).json({
        success: false,
        stepPassed: false,
        isAccuracyIssue: true,
        reason: 'POOR_GPS_ACCURACY',
        error: `GPS accuracy (±${parsedAcc.toFixed(1)}m) is too poor for reliable hostel perimeter validation. Please move near a window or outdoors.`
      });
    }

    // 1. Verify student exists and is active
    const student = await getQuery(`SELECT * FROM students WHERE roll_number = ? OR id = ?`, [studentRoll, studentRoll]);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student is not registered. Please complete Phase 2 Onboarding first.' });
    }

    // Security Guard: Prevent authenticated student from marking another student's attendance
    if (req.user && req.user.role === 'STUDENT' && req.user.username !== student.roll_number) {
      return res.status(403).json({
        success: false,
        error: `Security violation: Logged in as ${req.user.username}, cannot mark attendance for ${student.roll_number}.`
      });
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

    // 3. Check if attendance already marked today
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

    // 4. Fetch active geofence configuration
    const geofence = await getQuery(`SELECT * FROM geofence_configs WHERE is_active = 1 LIMIT 1`);
    if (!geofence) {
      return res.status(500).json({ success: false, error: 'Active hostel geofence configuration missing.' });
    }

    // 5. Evaluate Multi-Layer Anti-Spoof & Unfair-Means Policy (13 Layers + 5-State Decision Matrix)
    const effectiveDeviceId = device_id || device_info.deviceId || student.device_id;
    const clientIp = (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) || req.ip || req.connection.remoteAddress || '127.0.0.1';

    const evaluation = await antiSpoofPolicyEngine.evaluateLocationAndEnvironment({
      student,
      clientLat: parsedLat,
      clientLon: parsedLon,
      accuracy: parsedAcc,
      isMockLocation: Boolean(is_mock_location),
      adbEnabled: Boolean(adb_enabled),
      samples,
      wifiScan: wifi_scan,
      bleProof: ble_proof,
      playIntegrityToken: play_integrity_token,
      deviceInfo: {
        ...device_info,
        deviceId: effectiveDeviceId,
        isNative: Boolean(is_native || device_info.isNative)
      },
      clientIp,
      geofence
    });

    // 6. Handle Decision Outcomes
    if (evaluation.decisionOutcome === 'RETRY') {
      return res.status(400).json({
        success: false,
        stepPassed: false,
        decision: 'RETRY',
        isAccuracyIssue: true,
        reason: 'POOR_GPS_ACCURACY',
        message: 'GPS signal accuracy is coarse. Step near a window or check in via Hostel Wi-Fi/Beacon.',
        distanceMeters: null,
        permittedRadiusMeters: evaluation.allowedRadius,
        failedAttempts: student.failed_attempts || 0,
        isFlaggedForge: Boolean(student.is_flagged_forge)
      });
    }

    if (evaluation.decisionOutcome === 'DENY') {
      const isMockDetected = evaluation.mockFlagStatus === 'MOCK_DETECTED';
      const reasonCode = isMockDetected ? 'MOCK_LOCATION_ACTIVE' : 'OUTSIDE_GEOFENCE';
      const detailsMsg = isMockDetected
        ? 'Mock location app / GPS spoofer detected on device. Real hardware GPS required.'
        : `Location rejected: You are ${evaluation.distanceMeters}m away from the hostel. Permitted boundary is ${evaluation.allowedRadius}m.`;

      const fraudRecord = await recordFailedLocationAttempt(
        student.id,
        student.roll_number,
        evaluation.distanceMeters || 999,
        reasonCode,
        detailsMsg,
        {
          riskScore: evaluation.totalRiskScore,
          decisionOutcome: 'DENY',
          reasonCodes: evaluation.reasonCodes,
          ipAddress: clientIp
        }
      );

      return res.status(403).json({
        success: false,
        stepPassed: false,
        decision: 'DENY',
        reason: reasonCode,
        message: detailsMsg,
        distanceMeters: evaluation.distanceMeters,
        permittedRadiusMeters: evaluation.allowedRadius,
        failedAttempts: fraudRecord.failedAttempts,
        isFlaggedForge: fraudRecord.isFlaggedForge,
        alertTriggered: fraudRecord.alertTriggered
      });
    }

    if (evaluation.decisionOutcome === 'MANUAL_REVIEW') {
      return res.status(403).json({
        success: false,
        stepPassed: false,
        decision: 'MANUAL_REVIEW',
        reason: 'MANUAL_REVIEW_REQUIRED',
        message: 'Verification flagged for Warden manual confirmation due to multi-signal anomalies.',
        distanceMeters: evaluation.distanceMeters,
        permittedRadiusMeters: evaluation.allowedRadius,
        failedAttempts: student.failed_attempts || 0,
        isFlaggedForge: Boolean(student.is_flagged_forge)
      });
    }

    // 7. Step Passed (ALLOW or STEP_UP) - Reset failed attempts & issue hardened challenge
    await resetFailedLocationAttempt(student.id);

    const challengeToken = uuidv4();
    const challengeId = uuidv4();
    const expiresAt = new Date(Date.now() + evaluation.ttlMs).toISOString();

    await runQuery(`
      INSERT INTO attendance_challenges (
        id, student_id, challenge_token, expires_at, is_used, verified_distance,
        bound_ip_address, bound_device_id, request_nonce_hash, requires_step_up, step_up_color_sequence
      ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
    `, [
      challengeId,
      student.id,
      challengeToken,
      expiresAt,
      evaluation.distanceMeters,
      clientIp,
      effectiveDeviceId,
      evaluation.requestNonceHash,
      evaluation.requiresStepUp ? 1 : 0,
      evaluation.stepUpColors ? JSON.stringify(evaluation.stepUpColors) : null
    ]);

    // Insert Initial Evidence Ledger Row
    await runQuery(`
      INSERT INTO attendance_evidence (
        id, challenge_id, student_id, decision_outcome, total_risk_score, assurance_tier,
        mock_flag_status, gps_sample_count, wifi_match_status, ble_match_status,
        play_integrity_verdict, unfair_means_flags, pad_photometric_pass, policy_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      uuidv4(),
      challengeId,
      student.id,
      evaluation.decisionOutcome,
      evaluation.totalRiskScore,
      evaluation.assuranceTier,
      evaluation.mockFlagStatus,
      evaluation.gpsSampleCount,
      evaluation.wifiMatchStatus,
      evaluation.bleMatchStatus,
      evaluation.playIntegrityVerdict,
      JSON.stringify(evaluation.unfairMeansFlags),
      0,
      'v3.0'
    ]);

    const clientSessionProof = antiSpoofPolicyEngine.generateClientSessionProof(
      challengeToken,
      effectiveDeviceId,
      evaluation.requestNonceHash
    );

    res.json({
      success: true,
      stepPassed: true,
      decision: evaluation.decisionOutcome,
      totalRiskScore: evaluation.totalRiskScore,
      assuranceTier: evaluation.assuranceTier,
      requiresStepUp: evaluation.requiresStepUp,
      stepUpColorSequence: evaluation.stepUpColors,
      message: evaluation.requiresStepUp
        ? 'Location approved with Step-Up requirement. Proceed to photometric face verification.'
        : 'Location verified! Device is within permitted hostel perimeter. Proceed to facial verification.',
      sessionToken: challengeToken, // Backward compatible field name
      challengeToken,
      clientSessionProof,
      client_session_proof: clientSessionProof,
      distanceMeters: evaluation.distanceMeters,
      permittedRadiusMeters: evaluation.allowedRadius,
      studentName: student.full_name
    });
  } catch (err) {
    console.error('Location verification error:', err);
    res.status(500).json({ success: false, error: 'Location verification error: ' + err.message });
  }
};

/**
 * Phase 3 Step 2: Facial Verification, Photometric PAD & Atomic Attendance Commit
 * Supports both /verify-face and /mark
 */
const verifyFaceHandler = async (req, res) => {
  try {
    // 0. Enforce real-world attendance schedule window
    const windowStatus = await getAttendanceWindowStatus();
    if (windowStatus.enforced && !windowStatus.isOpen) {
      if (process.env.NODE_ENV !== 'test' || req.headers['x-test-enforce-schedule'] === 'true') {
        return res.status(403).json({
          success: false,
          isWindowClosed: true,
          error: windowStatus.message,
          schedule: windowStatus
        });
      }
    }

    const {
      session_token,
      challenge_token,
      live_photo,
      device_id = null,
      photometric_data = null
    } = req.body;
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
      return res.status(401).json({ success: false, error: 'Attendance session expired (window exceeded). Please re-verify location.' });
    }

    // 2. Fetch student and stored embeddings
    const student = await getQuery(`SELECT * FROM students WHERE id = ?`, [challenge.student_id]);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found.' });
    }

    // 3. Evaluate Layer 13: "Beyond-Location" Unfair-Means & Relays
    const clientIp = (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) || req.ip || req.connection.remoteAddress || '127.0.0.1';
    const commitEval = await antiSpoofPolicyEngine.evaluateAttendanceCommit({
      challenge,
      student,
      currentIp: clientIp,
      currentDeviceId: device_id || req.body.deviceInfo?.deviceId || null,
      currentUserAgent: req.headers['user-agent'],
      requestNonceHash: req.body.request_nonce_hash || req.body.requestNonceHash || null,
      clientSessionProof: req.body.client_session_proof || req.body.clientSessionProof || null,
      photometricData: photometric_data
    });

    if (!commitEval.isAllowed) {
      await runQuery(`
        INSERT INTO security_audit_logs (
          id, student_id, roll_number, incident_type, calculated_distance, details,
          ip_address, risk_score, decision_outcome, reason_codes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DENY', ?)
      `, [
        uuidv4(),
        student.id,
        student.roll_number,
        commitEval.reason,
        challenge.verified_distance,
        commitEval.message,
        clientIp,
        commitEval.riskScore,
        commitEval.unfairMeans.join(',')
      ]);

      return res.status(403).json({
        success: false,
        status: 'DENY',
        reason: commitEval.reason,
        error: commitEval.message,
        details: { unfairMeans: commitEval.unfairMeans }
      });
    }

    // 3b. Fast In-Memory Face Embedding Retrieval with Cache
    let storedEmbeddings = embeddingCache.get(student.id);
    if (!storedEmbeddings) {
      const storedRows = await allQuery(`
        SELECT embedding_vector FROM student_face_embeddings
        WHERE student_id = ?
      `, [student.id]);

      if (!storedRows || storedRows.length === 0) {
        return res.status(400).json({
          success: false,
          needsFaceEnrollment: true,
          error: 'No facial embeddings registered for this student. Please complete onboarding.'
        });
      }

      storedEmbeddings = storedRows.map((r) => JSON.parse(r.embedding_vector));
      embeddingCache.set(student.id, storedEmbeddings);
    }

    // 4. Call AI Microservice for Anti-Spoofing & Cosine Matching
    let aiResult;
    try {
      aiResult = await aiServiceClient.verifyLiveFace(live_photo, storedEmbeddings, 0.65);
    } catch (aiErr) {
      return res.status(500).json({ success: false, error: `AI Microservice Error: ${aiErr.message}` });
    }

    // 5. Check Liveness / Anti-Spoofing
    if (!aiResult.is_live) {
      await runQuery(`
        INSERT INTO security_audit_logs (
          id, student_id, roll_number, incident_type, calculated_distance, details,
          ip_address, risk_score, decision_outcome, reason_codes
        ) VALUES (?, ?, ?, 'FACE_SPOOF_ATTEMPT', ?, ?, ?, 90, 'DENY', 'L8_BIOMETRIC_PAD_FAILED')
      `, [
        uuidv4(),
        student.id,
        student.roll_number,
        challenge.verified_distance,
        aiResult.details?.message || 'Liveness anti-spoof check failed',
        clientIp
      ]);

      return res.status(403).json({
        success: false,
        status: 'SPOOF_DETECTED',
        error: "We couldn't verify that you're physically present. Please look directly at the camera in good lighting and try again.",
        details: aiResult.details
      });
    }

    // 6. Check Identity Match
    if (!aiResult.is_match) {
      return res.status(403).json({
        success: false,
        status: 'FACE_MISMATCH',
        error: 'Face verification failed: Live photo does not match registered student profile. Please ensure adequate lighting and face the camera directly.',
        similarityScore: aiResult.similarity_score,
        details: aiResult.details
      });
    }

    // 7. Commit Attendance and Consume Challenge Atomically in Single Transaction
    const today = getTodayDateString();
    const timeMarked = new Date().toLocaleTimeString('en-US', { hour12: false });
    const recordId = uuidv4();
    const finalRiskScore = commitEval.riskScore || 0;
    const assuranceTier = challenge.requires_step_up ? 'NATIVE_STEP_UP' : 'NATIVE_HIGH';

    await withTransaction(async ({ runQuery }) => {
      // Atomic Challenge Consumption with race-condition detection:
      // If two concurrent requests arrive simultaneously, only one can update is_used from 0 to 1
      const consumeResult = await runQuery(
        `UPDATE attendance_challenges SET is_used = 1 WHERE id = ? AND is_used = 0`,
        [challenge.id]
      );

      if (!consumeResult || consumeResult.changes !== 1) {
        const conflictErr = new Error('CHALLENGE_ALREADY_CONSUMED');
        conflictErr.status = 409;
        throw conflictErr;
      }

      // Insert attendance record
      await runQuery(`
        INSERT INTO attendance_records (
          id, student_id, roll_number, full_name, date, time_marked, status,
          verified_distance, similarity_score, liveness_score, assurance_tier, risk_score
        ) VALUES (?, ?, ?, ?, ?, ?, 'PRESENT', ?, ?, ?, ?, ?)
      `, [
        recordId,
        student.id,
        student.roll_number,
        student.full_name,
        today,
        timeMarked,
        challenge.verified_distance,
        aiResult.similarity_score,
        aiResult.liveness_score,
        assuranceTier,
        finalRiskScore
      ]);

      // Record final commit evidence
      await runQuery(`
        INSERT INTO attendance_evidence (
          id, challenge_id, student_id, decision_outcome, total_risk_score, assurance_tier,
          mock_flag_status, gps_sample_count, wifi_match_status, ble_match_status,
          play_integrity_verdict, unfair_means_flags, pad_photometric_pass, policy_version
        ) VALUES (?, ?, ?, 'ALLOW', ?, ?, 'CLEAN', 1, 'VERIFIED_COMMIT', 'VERIFIED_COMMIT', 'PASS', '[]', ?, 'v3.0')
      `, [
        uuidv4(),
        challenge.id,
        student.id,
        finalRiskScore,
        assuranceTier,
        commitEval.padPhotometricPass || 1
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
        livenessScore: aiResult.liveness_score,
        assuranceTier,
        riskScore: finalRiskScore
      }
    });
  } catch (err) {
    if (err.message === 'CHALLENGE_ALREADY_CONSUMED' || err.status === 409) {
      return res.status(409).json({
        success: false,
        error: 'Attendance challenge token has already been consumed or processed concurrently (race condition prevented).'
      });
    }
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ success: false, error: 'Attendance already recorded for today.' });
    }
    console.error('Face verification failed:', err);
    res.status(500).json({ success: false, error: 'Face verification error: ' + err.message });
  }
};

// Route registrations and aliases
router.post('/verify-location', attendanceLimiter, verifyLocationHandler);
router.post('/check-geofence', attendanceLimiter, verifyLocationHandler);

router.post('/verify-face', attendanceLimiter, verifyFaceHandler);
router.post('/mark', attendanceLimiter, verifyFaceHandler);

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
