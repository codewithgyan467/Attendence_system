const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getIstTime12h, getIstDateString } = require('../utils/istTime');
const { runQuery, getQuery, allQuery, withTransaction } = require('../db/database');
const { generateToken, requireAuth, requireRole, recordAuditEvent, JWT_SECRET } = require('../middleware/auth');
const { sendEmailOtp, sendSmsOtp, maskEmail, maskPhone } = require('../services/notificationService');
const { authLimiter } = require('../middleware/rateLimiter');
const aiServiceClient = require('../services/aiServiceClient');
const embeddingCache = require('../services/embeddingCache');
const { getStudentAttendanceSummary } = require('../services/attendanceStatsService');
const wifiClusterService = require('../services/wifiClusterService');
const bleBeaconService = require('../services/bleBeaconService');

// 1. Privacy-First Deprecation: Public scraping of all student records is disabled to protect student privacy
router.get('/allotment-list', async (req, res) => {
  res.json({
    success: true,
    allotments: [],
    message: 'Public roster scraping is disabled for student privacy. Please use the secure OTP verification lookup.'
  });
});

// 2. Privacy-Preserving Onboarding Lookup (Finds student by Roll No or Phone without leaking public data)
router.post('/onboarding/lookup', authLimiter, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || !query.trim()) {
      return res.status(400).json({ success: false, error: 'Please enter your Roll Number or registered Mobile Number.' });
    }

    const clean = query.trim();
    const cleanDigits = clean.replace(/[^0-9]/g, '');

    let record = await getQuery(`
      SELECT 
        a.id as allotment_id,
        a.roll_number,
        a.full_name,
        a.is_registered,
        COALESCE(s.email, a.email) as email,
        COALESCE(s.phone, a.phone) as phone,
        COALESCE(s.course, a.course) as course,
        s.id as student_id
      FROM hostel_allotments a
      LEFT JOIN students s ON s.roll_number = a.roll_number
      WHERE LOWER(TRIM(a.roll_number)) = LOWER(TRIM(?))
         OR LOWER(TRIM(a.full_name)) = LOWER(TRIM(?))
         OR (LENGTH(?) >= 7 AND (
              REPLACE(REPLACE(REPLACE(a.phone, ' ', ''), '-', ''), '+', '') LIKE '%' || ?
              OR REPLACE(REPLACE(REPLACE(s.phone, ' ', ''), '-', ''), '+', '') LIKE '%' || ?
            ))
         OR (a.email IS NOT NULL AND a.email != '' AND LOWER(TRIM(a.email)) = LOWER(TRIM(?)))
         OR (s.email IS NOT NULL AND s.email != '' AND LOWER(TRIM(s.email)) = LOWER(TRIM(?)))
      LIMIT 1
    `, [
      clean,
      clean,
      cleanDigits,
      cleanDigits.slice(-10),
      cleanDigits.slice(-10),
      clean,
      clean
    ]);

    if (!record) {
      // Fallback: search in students table directly
      const studentRec = await getQuery(`
        SELECT 
          s.allotment_id,
          s.roll_number,
          s.full_name,
          0 as is_registered,
          s.email,
          s.phone,
          s.course,
          s.id as student_id
        FROM students s
        WHERE LOWER(TRIM(s.roll_number)) = LOWER(TRIM(?))
           OR LOWER(TRIM(s.full_name)) = LOWER(TRIM(?))
           OR (LENGTH(?) >= 7 AND REPLACE(REPLACE(REPLACE(s.phone, ' ', ''), '-', ''), '+', '') LIKE '%' || ?)
           OR (s.email IS NOT NULL AND s.email != '' AND LOWER(TRIM(s.email)) = LOWER(TRIM(?)))
        LIMIT 1
      `, [clean, clean, cleanDigits, cleanDigits.slice(-10), clean]);

      if (studentRec) {
        // Ensure allotment exists for this student
        const existingAllot = await getQuery(`SELECT id FROM hostel_allotments WHERE LOWER(TRIM(roll_number)) = LOWER(TRIM(?))`, [studentRec.roll_number]);
        let allotId = existingAllot?.id;
        if (!allotId) {
          allotId = uuidv4();
          await runQuery(`
            INSERT INTO hostel_allotments (id, roll_number, full_name, room_number, hostel_block, email, phone, course, is_registered)
            VALUES (?, ?, ?, 'A-101', 'Block A', ?, ?, ?, 0)
          `, [allotId, studentRec.roll_number, studentRec.full_name, studentRec.email, studentRec.phone, studentRec.course]);
        }
        studentRec.allotment_id = allotId;
        record = studentRec;
      }
    }

    if (!record) {
      return res.status(404).json({
        success: false,
        error: `No pre-allotted resident profile found matching "${clean}". Please verify your roll number or phone number, or contact the hostel administration.`
      });
    }

    // Check if biometric facial vectors already exist
    if (record.student_id) {
      const faceCount = await getQuery(`SELECT COUNT(*) as count FROM student_face_embeddings WHERE student_id = ?`, [record.student_id]);
      if (faceCount && faceCount.count > 0) {
        return res.status(400).json({
          success: false,
          error: `Face biometrics are already registered for Roll Number ${record.roll_number} (${record.full_name}). Your account is fully active. Please go back to Sign In and log in directly.`
        });
      }
    }

    const hasPhone = Boolean(record.phone && record.phone.trim().length >= 8);
    const hasEmail = Boolean(record.email && record.email.includes('@'));

    // Return ONLY masked, privacy-safe information (No room numbers or raw contacts shown to public)
    res.json({
      success: true,
      student: {
        roll_number: record.roll_number,
        full_name: record.full_name,
        course: record.course,
        has_phone: hasPhone,
        masked_phone: hasPhone ? maskPhone(record.phone) : null,
        has_email: hasEmail,
        masked_email: hasEmail ? maskEmail(record.email) : null
      }
    });
  } catch (err) {
    console.error('Onboarding lookup error:', err);
    res.status(500).json({ success: false, error: 'Identity lookup failed: ' + err.message });
  }
});

