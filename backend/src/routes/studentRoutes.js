const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { runQuery, getQuery, allQuery, withTransaction } = require('../db/database');
const { generateToken, requireAuth, requireRole, recordAuditEvent } = require('../middleware/auth');
const aiServiceClient = require('../services/aiServiceClient');

// 1. Public Searchable Allotment List (Enforces: Student cannot type name manually!)
router.get('/allotment-list', async (req, res) => {
  try {
    const list = await allQuery(`
      SELECT id, roll_number, full_name, room_number, hostel_block, email, phone, course, admission_year, semester
      FROM hostel_allotments
      WHERE is_registered = 0
      ORDER BY full_name ASC
    `);
    res.json({ success: true, allotments: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Student Onboarding & Face Registration (Phase 2)
router.post('/onboard', async (req, res) => {
  try {
    const {
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

    if (!roll_number) {
      return res.status(400).json({ success: false, error: 'Please select a pre-allotted student identity.' });
    }

    if (!course || !admission_year || !semester) {
      return res.status(400).json({ success: false, error: 'Course, admission year, and semester are required.' });
    }

    if (!email || !phone) {
      return res.status(400).json({
        success: false,
        error: 'Student Email Address and Mobile Phone Number are strictly required for Real OTP Authentication & Account Recovery.'
      });
    }

    if (!photos || !Array.isArray(photos) || photos.length === 0) {
      return res.status(400).json({ success: false, error: 'Facial capture required. Please capture at least one face photo.' });
    }

    // Verify allotment
    const allotment = await getQuery(`SELECT * FROM hostel_allotments WHERE roll_number = ?`, [roll_number.trim()]);
    if (!allotment) {
      return res.status(404).json({ success: false, error: 'Selected roll number is not on the hostel allotment roster.' });
    }

    if (allotment.is_registered === 1) {
      // Check if student already has face embeddings
      const studentRec = await getQuery(`SELECT id FROM students WHERE roll_number = ?`, [roll_number.trim()]);
      if (studentRec) {
        const existingFaces = await getQuery(`SELECT COUNT(*) as count FROM student_face_embeddings WHERE student_id = ?`, [studentRec.id]);
        if (existingFaces && existingFaces.count > 0) {
          return res.status(400).json({ success: false, error: 'This student has already completed onboarding and face registration.' });
        }
      }
    }

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
    const studentId = `HSTL-${admission_year}-${roll_number.replace(/[^a-zA-Z0-9]/g, '')}`;
    const devId = device_id || `DEV-${uuidv4().substring(0, 8)}`;

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const userEmail = email.trim().toLowerCase();
    const userPhone = phone.trim();

    let existingUser = await getQuery(`SELECT id FROM users WHERE username = ?`, [roll_number.trim()]);
    let existingStudent = await getQuery(`SELECT id FROM students WHERE roll_number = ?`, [roll_number.trim()]);
    let userId = existingUser ? existingUser.id : uuidv4();

    // Commit atomically in transaction
    await withTransaction(async ({ runQuery }) => {
      if (!existingUser) {
        // Create user
        await runQuery(`
          INSERT INTO users (id, username, email, password_hash, role, student_id, is_active, must_change_password)
          VALUES (?, ?, ?, ?, 'STUDENT', ?, 1, 0)
        `, [userId, roll_number.trim(), userEmail, passwordHash, studentId]);
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
            device_id, device_model
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          studentId,
          userId,
          allotment.id,
          allotment.roll_number,
          allotment.full_name,
          userEmail,
          userPhone,
          course,
          parseInt(admission_year),
          parseInt(semester),
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
              device_id = ?, device_model = ?
          WHERE id = ?
        `, [
          userEmail, userPhone, course, parseInt(admission_year), parseInt(semester),
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

    const userObj = { id: userId, username: roll_number.trim(), role: 'STUDENT', student_id: studentId };
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
        course,
        admissionYear: admission_year,
        semester,
        roomNumber: allotment.room_number,
        hostelBlock: allotment.hostel_block,
        deviceId: devId,
        storedVectorCount: aiResponse.embeddings.length
      }
    });
  } catch (err) {
    console.error('Onboarding failed:', err);
    res.status(500).json({ success: false, error: 'Onboarding error: ' + err.message });
  }
});

// Authenticated Student Endpoints
router.use(requireAuth, requireRole('STUDENT'));

// 3. Student Dashboard Overview
router.get('/dashboard', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const student = await getQuery(`SELECT * FROM students WHERE id = ? OR user_id = ?`, [req.user.student_id, req.user.id]);

    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const todayRecord = await getQuery(`
      SELECT * FROM attendance_records WHERE student_id = ? AND date = ?
    `, [student.id, today]);

    // Calculate 30-day stats
    const totalDaysRecorded = await getQuery(`SELECT COUNT(*) as count FROM attendance_records WHERE student_id = ?`, [student.id]);
    const presentDays = await getQuery(`SELECT COUNT(*) as count FROM attendance_records WHERE student_id = ? AND status IN ('PRESENT', 'EXCUSED')`, [student.id]);

    const percentage = (totalDaysRecorded?.count || 0) > 0
      ? Math.round(((presentDays?.count || 0) / totalDaysRecorded.count) * 100)
      : 100;

    // Recent 10 logs
    const history = await allQuery(`
      SELECT * FROM attendance_records
      WHERE student_id = ?
      ORDER BY date DESC
      LIMIT 10
    `, [student.id]);

    const activeGeofence = await getQuery(`SELECT * FROM geofence_configs WHERE is_active = 1 LIMIT 1`);

    res.json({
      success: true,
      student,
      todayStatus: {
        isMarkedToday: Boolean(todayRecord),
        status: todayRecord ? todayRecord.status : 'PENDING',
        record: todayRecord || null
      },
      stats: {
        totalDaysRecorded: totalDaysRecorded?.count || 0,
        presentDays: presentDays?.count || 0,
        attendancePercentage: percentage,
        failedStrikes: student.failed_attempts || 0,
        isFlaggedForge: Boolean(student.is_flagged_forge)
      },
      geofence: activeGeofence,
      recentHistory: history
    });
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

module.exports = router;
