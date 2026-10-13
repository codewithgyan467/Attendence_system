const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { runQuery, getQuery, allQuery, withTransaction } = require('../db/database');
const { requireAuth, requireRole, recordAuditEvent } = require('../middleware/auth');
const { clearForgeFlag } = require('../services/fraudService');

const upload = multer({ dest: 'uploads/' });

// Enforce Admin role on all endpoints in this router
router.use(requireAuth, requireRole('ADMIN'));

// 1. Executive Dashboard KPIs & Real Chart.js Datasets
router.get('/dashboard-stats', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Core KPIs
    const totalStudents = await getQuery(`SELECT COUNT(*) as count FROM students WHERE is_active = 1`);
    const totalAllotted = await getQuery(`SELECT COUNT(*) as count FROM hostel_allotments`);
    const presentTodayRow = await getQuery(`SELECT COUNT(*) as count FROM attendance_records WHERE date = ? AND status = 'PRESENT'`, [today]);
    const lateTodayRow = await getQuery(`SELECT COUNT(*) as count FROM attendance_records WHERE date = ? AND status = 'LATE'`, [today]);
    const flaggedForgeRow = await getQuery(`SELECT COUNT(*) as count FROM students WHERE is_flagged_forge = 1`);
    const pendingCorrectionsRow = await getQuery(`SELECT COUNT(*) as count FROM attendance_corrections WHERE status = 'PENDING'`);
    const openTicketsRow = await getQuery(`SELECT COUNT(*) as count FROM feedback_tickets WHERE status = 'OPEN'`);
    const activeGeofence = await getQuery(`SELECT * FROM geofence_configs WHERE is_active = 1 LIMIT 1`);

    const totalReg = totalStudents?.count || 0;
    const presentCount = presentTodayRow?.count || 0;
    const lateCount = lateTodayRow?.count || 0;
    const absentCount = Math.max(0, totalReg - presentCount - lateCount);

    // 7-Day Attendance Trend for Chart.js Line Chart
    const past7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });

      const dayPresent = await getQuery(`SELECT COUNT(*) as count FROM attendance_records WHERE date = ? AND status = 'PRESENT'`, [dateStr]);
      const dayLate = await getQuery(`SELECT COUNT(*) as count FROM attendance_records WHERE date = ? AND status = 'LATE'`, [dateStr]);

      past7Days.push({
        date: dateStr,
        day: dayName,
        present: dayPresent?.count || 0,
        late: dayLate?.count || 0,
        absent: Math.max(0, totalReg - (dayPresent?.count || 0) - (dayLate?.count || 0))
      });
    }

    // Attendance by Hostel Block for Chart.js Bar Chart
    const blockStats = await allQuery(`
      SELECT
        s.hostel_block as block,
        COUNT(s.id) as total_students,
        COUNT(a.id) as present_today
      FROM students s
      LEFT JOIN attendance_records a ON s.id = a.student_id AND a.date = ? AND a.status = 'PRESENT'
      WHERE s.is_active = 1 AND s.hostel_block IS NOT NULL
      GROUP BY s.hostel_block
    `, [today]);

    // Recent Attendance Events
    const recentActivity = await allQuery(`
      SELECT roll_number, full_name, date, time_marked, status, verified_distance
      FROM attendance_records
      ORDER BY created_at DESC
      LIMIT 10
    `);

    // Recent Admin Audit Events
    const recentAuditEvents = await allQuery(`
      SELECT username, action, target_type, details, created_at
      FROM admin_audit_events
      ORDER BY created_at DESC
      LIMIT 8
    `);

    res.json({
      success: true,
      summary: {
        totalRegistered: totalReg,
        totalAllotted: totalAllotted?.count || 0,
        presentToday: presentCount,
        lateToday: lateCount,
        absentToday: absentCount,
        attendancePercentage: totalReg > 0 ? Math.round(((presentCount + lateCount) / totalReg) * 100) : 0,
        flaggedForgeCount: flaggedForgeRow?.count || 0,
        pendingCorrections: pendingCorrectionsRow?.count || 0,
        openTickets: openTicketsRow?.count || 0,
        geofenceRadius: activeGeofence?.radius_meters || 20.0
      },
      charts: {
        weeklyTrend: past7Days,
        statusDistribution: {
          present: presentCount,
          late: lateCount,
          absent: absentCount
        },
        blockDistribution: blockStats
      },
      recentActivity,
      recentAuditEvents
    });
  } catch (err) {
    console.error('Dashboard Stats Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Student Management CRUD (Search, Filter, Pagination)
router.get('/students', async (req, res) => {
  try {
    const { search = '', block = '', course = '', page = 1, limit = 25 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereConditions = ['1=1'];
    let params = [];

    if (search.trim()) {
      whereConditions.push('(s.roll_number LIKE ? OR s.full_name LIKE ?)');
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    if (block) {
      whereConditions.push('s.hostel_block = ?');
      params.push(block);
    }

    if (course) {
      whereConditions.push('s.course = ?');
      params.push(course);
    }

    const whereClause = whereConditions.join(' AND ');

    const countRow = await getQuery(`SELECT COUNT(*) as count FROM students s WHERE ${whereClause}`, params);
    const totalCount = countRow?.count || 0;

    const students = await allQuery(`
      SELECT
        s.*,
        (SELECT COUNT(*) FROM student_face_embeddings e WHERE e.student_id = s.id) as embeddings_count
      FROM students s
      WHERE ${whereClause}
      ORDER BY s.roll_number ASC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), offset]);

    res.json({
      success: true,
      totalCount,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(totalCount / parseInt(limit)),
      students
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Student Details
router.get('/students/:id', async (req, res) => {
  try {
    const student = await getQuery(`SELECT * FROM students WHERE id = ?`, [req.params.id]);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found.' });
    }

    const embeddings = await allQuery(`
      SELECT id, angle_label, quality_score, liveness_score, created_at
      FROM student_face_embeddings
      WHERE student_id = ?
    `, [student.id]);

    const attendanceHistory = await allQuery(`
      SELECT * FROM attendance_records
      WHERE student_id = ?
      ORDER BY date DESC
      LIMIT 30
    `, [student.id]);

    res.json({ success: true, student, embeddings, attendanceHistory });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update Student
router.put('/students/:id', async (req, res) => {
  try {
    const { course, semester, room_number, hostel_block, phone, email, is_active } = req.body;

    const student = await getQuery(`SELECT * FROM students WHERE id = ?`, [req.params.id]);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found.' });
    }

    await runQuery(`
      UPDATE students
      SET course = ?, semester = ?, room_number = ?, hostel_block = ?, phone = ?, email = ?, is_active = ?
      WHERE id = ?
    `, [
      course || student.course,
      semester !== undefined ? parseInt(semester) : student.semester,
      room_number || student.room_number,
      hostel_block || student.hostel_block,
      phone || student.phone,
      email || student.email,
      is_active !== undefined ? (is_active ? 1 : 0) : student.is_active,
      student.id
    ]);

    await recordAuditEvent(req.user.id, req.user.username, 'UPDATE_STUDENT', 'STUDENT', student.id, `Updated details for ${student.roll_number}`, req);

    res.json({ success: true, message: 'Student record updated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Roster Upload Preview (Conflict Detection before Commit)
router.post('/allotment/upload-preview', upload.single('file'), async (req, res) => {
  try {
    let records = [];

    if (req.body?.allotments && Array.isArray(req.body.allotments)) {
      records = req.body.allotments;
    } else if (req.body?.records && Array.isArray(req.body.records)) {
      records = req.body.records;
    } else if (Array.isArray(req.body)) {
      records = req.body;
    } else if (req.file) {
      await new Promise((resolve, reject) => {
        fs.createReadStream(req.file.path)
          .pipe(csv())
          .on('data', (d) => records.push(d))
          .on('end', resolve)
          .on('error', reject);
      });
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    } else {
      return res.status(400).json({ success: false, error: 'Please upload a CSV file or provide an allotments/records JSON array.' });
    }

    const parsedRows = records.map((row, idx) => ({
      index: idx + 1,
      roll_number: (row.roll_number || row.rollNumber || row.RollNo || row['Roll Number'] || '').trim(),
      full_name: (row.full_name || row.fullName || row.Name || row['Student Name'] || '').trim(),
      room_number: (row.room_number || row.roomNumber || row.Room || row['Room No'] || 'A-101').trim(),
      hostel_block: (row.hostel_block || row.block || row.Hostel || row['Hostel Block'] || 'Block A').trim()
    }));

    const conflicts = [];
    const valid = [];
    const seenInFile = new Set();

    for (const r of parsedRows) {
      if (!r.roll_number || !r.full_name) {
        conflicts.push({ ...r, issue: 'Missing required roll number or full name', status: 'INVALID_FIELDS' });
        continue;
      }

      if (seenInFile.has(r.roll_number)) {
        conflicts.push({ ...r, issue: 'Duplicate roll number in uploaded file', status: 'CONFLICT_ALREADY_EXISTS' });
        continue;
      }
      seenInFile.add(r.roll_number);

      const existing = await getQuery(`SELECT roll_number FROM hostel_allotments WHERE roll_number = ?`, [r.roll_number]);
      if (existing) {
        conflicts.push({ ...r, issue: 'Roll number already exists on roster', status: 'CONFLICT_ALREADY_EXISTS' });
      } else {
        valid.push({ ...r, status: 'VALID' });
      }
    }

    const previewRecords = parsedRows.map((r) => {
      const conflict = conflicts.find((c) => c.index === r.index);
      return conflict || { ...r, status: 'VALID' };
    });

    res.json({
      success: true,
      totalSubmitted: parsedRows.length,
      validCount: valid.length,
      conflictCount: conflicts.length,
      validRecords: valid,
      conflictRecords: conflicts,
      preview: {
        totalRows: parsedRows.length,
        validRows: valid.length,
        conflictRows: conflicts.length,
        records: previewRecords
      }
    });
  } catch (err) {
    console.error('Upload preview failed:', err);
    res.status(500).json({ success: false, error: 'CSV Preview Error: ' + err.message });
  }
});

// Commit Roster Allotments Atomically in a Transaction
router.post('/allotment/upload-commit', async (req, res) => {
  try {
    const { validRecords } = req.body;
    if (!validRecords || !Array.isArray(validRecords) || validRecords.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid records provided for commit.' });
    }

    const inserted = await withTransaction(async ({ runQuery, getQuery }) => {
      let count = 0;
      for (const item of validRecords) {
        const existing = await getQuery(`SELECT id FROM hostel_allotments WHERE roll_number = ?`, [item.roll_number]);
        if (!existing) {
          await runQuery(`
            INSERT INTO hostel_allotments (id, roll_number, full_name, room_number, hostel_block, is_registered)
            VALUES (?, ?, ?, ?, ?, 0)
          `, [uuidv4(), item.roll_number, item.full_name, item.room_number || 'A-101', item.hostel_block || 'Block A']);
          count++;
        }
      }
      return count;
    });

    await recordAuditEvent(req.user.id, req.user.username, 'ROSTER_CSV_COMMIT', 'ALLOTMENT', null, `Imported ${inserted} students to hostel roster`, req);

    res.json({
      success: true,
      message: `Successfully committed ${inserted} new allotment records into database!`,
      insertedCount: inserted,
      committedCount: inserted
    });
  } catch (err) {
    console.error('Upload commit failed:', err);
    res.status(500).json({ success: false, error: 'Database transaction error: ' + err.message });
  }
});

// 4. Geofence Configuration
router.get('/geofence', async (req, res) => {
  try {
    const config = await getQuery(`SELECT * FROM geofence_configs WHERE is_active = 1 LIMIT 1`);
    res.json({
      success: true,
      config: config || {
        hostel_name: 'Main Campus Facility',
        latitude: 28.5450,
        longitude: 77.1926,
        radius_meters: 20.0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/geofence', async (req, res) => {
  try {
    const { hostel_name, latitude, longitude, radius_meters } = req.body;

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, error: 'Latitude and Longitude are required.' });
    }

    const radius = Math.max(10, Math.min(100, parseFloat(radius_meters) || 20.0));

    await runQuery(`
      UPDATE geofence_configs
      SET hostel_name = ?, latitude = ?, longitude = ?, radius_meters = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ?
      WHERE is_active = 1
    `, [hostel_name || 'Main Campus Facility', parseFloat(latitude), parseFloat(longitude), radius, req.user.username]);

    const updated = await getQuery(`SELECT * FROM geofence_configs WHERE is_active = 1 LIMIT 1`);

    await recordAuditEvent(req.user.id, req.user.username, 'UPDATE_GEOFENCE', 'GEOFENCE', updated.id, `Set radius to ${radius}m at [${latitude}, ${longitude}]`, req);

    res.json({
      success: true,
      message: 'Geofence configuration updated successfully.',
      config: updated
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Attendance Reports & Export
router.get('/reports', async (req, res) => {
  try {
    const { date, block, status, search } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    let conditions = ['a.date = ?'];
    let params = [targetDate];

    if (status) {
      conditions.push('a.status = ?');
      params.push(status);
    }

    if (block) {
      conditions.push('s.hostel_block = ?');
      params.push(block);
    }

    if (search) {
      conditions.push('(a.roll_number LIKE ? OR a.full_name LIKE ?)');
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    const records = await allQuery(`
      SELECT
        a.*,
        s.course,
        s.semester,
        s.room_number,
        s.hostel_block
      FROM attendance_records a
      LEFT JOIN students s ON a.student_id = s.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY a.time_marked DESC
    `, params);

    const totalStudents = await getQuery(`SELECT COUNT(*) as count FROM students WHERE is_active = 1`);
    const presentToday = await getQuery(`SELECT COUNT(*) as count FROM attendance_records WHERE date = ? AND status = 'PRESENT'`, [targetDate]);

    res.json({
      success: true,
      date: targetDate,
      summary: {
        totalRegistered: totalStudents?.count || 0,
        present: presentToday?.count || 0,
        absent: Math.max(0, (totalStudents?.count || 0) - (presentToday?.count || 0))
      },
      records
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Administrative Attendance Override (Non-destructive with mandatory reason)
router.post('/attendance/override', async (req, res) => {
  try {
    const { student_id, date, status, reason } = req.body;

    if (!student_id || !date || !status || !reason) {
      return res.status(400).json({
        success: false,
        error: 'Student ID, date, target status (PRESENT/EXCUSED/ABSENT), and override reason are required.'
      });
    }

    const student = await getQuery(`SELECT * FROM students WHERE id = ?`, [student_id]);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found.' });
    }

    const existingRecord = await getQuery(`SELECT * FROM attendance_records WHERE student_id = ? AND date = ?`, [student_id, date]);

    if (existingRecord) {
      await runQuery(`
        UPDATE attendance_records
        SET status = ?, is_override = 1, override_reason = ?, override_by = ?, time_marked = CURRENT_TIME
        WHERE id = ?
      `, [status, reason, req.user.username, existingRecord.id]);
    } else {
      await runQuery(`
        INSERT INTO attendance_records (
          id, student_id, roll_number, full_name, date, time_marked, status, is_override, override_reason, override_by
        ) VALUES (?, ?, ?, ?, ?, CURRENT_TIME, ?, 1, ?, ?)
      `, [uuidv4(), student.id, student.roll_number, student.full_name, date, status, reason, req.user.username]);
    }

    await recordAuditEvent(req.user.id, req.user.username, 'ATTENDANCE_OVERRIDE', 'ATTENDANCE', student.id, `Overrode ${student.roll_number} on ${date} to ${status}: ${reason}`, req);

    res.json({ success: true, message: `Attendance updated to ${status} for ${student.full_name}.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Attendance Correction Requests Management
router.get('/corrections', async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `
      SELECT c.*, s.full_name, s.course, s.semester, s.hostel_block, s.room_number
      FROM attendance_corrections c
      JOIN students s ON c.student_id = s.id
    `;
    const params = [];
    if (status) {
      sql += ' WHERE c.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY c.created_at DESC';

    const requests = await allQuery(sql, params);
    res.json({ success: true, requests });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/corrections/:id/review', async (req, res) => {
  try {
    const { decision, resolution_note } = req.body; // 'APPROVED' or 'REJECTED'
    if (!decision || !['APPROVED', 'REJECTED'].includes(decision)) {
      return res.status(400).json({ success: false, error: 'Decision must be APPROVED or REJECTED.' });
    }

    const correction = await getQuery(`SELECT * FROM attendance_corrections WHERE id = ?`, [req.params.id]);
    if (!correction) {
      return res.status(404).json({ success: false, error: 'Correction request not found.' });
    }

    if (correction.status !== 'PENDING') {
      return res.status(400).json({ success: false, error: `This request has already been ${correction.status}.` });
    }

    await withTransaction(async ({ runQuery }) => {
      // 1. Update correction record
      await runQuery(`
        UPDATE attendance_corrections
        SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, resolution_note = ?
        WHERE id = ?
      `, [decision, req.user.username, resolution_note || '', correction.id]);

      // 2. If approved, update or insert attendance record non-destructively
      if (decision === 'APPROVED') {
        const student = await getQuery(`SELECT * FROM students WHERE id = ?`, [correction.student_id]);
        const existingAtt = await getQuery(`SELECT id FROM attendance_records WHERE student_id = ? AND date = ?`, [correction.student_id, correction.date]);

        if (existingAtt) {
          await runQuery(`
            UPDATE attendance_records
            SET status = ?, is_override = 1, override_reason = ?, override_by = ?
            WHERE id = ?
          `, [correction.requested_status, `Approved correction request #${correction.id}: ${correction.reason}`, req.user.username, existingAtt.id]);
        } else {
          await runQuery(`
            INSERT INTO attendance_records (
              id, student_id, roll_number, full_name, date, time_marked, status, is_override, override_reason, override_by
            ) VALUES (?, ?, ?, ?, ?, CURRENT_TIME, ?, 1, ?, ?)
          `, [uuidv4(), correction.student_id, correction.roll_number, student.full_name, correction.date, correction.requested_status, `Approved correction: ${correction.reason}`, req.user.username]);
        }
      }
    });

    await recordAuditEvent(req.user.id, req.user.username, 'REVIEW_CORRECTION', 'CORRECTION', correction.id, `${decision} correction for ${correction.roll_number} on ${correction.date}`, req);

    res.json({ success: true, message: `Correction request marked as ${decision}.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Security Alerts & Strike Reset
router.get('/security/alerts', async (req, res) => {
  try {
    const alerts = await allQuery(`
      SELECT a.*, s.full_name, s.is_flagged_forge, s.failed_attempts
      FROM security_audit_logs a
      LEFT JOIN students s ON a.student_id = s.id
      ORDER BY a.created_at DESC
      LIMIT 100
    `);

    const flaggedStudents = await allQuery(`
      SELECT id, roll_number, full_name, course, semester, failed_attempts, is_flagged_forge
      FROM students
      WHERE is_flagged_forge = 1 OR failed_attempts > 0
      ORDER BY failed_attempts DESC
    `);

    res.json({
      success: true,
      flaggedCount: flaggedStudents.filter(s => s.is_flagged_forge === 1).length,
      flaggedStudents,
      recentAuditLogs: alerts
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reset Strike Counter with Mandatory Reason and Audit Entry
router.post('/security/reset-strike', async (req, res) => {
  try {
    const { rollNumber, roll_number, student_id, reason } = req.body;
    const identifier = rollNumber || roll_number || student_id;
    if (!identifier || !reason) {
      return res.status(400).json({ success: false, error: 'Student identifier and mandatory reset reason are required.' });
    }

    const student = await getQuery(`SELECT * FROM students WHERE roll_number = ? OR id = ?`, [identifier, identifier]);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found.' });
    }

    await clearForgeFlag(student.id);
    await recordAuditEvent(req.user.id, req.user.username, 'STRIKE_COUNTER_RESET', 'STUDENT', student.id, `Reset strikes for ${student.roll_number}: ${reason}`, req);

    res.json({ success: true, message: `Successfully reset strike counter for student ${student.roll_number}.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Audit Logs Viewer
router.get('/audit-logs', async (req, res) => {
  try {
    const { action, limit = 50 } = req.query;
    let sql = 'SELECT * FROM admin_audit_events';
    const params = [];
    if (action) {
      sql += ' WHERE action = ?';
      params.push(action);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const logs = await allQuery(sql, params);
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Hostel Blocks & Rooms
router.get('/blocks', async (req, res) => {
  try {
    const blocks = await allQuery(`
      SELECT b.*,
        (SELECT COUNT(*) FROM rooms r WHERE r.block_id = b.id) as room_count,
        (SELECT COUNT(*) FROM students s WHERE s.hostel_block = b.block_name AND s.is_active = 1) as resident_count
      FROM hostel_blocks b
    `);
    res.json({ success: true, blocks });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. Feedback Support Tickets
router.get('/feedback', async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `
      SELECT f.*, s.full_name, s.course, s.room_number, s.hostel_block
      FROM feedback_tickets f
      JOIN students s ON f.student_id = s.id
    `;
    const params = [];
    if (status) {
      sql += ' WHERE f.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY f.created_at DESC';

    const tickets = await allQuery(sql, params);
    res.json({ success: true, tickets });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/feedback/:id/resolve', async (req, res) => {
  try {
    const { resolution_note } = req.body;
    await runQuery(`
      UPDATE feedback_tickets
      SET status = 'RESOLVED', resolution_note = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [resolution_note || 'Resolved by administrator.', req.user.username, req.params.id]);

    await recordAuditEvent(req.user.id, req.user.username, 'RESOLVE_FEEDBACK', 'FEEDBACK', req.params.id, 'Resolved feedback ticket', req);

    res.json({ success: true, message: 'Ticket resolved successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