// 3. Dispatch Secure 6-Digit Verification OTP to Student's Registered Phone or Email
router.post('/onboarding/send-otp', authLimiter, async (req, res) => {
  try {
    const { roll_number, method = 'PHONE', contact_override } = req.body;
    if (!roll_number) {
      return res.status(400).json({ success: false, error: 'Roll number is required.' });
    }

    const cleanMethod = String(method).toUpperCase();
    if (!['PHONE', 'EMAIL'].includes(cleanMethod)) {
      return res.status(400).json({ success: false, error: 'Verification method must be PHONE or EMAIL.' });
    }

    const record = await getQuery(`
      SELECT 
        a.id as allotment_id,
        a.roll_number,
        a.full_name,
        COALESCE(s.email, a.email) as email,
        COALESCE(s.phone, a.phone) as phone
      FROM hostel_allotments a
      LEFT JOIN students s ON s.roll_number = a.roll_number
      WHERE LOWER(a.roll_number) = LOWER(?)
    `, [roll_number.trim()]);

    if (!record) {
      return res.status(404).json({ success: false, error: 'Student allotment record not found.' });
    }

    let destination = '';
    if (cleanMethod === 'PHONE') {
      destination = record.phone || contact_override;
      if (!destination || destination.trim().length < 8) {
        return res.status(400).json({ success: false, error: 'No mobile phone number registered on file. Please enter your mobile number.' });
      }
    } else {
      destination = record.email || contact_override;
      if (!destination || !destination.includes('@')) {
        return res.status(400).json({ success: false, error: 'No email address registered on file. Please enter your email.' });
      }
    }

    destination = destination.trim();

    // Rate-limit check
    const recentOtps = await getQuery(`
      SELECT COUNT(*) as count
      FROM password_reset_otps
      WHERE (identifier = ? OR destination = ?)
        AND created_at > datetime('now', '-10 minutes')
    `, [record.roll_number, destination]);

    if (process.env.NODE_ENV !== 'test' && recentOtps && recentOtps.count >= 5) {
      return res.status(429).json({
        success: false,
        error: 'Too many OTP requests. Please wait 10 minutes before requesting a new code.'
      });
    }

    // Invalidate existing unused OTPs
    await runQuery(`
      UPDATE password_reset_otps
      SET is_used = 1
      WHERE identifier = ? AND is_used = 0
    `, [record.roll_number]);

    // Generate 6-digit OTP
    const otpCode = crypto.randomInt(100000, 999999).toString();
    const otpId = uuidv4();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await runQuery(`
      INSERT INTO password_reset_otps (
        id, identifier, otp_code, method, destination, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [
      otpId,
      record.roll_number,
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
        studentName: record.full_name,
        rollNumber: record.roll_number
      });
    } else {
      dispatchResult = await sendSmsOtp({
        phone: destination,
        otpCode,
        studentName: record.full_name,
        rollNumber: record.roll_number
      });
    }

    res.json({
      success: true,
      message: `A 6-digit verification code has been dispatched via ${cleanMethod === 'EMAIL' ? 'Email' : 'SMS'} to ${dispatchResult.maskedDestination}.`,
      roll_number: record.roll_number,
      method: cleanMethod,
      maskedDestination: dispatchResult.maskedDestination,
      expiresInMinutes: 10,
      ...(process.env.NODE_ENV !== 'production' ? { debugOtp: dispatchResult.debugOtp } : {})
    });
  } catch (err) {
    console.error('Send onboarding OTP error:', err);
    res.status(500).json({ success: false, error: 'Failed to send verification code: ' + err.message });
  }
});

// 4. Verify OTP & Reveal Initial Portal Credentials + Temporary Onboarding Session
router.post('/onboarding/verify-otp', authLimiter, async (req, res) => {
  try {
    const { roll_number, otp } = req.body;
    if (!roll_number || !otp) {
      return res.status(400).json({ success: false, error: 'Roll number and 6-digit OTP code are required.' });
    }

    const cleanRoll = roll_number.trim();
    const cleanOtp = String(otp).trim();

    // Find active OTP record with attempt throttling
    const activeOtp = await getQuery(`
      SELECT * FROM password_reset_otps
      WHERE identifier = ?
        AND is_used = 0
        AND datetime(expires_at) > datetime('now')
      ORDER BY created_at DESC
      LIMIT 1
    `, [cleanRoll]);

    if (!activeOtp) {
      return res.status(400).json({ success: false, error: 'Invalid or expired OTP code. Please check the code or request a new one.' });
    }

    if (activeOtp.attempts >= 5) {
      await runQuery(`UPDATE password_reset_otps SET is_used = 1 WHERE id = ?`, [activeOtp.id]);
      return res.status(400).json({
        success: false,
        error: 'Too many incorrect attempts. This OTP has been invalidated for security. Please request a new one.'
      });
    }

    if (activeOtp.otp_code !== cleanOtp) {
      await runQuery(`UPDATE password_reset_otps SET attempts = attempts + 1 WHERE id = ?`, [activeOtp.id]);
      return res.status(400).json({ success: false, error: 'Invalid OTP code. Please check the code or request a new one.' });
    }

    // Mark OTP used
    await runQuery(`UPDATE password_reset_otps SET is_used = 1 WHERE id = ?`, [activeOtp.id]);
    const otpRecord = activeOtp;

    // Fetch full verified allotment & student profile
    const record = await getQuery(`
      SELECT 
        a.id as allotment_id,
        a.roll_number,
        a.full_name,
        a.room_number,
        a.hostel_block,
        a.course,
        a.admission_year,
        a.semester,
        COALESCE(s.email, a.email) as email,
        COALESCE(s.phone, a.phone) as phone,
        s.id as student_id
      FROM hostel_allotments a
      LEFT JOIN students s ON s.roll_number = a.roll_number
      WHERE LOWER(a.roll_number) = LOWER(?)
    `, [cleanRoll]);

    if (!record) {
      return res.status(404).json({ success: false, error: 'Student allotment record not found.' });
    }

    // Issue signed temporary onboarding token (valid for 30 minutes)
    const onboardingToken = jwt.sign(
      {
        roll_number: record.roll_number,
        purpose: 'BIOMETRIC_ONBOARDING',
        allotment_id: record.allotment_id
      },
      JWT_SECRET,
      { expiresIn: '30m' }
    );

    const initialPassword = 'Student@12345';

    // Now identity is proven via OTP, so we safely reveal credentials and room details to the authenticated student
    res.json({
      success: true,
      message: 'OTP verified successfully! Here are your official portal credentials.',
      onboarding_token: onboardingToken,
      credentials: {
        username: record.roll_number,
        initial_password: initialPassword
      },
      student: {
        roll_number: record.roll_number,
        full_name: record.full_name,
        room_number: record.room_number,
        hostel_block: record.hostel_block,
        course: record.course,
        admission_year: record.admission_year,
        semester: record.semester,
        email: record.email,
        phone: record.phone
      }
    });
  } catch (err) {
    console.error('Verify onboarding OTP error:', err);
    res.status(500).json({ success: false, error: 'OTP verification failed: ' + err.message });
  }
});

// 5. Student Onboarding & Face Registration (Phase 2)
router.post('/onboard', async (req, res) => {
  try {
    const {
      onboarding_token,
      roll_number,
      course,
      admission_year,
      semester,
      device_id,
      device_model,
      email,
      phone,
      password = 'Student@12345',
      photos
    } = req.body;

    if (!onboarding_token) {
      return res.status(401).json({ success: false, error: 'Verified onboarding token is required. Please verify OTP first.' });
    }

    let targetRoll = '';
    try {
      const decoded = jwt.verify(onboarding_token, JWT_SECRET);
      if (decoded.purpose !== 'BIOMETRIC_ONBOARDING' || !decoded.roll_number) {
        return res.status(401).json({ success: false, error: 'Invalid onboarding token purpose. Please verify OTP again.' });
      }
      targetRoll = decoded.roll_number;
    } catch (tokErr) {
      return res.status(401).json({ success: false, error: 'Onboarding session expired or invalid. Please verify your OTP again.' });
    }

    if (!photos || !Array.isArray(photos) || photos.length === 0) {
      return res.status(400).json({ success: false, error: 'Facial capture required. Please capture at least one face photo.' });
    }

    // Verify allotment
    let allotment = await getQuery(`SELECT * FROM hostel_allotments WHERE LOWER(TRIM(roll_number)) = LOWER(TRIM(?))`, [targetRoll]);
    if (!allotment) {
      const st = await getQuery(`SELECT * FROM students WHERE LOWER(TRIM(roll_number)) = LOWER(TRIM(?))`, [targetRoll]);
      if (st) {
        const newAllotId = uuidv4();
        await runQuery(`
          INSERT INTO hostel_allotments (id, roll_number, full_name, room_number, hostel_block, email, phone, course, is_registered)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
        `, [newAllotId, st.roll_number, st.full_name, st.room_number || 'A-101', st.hostel_block || 'Block A', st.email, st.phone, st.course]);
        allotment = await getQuery(`SELECT * FROM hostel_allotments WHERE id = ?`, [newAllotId]);
      } else {
        return res.status(404).json({ success: false, error: 'Selected roll number is not on the hostel allotment roster.' });
      }
    }

    const existingStudent = await getQuery(`SELECT * FROM students WHERE roll_number = ?`, [targetRoll]);
    if (allotment.is_registered === 1 && existingStudent) {
      const existingFaces = await getQuery(`SELECT COUNT(*) as count FROM student_face_embeddings WHERE student_id = ?`, [existingStudent.id]);
      if (existingFaces && existingFaces.count > 0) {
        return res.status(400).json({ success: false, error: 'This student has already completed onboarding and face registration.' });
      }
    }

    const targetCourse = course || allotment.course || 'B.Tech Computer Science';
    const targetAdmYear = admission_year || allotment.admission_year || new Date().getFullYear();
    const targetSemester = semester || allotment.semester || 1;
    const targetEmail = (email || allotment.email || existingStudent?.email || `${targetRoll.toLowerCase()}@student.hostel.local`).trim().toLowerCase();
    const targetPhone = (phone || allotment.phone || existingStudent?.phone || '').trim();

    // Call Python AI microservice to extract 128D mathematical vectors
    let aiResponse;
    try {
      aiResponse = await aiServiceClient.extractEmbeddings(photos);
    } catch (aiErr) {
      return res.status(400).json({
        success: false,
        error: `Face processing failed: ${aiErr.message}. Ensure your face is centered with good lighting.`
      });
    }

    if (!aiResponse.embeddings || aiResponse.embeddings.length === 0) {
      return res.status(400).json({ success: false, error: 'Could not detect face in captured photos.' });
    }

    // Generate credentials & IDs
    const studentId = existingStudent ? existingStudent.id : `HSTL-${targetAdmYear}-${targetRoll.replace(/[^a-zA-Z0-9]/g, '')}`;
    const devId = device_id || `DEV-${uuidv4().substring(0, 8)}`;

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const userEmail = targetEmail;
    const userPhone = targetPhone;

    let existingUser = await getQuery(`SELECT id FROM users WHERE username = ?`, [targetRoll]);
    let userId = existingUser ? existingUser.id : uuidv4();

    // Verify email is not already used by another user account
    const emailConflictUser = await getQuery(
      `SELECT username FROM users WHERE LOWER(email) = LOWER(?) AND id != ?`,
      [userEmail, userId]
    );
    if (emailConflictUser) {
      return res.status(400).json({
        success: false,
        error: `The email "${userEmail}" is already registered to another account (${emailConflictUser.username}). Each student requires a unique email address.`
      });
    }

    // Commit atomically in transaction
    await withTransaction(async ({ runQuery }) => {
      if (!existingUser) {
        // Create user
        await runQuery(`
          INSERT INTO users (id, username, email, password_hash, role, student_id, is_active, must_change_password)
          VALUES (?, ?, ?, ?, 'STUDENT', ?, 1, 0)
        `, [userId, targetRoll, userEmail, passwordHash, studentId]);
      } else {
        // Update user email and student_id
        await runQuery(`
          UPDATE users
          SET email = ?, student_id = ?
          WHERE id = ?
        `, [userEmail, studentId, userId]);
      }

      if (!existingStudent) {
        // Create student profile
        await runQuery(`
          INSERT INTO students (
            id, user_id, allotment_id, roll_number, full_name, email, phone,
            course, admission_year, semester, room_number, hostel_block,
            device_id, device_model, face_enrollment_status, face_enrolled_at, face_enrolled_version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ENROLLED', CURRENT_TIMESTAMP, 1)
        `, [
          studentId,
          userId,
          allotment.id,
          allotment.roll_number,
          allotment.full_name,
          userEmail,
          userPhone,
          targetCourse,
          parseInt(targetAdmYear),
          parseInt(targetSemester),
          allotment.room_number,
          allotment.hostel_block,
          devId,
          device_model || 'Unknown Device'
        ]);
      } else {
        // Update student contact details and device
        await runQuery(`
          UPDATE students
          SET email = ?, phone = ?, course = ?, admission_year = ?, semester = ?,
              device_id = ?, device_model = ?,
              face_enrollment_status = 'ENROLLED',
              face_enrolled_at = CURRENT_TIMESTAMP,
              face_enrolled_version = COALESCE(face_enrolled_version, 0) + 1
          WHERE id = ?
        `, [
          userEmail, userPhone, targetCourse, parseInt(targetAdmYear), parseInt(targetSemester),
          devId, device_model || 'Unknown Device',
          existingStudent.id
        ]);
      }

      // Store face embeddings
      for (const embItem of aiResponse.embeddings) {
        await runQuery(`
          INSERT INTO student_face_embeddings (
            id, student_id, angle_label, embedding_vector, quality_score, liveness_score
          ) VALUES (?, ?, ?, ?, ?, ?)
        `, [
          uuidv4(),
          studentId,
          embItem.angle || 'FRONT',
          JSON.stringify(embItem.embedding),
          embItem.confidence || 1.0,
          embItem.liveness_score || 1.0
        ]);
      }

      // Mark allotment registered and update contact info
      await runQuery(`
        UPDATE hostel_allotments
        SET is_registered = 1, email = ?, phone = ?
        WHERE id = ?
      `, [userEmail, userPhone, allotment.id]);
    });

    embeddingCache.invalidate(studentId);

    const userObj = { id: userId, username: targetRoll, role: 'STUDENT', student_id: studentId };
    const token = generateToken(userObj);

    res.json({
      success: true,
      message: 'Student onboarded and facial identity created successfully!',
      token,
      student: {
        id: studentId,
        userId,
        rollNumber: allotment.roll_number,
        fullName: allotment.full_name,
        course: targetCourse,
        admissionYear: targetAdmYear,
        semester: targetSemester,
        roomNumber: allotment.room_number,
        hostelBlock: allotment.hostel_block,
        deviceId: devId,
        storedVectorCount: aiResponse.embeddings.length
      }
    });
  } catch (err) {
    console.error('Onboarding failed:', err);
    const msg = String(err.message || '');
    if (msg.includes('UNIQUE constraint failed: users.email') || msg.includes('UNIQUE constraint failed: students.email')) {
      return res.status(400).json({
        success: false,
        error: 'The provided email is already associated with another account. Please use your unique institutional email.'
      });
    }
    res.status(500).json({ success: false, error: 'Onboarding error: ' + err.message });
  }
});

// Authenticated Student Endpoints
router.use(requireAuth, requireRole('STUDENT'));

// 3. Student Dashboard Overview
router.get('/dashboard', async (req, res) => {
  try {
    const today = getIstDateString();
    const student = await getQuery(`SELECT * FROM students WHERE id = ? OR user_id = ? OR roll_number = ?`, [req.user.student_id, req.user.id, req.user.username]);

    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const todayRecord = await getQuery(`
      SELECT * FROM attendance_records WHERE student_id = ? AND date = ?
    `, [student.id, today]);

    // Calculate comprehensive day-count hostel attendance summary (NO percentages!)
    const summary = await getStudentAttendanceSummary(student.id);

    // Recent 10 logs
    const history = await allQuery(`
      SELECT * FROM attendance_records
      WHERE student_id = ?
      ORDER BY date DESC
      LIMIT 10
    `, [student.id]);

    const activeGeofence = await getQuery(`SELECT * FROM geofence_configs WHERE is_active = 1 LIMIT 1`);
    const activeBeacons = await allQuery(`
      SELECT beacon_public_id, block_name, is_active, last_seen_at
      FROM site_ble_beacons
      WHERE is_active = 1
    `);

    // Sanitize beacons to never expose shared_secret_hex or mac_address
    const sanitizedBeacons = (activeBeacons || []).map(b => ({
      beacon_public_id: b.beacon_public_id,
      block_name: b.block_name,
      is_active: b.is_active,
      last_seen_at: b.last_seen_at
    }));

    let bleTimeSyncPacket = null;
    try {
      if (activeBeacons && activeBeacons.length > 0) {
        const beaconFull = await bleBeaconService.resolveBeacon(activeBeacons[0].beacon_public_id);
        if (beaconFull && beaconFull.shared_secret_ref) {
          bleTimeSyncPacket = bleBeaconService.generateTimeSyncPacket(beaconFull.beacon_public_id, beaconFull.shared_secret_ref);
        }
      }
    } catch (_) {}

    const faceEmbeddingsCount = await getQuery(`
      SELECT COUNT(*) as count FROM student_face_embeddings WHERE student_id = ? OR student_id = ?
    `, [student.id, student.roll_number]);
    const countVal = faceEmbeddingsCount?.count || 0;
    const isEnrolled = (student.face_enrollment_status === 'ENROLLED') || (countVal > 0);
    const authoritativeStatus = isEnrolled ? 'ENROLLED' : 'NOT_ENROLLED';

    // Synchronize column if it was NOT_ENROLLED but count > 0
    if (countVal > 0 && student.face_enrollment_status !== 'ENROLLED') {
      try {
        await runQuery(
          `UPDATE students SET face_enrollment_status = 'ENROLLED', face_enrolled_at = COALESCE(face_enrolled_at, CURRENT_TIMESTAMP) WHERE id = ?`,
          [student.id]
        );
        student.face_enrollment_status = 'ENROLLED';
      } catch (_) {}
    }
    const hasFaceRegistered = isEnrolled;

    res.json({
      success: true,
      hasFaceRegistered,
      enrollmentStatus: authoritativeStatus,
      face_enrollment_status: authoritativeStatus,
      student,
      todayStatus: {
        isMarkedToday: Boolean(todayRecord),
        status: todayRecord ? todayRecord.status : 'PENDING',
        record: todayRecord || null
      },
      stats: {
        // Core Hostel Day-Count Metrics (3-Tier & Month-to-Date Progress)
        monthlyPresent: summary.currentMonth.daysPresent,
        monthlyLeave: summary.currentMonth.daysLeave,
        monthlyAbsent: summary.currentMonth.daysAbsent,
        daysInMonth: summary.currentMonth.daysInMonth,
        daysElapsed: summary.currentMonth.daysElapsed,
        daysRemaining: summary.currentMonth.daysRemaining,
        isOnTrack: summary.currentMonth.isOnTrack,
        mtdText: summary.currentMonth.mtdText,
        monthlyHolidays: summary.currentMonth.holidaysExcluded,
        monthlyActiveDays: summary.currentMonth.activeDays,
        currentMonthName: summary.currentMonth.monthName,

        yearlyPresent: summary.yearlySummary.daysPresent,
        yearlyLeave: summary.yearlySummary.daysLeave,
        yearlyAbsent: summary.yearlySummary.daysAbsent,
        daysInYear: summary.yearlySummary.daysInYear,
        dayOfYear: summary.yearlySummary.dayOfYear,
        daysRemainingInYear: summary.yearlySummary.daysRemainingInYear,
        yearlyHolidays: summary.yearlySummary.holidaysExcluded,
        yearlyActiveDays: summary.yearlySummary.activeDays,
        currentYear: summary.yearlySummary.year,

        presentDays: summary.lifetime.totalPresent,
        leaveDays: summary.lifetime.totalLeave,
        absentDays: summary.lifetime.totalAbsent,
        totalDaysRecorded: summary.lifetime.totalRecorded,
        safetyAlert: summary.safetyAlert,

        failedStrikes: student.failed_attempts || 0,
        isFlaggedForge: Boolean(student.is_flagged_forge),
        hasFaceRegistered,
        enrollmentStatus: authoritativeStatus,
        face_enrollment_status: authoritativeStatus,
        faceEmbeddingsCount: countVal
      },
      currentMonth: summary.currentMonth,
      yearlySummary: summary.yearlySummary,
      monthlyBreakdown: summary.monthlyBreakdown,
      lifetime: summary.lifetime,
      geofence: activeGeofence,
      beacons: sanitizedBeacons,
      wifi_cluster_endpoints: wifiClusterService.getEndpoints(),
      ble_time_sync_packet: bleTimeSyncPacket,
      recentHistory: history
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3b. Student Attendance Ledger (Month-by-Month & Annual Breakdown)
router.get('/attendance-ledger', async (req, res) => {
  try {
    const student = await getQuery(`SELECT id FROM students WHERE user_id = ? OR id = ?`, [req.user.id, req.user.student_id]);
    if (!student) return res.status(404).json({ success: false, error: 'Student profile not found.' });

    const year = req.query.year ? parseInt(req.query.year, 10) : new Date().getFullYear();
    const ledger = await getStudentAttendanceSummary(student.id, year);
    res.json({ success: true, ledger });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Student Attendance History
router.get('/history', async (req, res) => {
  try {
    const student = await getQuery(`SELECT id FROM students WHERE user_id = ? OR id = ?`, [req.user.id, req.user.student_id]);
    if (!student) return res.status(404).json({ success: false, error: 'Student profile not found.' });

    const records = await allQuery(`
      SELECT * FROM attendance_records
      WHERE student_id = ?
      ORDER BY date DESC
    `, [student.id]);

    res.json({ success: true, records });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Submit Attendance Correction Request
router.post('/corrections', async (req, res) => {
  try {
    const { date, requested_status = 'PRESENT', reason } = req.body;

    if (!date || !reason) {
      return res.status(400).json({ success: false, error: 'Date and justification reason are required.' });
    }

    const student = await getQuery(`SELECT * FROM students WHERE user_id = ? OR id = ?`, [req.user.id, req.user.student_id]);
    if (!student) return res.status(404).json({ success: false, error: 'Student not found.' });

    // Check existing attendance on that date
    const att = await getQuery(`SELECT * FROM attendance_records WHERE student_id = ? AND date = ?`, [student.id, date]);
    const originalStatus = att ? att.status : 'ABSENT';

    // Prevent duplicate pending requests
    const existingReq = await getQuery(`SELECT id FROM attendance_corrections WHERE student_id = ? AND date = ? AND status = 'PENDING'`, [student.id, date]);
    if (existingReq) {
      return res.status(400).json({ success: false, error: 'A pending correction request already exists for this date.' });
    }

    const correctionId = uuidv4();
    await runQuery(`
      INSERT INTO attendance_corrections (
        id, attendance_id, student_id, roll_number, date, original_status, requested_status, reason, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
    `, [correctionId, att?.id || null, student.id, student.roll_number, date, originalStatus, requested_status, reason]);

    res.json({ success: true, message: 'Correction request submitted for administrative review.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/corrections', async (req, res) => {
  try {
    const student = await getQuery(`SELECT id FROM students WHERE user_id = ? OR id = ?`, [req.user.id, req.user.student_id]);
    const list = await allQuery(`
      SELECT * FROM attendance_corrections
      WHERE student_id = ?
      ORDER BY created_at DESC
    `, [student.id]);

    res.json({ success: true, corrections: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Feedback & Support Tickets
router.post('/feedback', async (req, res) => {
  try {
    const { category, subject, message } = req.body;

    if (!category || !subject || !message) {
      return res.status(400).json({ success: false, error: 'Category, subject, and message are required.' });
    }

    const student = await getQuery(`SELECT * FROM students WHERE user_id = ? OR id = ?`, [req.user.id, req.user.student_id]);
    if (!student) return res.status(404).json({ success: false, error: 'Student not found.' });

    const categoryMap = {
      'Hostel Facilities': 'ROOM',
      'Wi-Fi / Internet': 'HARDWARE',
      'Mess & Food': 'GENERAL',
      'App / Technical': 'ATTENDANCE',
      'ATTENDANCE': 'ATTENDANCE',
      'HARDWARE': 'HARDWARE',
      'GEOFENCE': 'GEOFENCE',
      'GENERAL': 'GENERAL',
      'ROOM': 'ROOM'
    };
    const dbCategory = categoryMap[category] || 'GENERAL';

    const ticketId = uuidv4();
    await runQuery(`
      INSERT INTO feedback_tickets (id, student_id, roll_number, category, subject, message, status)
      VALUES (?, ?, ?, ?, ?, ?, 'OPEN')
    `, [ticketId, student.id, student.roll_number, dbCategory, subject, message]);

    res.json({ success: true, message: 'Support ticket submitted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/feedback', async (req, res) => {
  try {
    const student = await getQuery(`SELECT id FROM students WHERE user_id = ? OR id = ?`, [req.user.id, req.user.student_id]);
    const tickets = await allQuery(`
      SELECT * FROM feedback_tickets
      WHERE student_id = ?
      ORDER BY created_at DESC
    `, [student.id]);

    res.json({ success: true, tickets, feedback: tickets });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Student Self-Service Face Registration & Authoritative Enrollment
router.post('/register-face', async (req, res) => {
  try {
    const { photos, is_re_enrollment, isReEnrollment } = req.body;
    if (!photos || !Array.isArray(photos) || photos.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one face capture photo is required.' });
    }

    const student = await getQuery(`SELECT * FROM students WHERE user_id = ? OR id = ? OR roll_number = ?`, [req.user.id, req.user.student_id, req.user.username]);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    // A. Check if already enrolled to prevent silent/accidental overwrite
    const existingCount = await getQuery(
      `SELECT COUNT(*) as count FROM student_face_embeddings WHERE student_id = ? OR student_id = ?`,
      [student.id, student.roll_number]
    );
    const hasPriorEnrollment = (existingCount?.count || 0) > 0 || student.face_enrollment_status === 'ENROLLED';
    const isReEnrollmentRequested = Boolean(is_re_enrollment || isReEnrollment);

    if (hasPriorEnrollment && !isReEnrollmentRequested) {
      return res.status(409).json({
        success: false,
        isAlreadyEnrolled: true,
        alreadyEnrolled: true,
        error: 'You have already completed biometric face enrollment. To update your face biometrics, request an authorized re-enrollment.'
      });
    }

    // B. Extract and validate vectors with deep PAD anti-spoofing
    let aiResponse;
    try {
      aiResponse = await aiServiceClient.extractEmbeddings(photos);
    } catch (aiErr) {
      return res.status(400).json({
        success: false,
        error: `Face processing failed: ${aiErr.message}. Ensure your face is centered with good lighting.`
      });
    }

    if (!aiResponse.embeddings || aiResponse.embeddings.length === 0) {
      return res.status(400).json({ success: false, error: 'Could not detect face in captured photos.' });
    }

    // C. ENFORCE ANTI-SPOOFING ON ENROLLMENT: Reject if any capture failed presentation attack detection
    const spoofedItem = aiResponse.embeddings.find(e => e.is_live === false || (e.liveness_score !== undefined && e.liveness_score < 0.60));
    if (spoofedItem) {
      await runQuery(`
        INSERT INTO security_audit_logs (
          id, student_id, roll_number, incident_type, calculated_distance, details,
          ip_address, risk_score, decision_outcome, reason_codes
        ) VALUES (?, ?, ?, 'ENROLLMENT_SPOOF_ATTEMPT', 0, ?, ?, 95, 'DENY', 'L8_ENROLLMENT_PAD_FAILED')
      `, [
        uuidv4(),
        student.id,
        student.roll_number,
        `Spoof attack detected during face enrollment (score: ${spoofedItem.liveness_score || 0.0})`,
        req.ip || '127.0.0.1'
      ]);

      return res.status(403).json({
        success: false,
        status: 'ENROLLMENT_SPOOF_DETECTED',
        error: 'Face enrollment rejected: Presentation attack detected (photograph or screen display). You must register with a live camera.'
      });
    }

    // D. Safe Atomic Replacement & Version Increment
    await withTransaction(async ({ runQuery }) => {
      await runQuery(`DELETE FROM student_face_embeddings WHERE student_id = ? OR student_id = ?`, [student.id, student.roll_number]);

      for (const embItem of aiResponse.embeddings) {
        await runQuery(`
          INSERT INTO student_face_embeddings (
            id, student_id, angle_label, embedding_vector, quality_score, liveness_score
          ) VALUES (?, ?, ?, ?, ?, ?)
        `, [
          uuidv4(),
          student.id,
          embItem.angle || 'FRONT',
          JSON.stringify(embItem.embedding),
          embItem.confidence || 1.0,
          embItem.liveness_score || 1.0
        ]);
      }

      await runQuery(`
        UPDATE students
        SET face_enrollment_status = 'ENROLLED',
            face_enrolled_at = CURRENT_TIMESTAMP,
            face_enrolled_version = COALESCE(face_enrolled_version, 0) + 1
        WHERE id = ?
      `, [student.id]);
    });

    // Invalidate and refresh cache
    embeddingCache.invalidate(student.id);
    embeddingCache.invalidate(student.roll_number);
    embeddingCache.set(student.id, aiResponse.embeddings.map(e => e.embedding));

    await recordAuditEvent(
      req.user.id,
      req.user.username,
      hasPriorEnrollment ? 'UPDATE_FACE_PROFILE' : 'REGISTER_FACE',
      'STUDENT',
      student.id,
      `Enrolled ${aiResponse.embeddings.length} biometric facial vectors (status: ENROLLED)`,
      req
    );

    res.json({
      success: true,
      enrollmentStatus: 'ENROLLED',
      face_enrollment_status: 'ENROLLED',
      hasFaceRegistered: true,
      message: hasPriorEnrollment ? 'Facial identity profile successfully updated!' : 'Facial identity successfully registered! You can now mark biometric attendance.',
      embeddingsCount: aiResponse.embeddings.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
