const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const mammoth = require('mammoth');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { runQuery, getQuery, allQuery, withTransaction, clearAllStudentData, checkDatabaseIntegrity } = require('../db/database');
const { requireAuth, requireRole, recordAuditEvent, revokeAllUserSessions } = require('../middleware/auth');
const { clearForgeFlag } = require('../services/fraudService');
const backupService = require('../services/backupService');
const aiServiceClient = require('../services/aiServiceClient');
const { getAttendanceWindowStatus, formatTime12h } = require('../services/scheduleService');
const { getIstTime12h, getIstDateString } = require('../utils/istTime');
const { createMasterRecoveryKey, getActiveRecoveryKeyMetadata } = require('../services/recoveryService');
const embeddingCache = require('../services/embeddingCache');
const bleBeaconService = require('../services/bleBeaconService');
const beaconCache = require('../services/beaconCache');
const { getAllStudentsAttendanceSummary } = require('../services/attendanceStatsService');

// Security Hardened Multer Configuration: 10MB limit and strict file format filter
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.csv', '.xlsx', '.xls', '.docx', '.doc'];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file format. Only Excel (.xlsx, .xls), CSV (.csv), or Word (.docx) files are supported.'));
    }
  }
});

// Formula Injection Defense: Neutralize CSV/Excel formula injection (DDE attacks)
function sanitizeFormulaInjection(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (/^[=+\-@\t\r]/.test(trimmed)) {
    return `'${trimmed}`;
  }
  return trimmed;
}

// Base router authentication guard
router.use(requireAuth);

// In-memory short TTL cache to make dashboard stats instantaneous
let adminDashboardCache = null;
let adminDashboardCacheExpiry = 0;
const DASHBOARD_CACHE_TTL_MS = 10000; // 10 seconds

function invalidateAdminDashboardCache() {
  adminDashboardCache = null;
  adminDashboardCacheExpiry = 0;
}

// 1. Executive Dashboard KPIs & Real Chart.js Datasets (Admin only)
router.get('/dashboard-stats', requireRole('ADMIN'), async (req, res) => {
  try {
    const now = Date.now();
    // Return cached metrics if within TTL and fresh query param is not requested
    if (adminDashboardCache && now < adminDashboardCacheExpiry && req.query.fresh !== 'true') {
      return res.json(adminDashboardCache);
    }

    const today = getIstDateString();

    // Build the 7-day trend date window
    const past7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = getIstDateString(d);
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
      past7Days.push({
        date: dateStr,
        day: dayName,
        present: 0,
        late: 0,
        absent: 0
      });
    }
    const startDate = past7Days[0].date;

    // Execute all database queries concurrently with Promise.all
    const [
      totalStudents,
      totalAllotted,
      todayStatusCounts,
      flaggedForgeRow,
      pendingCorrectionsRow,
      openTicketsRow,
      activeGeofence,
      trendRows,
      blockStats,
      recentActivity,
      recentAuditEvents,
      rawPresent,
      todayAbsent
    ] = await Promise.all([
      getQuery(`SELECT COUNT(*) as count FROM students WHERE is_active = 1`),
      getQuery(`SELECT COUNT(*) as count FROM hostel_allotments`),
      allQuery(`SELECT status, COUNT(*) as count FROM attendance_records WHERE date = ? GROUP BY status`, [today]),
      getQuery(`SELECT COUNT(*) as count FROM students WHERE is_flagged_forge = 1`),
      getQuery(`SELECT COUNT(*) as count FROM attendance_corrections WHERE status = 'PENDING'`),
      getQuery(`SELECT COUNT(*) as count FROM feedback_tickets WHERE status = 'OPEN'`),
      getQuery(`SELECT * FROM geofence_configs WHERE is_active = 1 LIMIT 1`),
      allQuery(`
        SELECT date, status, COUNT(*) as count
        FROM attendance_records
        WHERE date >= ? AND date <= ?
        GROUP BY date, status
      `, [startDate, today]),
      allQuery(`
        SELECT
          s.hostel_block as block,
          COUNT(s.id) as total_students,
          COUNT(a.id) as present_today
        FROM students s
        LEFT JOIN attendance_records a ON s.id = a.student_id AND a.date = ? AND a.status = 'PRESENT'
        WHERE s.is_active = 1 AND s.hostel_block IS NOT NULL
        GROUP BY s.hostel_block
      `, [today]),
      allQuery(`
        SELECT roll_number, full_name, date, time_marked, status, verified_distance
        FROM attendance_records
        ORDER BY created_at DESC
        LIMIT 10
      `),
      allQuery(`
        SELECT username, action, target_type, details, created_at
        FROM admin_audit_events
        ORDER BY created_at DESC
        LIMIT 8
      `),
      allQuery(`
        SELECT
          a.id AS attendance_id,
          a.student_id,
          a.roll_number,
          a.full_name,
          a.date,
          a.time_marked,
          a.status,
          a.verified_distance,
          a.is_override,
          a.override_reason,
          COALESCE(s.room_number, 'N/A') AS room_number,
          COALESCE(s.hostel_block, 'Block A') AS hostel_block,
          s.course,
          s.phone,
          s.email
        FROM attendance_records a
        LEFT JOIN students s ON a.student_id = s.id
        WHERE a.date = ? AND a.status IN ('PRESENT', 'LATE', 'EXCUSED')
        ORDER BY a.time_marked DESC
      `, [today]),
      allQuery(`
        SELECT
          s.id AS student_id,
          s.roll_number,
          s.full_name,
          COALESCE(s.room_number, 'N/A') AS room_number,
          COALESCE(s.hostel_block, 'Block A') AS hostel_block,
          s.course,
          s.phone,
          s.email,
          'ABSENT' AS status
        FROM students s
        WHERE s.is_active = 1
          AND NOT EXISTS (
            SELECT 1 FROM attendance_records a
            WHERE a.student_id = s.id
              AND a.date = ?
              AND a.status IN ('PRESENT', 'LATE', 'EXCUSED')
          )
        ORDER BY s.hostel_block ASC, s.room_number ASC, s.full_name ASC
      `, [today])
    ]);

    const totalReg = totalStudents?.count || 0;

    let presentCount = 0;
    let lateCount = 0;
    if (Array.isArray(todayStatusCounts)) {
      for (const row of todayStatusCounts) {
        if (row.status === 'PRESENT') presentCount = row.count || 0;
        else if (row.status === 'LATE') lateCount = row.count || 0;
      }
    }
    const absentCount = Math.max(0, totalReg - presentCount - lateCount);

    // Map trends by date and status
    const trendMap = {};
    if (Array.isArray(trendRows)) {
      for (const row of trendRows) {
        if (!trendMap[row.date]) trendMap[row.date] = {};
        trendMap[row.date][row.status] = row.count || 0;
      }
    }

    for (const dayItem of past7Days) {
      const stats = trendMap[dayItem.date] || {};
      dayItem.present = stats.PRESENT || 0;
      dayItem.late = stats.LATE || 0;
      dayItem.absent = Math.max(0, totalReg - dayItem.present - dayItem.late);
    }

    const todayPresent = rawPresent.map(p => ({
      ...p,
      time_marked_12: p.time_marked ? formatTime12h(p.time_marked) : 'N/A'
    }));

    const responsePayload = {
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
        blockDistribution: blockStats || []
      },
      todayPresent,
      todayAbsent,
      recentActivity: recentActivity || [],
      recentAuditEvents: recentAuditEvents || []
    };

    // Cache the payload in memory
    adminDashboardCache = responsePayload;
    adminDashboardCacheExpiry = now + DASHBOARD_CACHE_TTL_MS;

    res.json(responsePayload);
  } catch (err) {
    console.error('Dashboard Stats Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1b. Real-Time Daily Attendance Roster (Present & Absent lists for selected day)
router.get('/today-roster', requireRole('ADMIN'), async (req, res) => {
  try {
    const targetDate = req.query.date || getIstDateString();

    const [rawPresent, absent] = await Promise.all([
      allQuery(`
        SELECT
          a.id AS attendance_id,
          a.student_id,
          a.roll_number,
          a.full_name,
          a.date,
          a.time_marked,
          a.status,
          a.verified_distance,
          a.is_override,
          a.override_reason,
          COALESCE(s.room_number, 'N/A') AS room_number,
          COALESCE(s.hostel_block, 'Block A') AS hostel_block,
          s.course,
          s.phone,
          s.email
        FROM attendance_records a
        LEFT JOIN students s ON a.student_id = s.id
        WHERE a.date = ? AND a.status IN ('PRESENT', 'LATE', 'EXCUSED')
        ORDER BY a.time_marked DESC
      `, [targetDate]),
      allQuery(`
        SELECT
          s.id AS student_id,
          s.roll_number,
          s.full_name,
          COALESCE(s.room_number, 'N/A') AS room_number,
          COALESCE(s.hostel_block, 'Block A') AS hostel_block,
          s.course,
          s.phone,
          s.email,
          'ABSENT' AS status
        FROM students s
        WHERE s.is_active = 1
          AND NOT EXISTS (
            SELECT 1 FROM attendance_records a
            WHERE a.student_id = s.id
              AND a.date = ?
              AND a.status IN ('PRESENT', 'LATE', 'EXCUSED')
          )
        ORDER BY s.hostel_block ASC, s.room_number ASC, s.full_name ASC
      `, [targetDate])
    ]);

    const present = rawPresent.map(p => ({
      ...p,
      time_marked_12: p.time_marked ? formatTime12h(p.time_marked) : 'N/A'
    }));

    res.json({
      success: true,
      date: targetDate,
      summary: {
        presentCount: present.length,
        absentCount: absent.length,
        total: present.length + absent.length
      },
      present,
      absent
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Student Management CRUD (Search, Filter, Pagination)
router.get('/students', async (req, res) => {
  try {
    // Auto-sync any allotments that lack student records so they appear on the roster with 'Pending Biometric Enrollment'
    await runQuery(`
      INSERT OR IGNORE INTO students (
        id, user_id, allotment_id, roll_number, full_name, email, phone,
        course, admission_year, semester, room_number, hostel_block,
        branch, building, floor, remarks, date_of_entry, whatsapp_no,
        device_id, device_model, is_active
      )
      SELECT 
        'HSTL-' || COALESCE(admission_year, 2026) || '-' || REPLACE(roll_number, ' ', ''),
        NULL,
        id,
        roll_number,
        full_name,
        email,
        phone,
        COALESCE(course, 'BTech'),
        COALESCE(admission_year, 2026),
        COALESCE(semester, 1),
        COALESCE(room_number, 'A-101'),
        COALESCE(hostel_block, 'Block A'),
        branch,
        COALESCE(building, hostel_block, 'Block A'),
        floor,
        remarks,
        date_of_entry,
        COALESCE(whatsapp_no, phone),
        'DEV-' || LOWER(roll_number),
        'Pending Self-Enrollment & Face Activation',
        1
      FROM hostel_allotments a
      WHERE NOT EXISTS (SELECT 1 FROM students s WHERE s.roll_number = a.roll_number)
    `);

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
        (SELECT COUNT(*) FROM student_face_embeddings e WHERE e.student_id = s.id OR e.student_id = s.roll_number) as embeddings_count
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
    const {
      course, semester, room_number, hostel_block, phone, email, is_active,
      branch, building, floor, remarks, date_of_entry, whatsapp_no
    } = req.body;

    const student = await getQuery(`SELECT * FROM students WHERE id = ?`, [req.params.id]);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found.' });
    }

    const resolvedBlock = building || hostel_block || student.hostel_block;
    const resolvedPhone = whatsapp_no || phone || student.phone;

    await runQuery(`
      UPDATE students
      SET course = ?, semester = ?, room_number = ?, hostel_block = ?, phone = ?, email = ?, is_active = ?,
          branch = ?, building = ?, floor = ?, remarks = ?, date_of_entry = ?, whatsapp_no = ?
      WHERE id = ?
    `, [
      course || student.course,
      semester !== undefined ? parseInt(semester) : student.semester,
      room_number || student.room_number,
      resolvedBlock,
      resolvedPhone,
      email || student.email,
      is_active !== undefined ? (is_active ? 1 : 0) : student.is_active,
      branch !== undefined ? branch : student.branch,
      building !== undefined ? building : (student.building || resolvedBlock),
      floor !== undefined ? floor : student.floor,
      remarks !== undefined ? remarks : student.remarks,
      date_of_entry !== undefined ? date_of_entry : student.date_of_entry,
      whatsapp_no !== undefined ? whatsapp_no : (student.whatsapp_no || resolvedPhone),
      student.id
    ]);

    await recordAuditEvent(req.user.id, req.user.username, 'UPDATE_STUDENT', 'STUDENT', student.id, `Updated details for ${student.roll_number}`, req);

    res.json({ success: true, message: 'Student record updated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete Individual Student Record (When Student Leaves the Hostel)
router.delete('/students/:id', async (req, res) => {
  try {
    const studentIdentifier = req.params.id;

    // Check in students table first
    const student = await getQuery(
      `SELECT * FROM students WHERE id = ? OR roll_number = ?`,
      [studentIdentifier, studentIdentifier]
    );
    // Also check in hostel_allotments table
    const allotment = await getQuery(
      `SELECT * FROM hostel_allotments WHERE id = ? OR roll_number = ?`,
      [studentIdentifier, studentIdentifier]
    );

    if (!student && !allotment) {
      return res.status(404).json({ success: false, error: 'Student record not found.' });
    }

    const studentId = student ? student.id : null;
    const rollNumber = student ? student.roll_number : (allotment ? allotment.roll_number : studentIdentifier);
    let userId = student ? student.user_id : null;
    const studentName = student ? student.full_name : (allotment ? allotment.full_name : rollNumber);
    const allotmentId = student ? student.allotment_id : (allotment ? allotment.id : null);

    // If userId not found directly on student, look up user by username = rollNumber
    if (!userId && rollNumber) {
      const u = await getQuery(`SELECT id FROM users WHERE username = ?`, [rollNumber]);
      if (u) userId = u.id;
    }

    // Invalidate active user sessions immediately so credentials can no longer be used
    if (userId) {
      await revokeAllUserSessions(userId);
    }

    // Atomically remove all student records, biometric vectors, attendance, and logins
    await withTransaction(async ({ runQuery }) => {
      // 1. Delete corrections and records that have foreign keys
      if (studentId) {
        await runQuery(`DELETE FROM attendance_corrections WHERE student_id = ?`, [studentId]);
        await runQuery(`DELETE FROM attendance_records WHERE student_id = ?`, [studentId]);
        await runQuery(`DELETE FROM student_face_embeddings WHERE student_id = ?`, [studentId]);
        await runQuery(`DELETE FROM student_registered_devices WHERE student_id = ?`, [studentId]);
        await runQuery(`DELETE FROM attendance_challenges WHERE student_id = ?`, [studentId]);
        await runQuery(`DELETE FROM feedback_tickets WHERE student_id = ?`, [studentId]);
      }
      if (rollNumber) {
        await runQuery(`DELETE FROM attendance_corrections WHERE roll_number = ?`, [rollNumber]);
        await runQuery(`DELETE FROM attendance_records WHERE roll_number = ?`, [rollNumber]);
        await runQuery(`DELETE FROM password_reset_otps WHERE identifier = ?`, [rollNumber]);
        await runQuery(`DELETE FROM security_audit_logs WHERE roll_number = ?`, [rollNumber]);
        await runQuery(`DELETE FROM feedback_tickets WHERE roll_number = ?`, [rollNumber]);
      }
      if (userId) {
        await runQuery(`DELETE FROM password_reset_otps WHERE user_id = ?`, [userId]);
        await runQuery(`DELETE FROM security_audit_logs WHERE user_id = ?`, [userId]);
      }

      // 2. Delete Student profile
      if (studentId) {
        await runQuery(`DELETE FROM students WHERE id = ?`, [studentId]);
      }
      if (rollNumber) {
        await runQuery(`DELETE FROM students WHERE roll_number = ?`, [rollNumber]);
      }

      // 3. Delete Allotment record
      if (allotmentId) {
        await runQuery(`DELETE FROM hostel_allotments WHERE id = ?`, [allotmentId]);
      }
      if (rollNumber) {
        await runQuery(`DELETE FROM hostel_allotments WHERE roll_number = ?`, [rollNumber]);
      }

      // 4. Delete User login account
      if (userId) {
        await runQuery(`DELETE FROM users WHERE id = ?`, [userId]);
      }
      if (rollNumber) {
        await runQuery(`DELETE FROM users WHERE username = ? AND role = 'STUDENT'`, [rollNumber]);
      }
    });

    await recordAuditEvent(
      req.user.id,
      req.user.username,
      'DELETE_STUDENT_RECORD',
      'STUDENT',
      studentId || rollNumber,
      `Permanently deleted student ${studentName} (${rollNumber}) - Student vacated/left hostel`,
      req
    );

    res.json({
      success: true,
      message: `Student ${studentName} (${rollNumber}) has been successfully deleted from the hostel system.`
    });
  } catch (err) {
    console.error('Delete student failed:', err);
    res.status(500).json({ success: false, error: 'Failed to delete student: ' + err.message });
  }
});

// Helper: Multi-Format Roster Parser (Excel .xlsx/.xls, Word .docx/.doc, CSV .csv)
async function parseRosterFile(filePath, originalFilename = '') {
  const ext = path.extname(originalFilename || filePath).toLowerCase();
  let records = [];

  if (ext === '.xlsx' || ext === '.xls') {
    // 1. Microsoft Excel Workbook (.xlsx, .xls)
    const workbook = XLSX.readFile(filePath);
    const firstSheetName = workbook.SheetNames[0];
    if (firstSheetName) {
      const sheet = workbook.Sheets[firstSheetName];
      records = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    }
  } else if (ext === '.docx' || ext === '.doc') {
    // 2. Microsoft Word Document (.docx, .doc)
    try {
      const { value: rawText } = await mammoth.extractRawText({ path: filePath });
      const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      let headers = null;

      for (const line of lines) {
        // Delimiters supported: Tab, Comma, Pipe, Semicolon
        const parts = line.split(/[\t,|;]+/).map(p => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          const isHeader = parts.some(p => /roll/i.test(p)) || parts.some(p => /name/i.test(p));
          if (!headers && isHeader) {
            headers = parts.map(h => h.toLowerCase());
          } else if (headers) {
            const obj = {};
            parts.forEach((val, i) => {
              const h = headers[i] || `col_${i}`;
              obj[h] = val;
            });
            records.push(obj);
          } else {
            // Unstructured table line: assume [roll, name, room, block, email, phone]
            records.push({
              roll_number: parts[0] || '',
              full_name: parts[1] || '',
              room_number: parts[2] || 'A-101',
              hostel_block: parts[3] || 'Block A',
              email: parts[4] || '',
              phone: parts[5] || ''
            });
          }
        }
      }
    } catch (docxErr) {
      console.error('Word extraction error:', docxErr);
      throw new Error('Failed to parse Word document. Please ensure it contains readable student rows or tables: ' + docxErr.message);
    }
  } else {
    // 3. Comma Separated Values (CSV) or Delimited Text
    try {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      if (sheetName) {
        records = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
      }
    } catch (csvFallbackErr) {
      await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
          .pipe(csv())
          .on('data', (d) => records.push(d))
          .on('end', resolve)
          .on('error', reject);
      });
    }
  }

  return records;
}

// 3. Roster Upload Preview (Excel .xlsx/.xls, Word .docx/.doc, CSV .csv)
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
      records = await parseRosterFile(req.file.path, req.file.originalname);
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    } else {
      return res.status(400).json({
        success: false,
        error: 'Please upload an Excel (.xlsx, .xls), Word (.docx), or CSV file, or submit a records array.'
      });
    }

    if (!records || records.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid data rows found in the uploaded file. Please verify file content and structure.'
      });
    }

    const parsedRows = records.map((row, idx) => {
      const course = sanitizeFormulaInjection(String(row.Course || row.course || row.program || row.Department || 'BTech').trim());
      const semester = parseInt(row.Semester || row.semester || row.Sem || 1) || 1;
      const full_name = sanitizeFormulaInjection(String(row.Name || row.name || row['Full Name'] || row.full_name || row.fullName || row['Student Name'] || row.Student || '').trim());
      const branch = sanitizeFormulaInjection(String(row.Branch || row.branch || '').trim());
      const roll_number = sanitizeFormulaInjection(String(row.RollNo || row.Roll_No || row['Roll No'] || row['Roll Number'] || row.roll_number || row.rollNumber || row['roll_no'] || row.Roll || '').trim().toUpperCase());
      const building = sanitizeFormulaInjection(String(row.Building || row.building || row['Hostel Block'] || row.hostel_block || row.Block || row.block || 'Block A').trim());
      const floor = sanitizeFormulaInjection(String(row.Floor || row.floor || '').trim());
      const room_number = sanitizeFormulaInjection(String(row.RoomNo || row.Room_No || row['Room No'] || row['Room Number'] || row.room_number || row.roomNumber || row.Room || 'A-101').trim());
      const whatsapp_no = sanitizeFormulaInjection(String(row['WhatsApp No'] || row['WhatsApp'] || row['Whatsapp No'] || row['Whatsapp'] || row.whatsapp_no || row.phone || row.Phone || row['Phone Number'] || row.Mobile || row['Mobile No'] || '').trim());
      const email = sanitizeFormulaInjection(String(row['E-Mail'] || row['E-mail'] || row.Email || row['Email ID'] || row['Email Address'] || row['Student Email'] || row.email || '').trim().toLowerCase());
      const admission_year = parseInt(row['Admission Year'] || row.admission_year || row.admissionYear || row.Year || row.Batch || new Date().getFullYear()) || new Date().getFullYear();
      const remarks = sanitizeFormulaInjection(String(row.Remarks || row.remarks || row.Remark || row.remark || '').trim());
      const date_of_entry = sanitizeFormulaInjection(String(row['Date of Entry'] || row['Date Of Entry'] || row.date_of_entry || row.dateOfEntry || row['Entry Date'] || '').trim());

      return {
        index: idx + 1,
        course,
        semester,
        full_name,
        branch,
        roll_number,
        building,
        floor,
        room_number,
        whatsapp_no,
        phone: whatsapp_no,
        email,
        admission_year,
        remarks,
        date_of_entry,
        hostel_block: building
      };
    });

    const conflicts = [];
    const valid = [];
    const seenInFile = new Set();
    const seenEmailsInFile = new Set();

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

      if (r.email) {
        if (seenEmailsInFile.has(r.email)) {
          conflicts.push({ ...r, issue: `Duplicate email address "${r.email}" in uploaded file`, status: 'CONFLICT_ALREADY_EXISTS' });
          continue;
        }
        seenEmailsInFile.add(r.email);

        const existingEmailUser = await getQuery(`SELECT username FROM users WHERE LOWER(email) = LOWER(?)`, [r.email]);
        const existingEmailStudent = await getQuery(`SELECT roll_number FROM students WHERE LOWER(email) = LOWER(?)`, [r.email]);

        if (existingEmailUser || existingEmailStudent) {
          conflicts.push({ ...r, issue: `Email address "${r.email}" is already registered in the system`, status: 'CONFLICT_ALREADY_EXISTS' });
          continue;
        }
      }

      const existingAllotment = await getQuery(`SELECT roll_number FROM hostel_allotments WHERE roll_number = ?`, [r.roll_number]);
      const existingStudent = await getQuery(`SELECT roll_number FROM students WHERE roll_number = ?`, [r.roll_number]);

      if (existingAllotment || existingStudent) {
        conflicts.push({ ...r, issue: 'Roll number already exists on hostel roster', status: 'CONFLICT_ALREADY_EXISTS' });
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
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, error: 'File Preview Error: ' + err.message });
  }
});

// Commit Roster Allotments Atomically in a Transaction
router.post('/allotment/upload-commit', async (req, res) => {
  try {
    const { validRecords, preCreateLogins = false } = req.body;
    if (!validRecords || !Array.isArray(validRecords) || validRecords.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid records provided for commit.' });
    }

    const defaultStudentHash = await bcrypt.hash('Student@12345', 10);

    const inserted = await withTransaction(async ({ runQuery, getQuery }) => {
      let count = 0;
      for (const item of validRecords) {
        const existing = await getQuery(`SELECT id FROM hostel_allotments WHERE roll_number = ?`, [item.roll_number]);
        if (!existing) {
          const allotmentId = uuidv4();
          const studentEmail = item.email || `${item.roll_number.toLowerCase()}@student.hostel.local`;
          const studentPhone = item.phone || item.whatsapp_no || '';
          const admYear = item.admission_year || new Date().getFullYear();
          const sem = item.semester || 1;
          const course = item.course || 'BTech';
          const studentId = `HSTL-${admYear}-${item.roll_number.replace(/[^a-zA-Z0-9]/g, '')}`;
          const branch = item.branch || '';
          const building = item.building || item.hostel_block || 'Block A';
          const floor = item.floor || '';
          const remarks = item.remarks || '';
          const dateOfEntry = item.date_of_entry || '';
          const whatsappNo = item.whatsapp_no || studentPhone;

          await runQuery(`
            INSERT INTO hostel_allotments (
              id, roll_number, full_name, room_number, hostel_block,
              email, phone, course, admission_year, semester,
              branch, building, floor, remarks, date_of_entry, whatsapp_no,
              is_registered
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            allotmentId, item.roll_number, item.full_name,
            item.room_number || 'A-101', building,
            studentEmail, studentPhone, course, admYear, sem,
            branch, building, floor, remarks, dateOfEntry, whatsappNo,
            preCreateLogins ? 1 : 0
          ]);

          if (preCreateLogins) {
            let finalEmail = studentEmail;
            const emailInUse = await getQuery(`SELECT id FROM users WHERE LOWER(email) = LOWER(?)`, [finalEmail]);
            if (emailInUse) {
              finalEmail = `${item.roll_number.toLowerCase()}.${uuidv4().substring(0, 6)}@student.hostel.local`;
            }

            const existingUser = await getQuery(`SELECT id FROM users WHERE username = ?`, [item.roll_number]);
            const userId = existingUser ? existingUser.id : uuidv4();
            if (!existingUser) {
              await runQuery(`
                INSERT INTO users (id, username, email, password_hash, role, student_id, is_active, must_change_password)
                VALUES (?, ?, ?, ?, 'STUDENT', ?, 1, 0)
              `, [userId, item.roll_number, finalEmail, defaultStudentHash, studentId]);
            }

            await runQuery(`
              INSERT INTO students (
                id, user_id, allotment_id, roll_number, full_name, email, phone,
                course, admission_year, semester, room_number, hostel_block,
                branch, building, floor, remarks, date_of_entry, whatsapp_no,
                device_id, device_model, is_active
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            `, [
              studentId, userId, allotmentId, item.roll_number, item.full_name,
              finalEmail, studentPhone, course, admYear, sem,
              item.room_number || 'A-101', building,
              branch, building, floor, remarks, dateOfEntry, whatsappNo,
              `DEV-${item.roll_number.toLowerCase()}`,
              'Pending Biometric Enrollment'
            ]);
          } else {
            await runQuery(`
              INSERT INTO students (
                id, user_id, allotment_id, roll_number, full_name, email, phone,
                course, admission_year, semester, room_number, hostel_block,
                branch, building, floor, remarks, date_of_entry, whatsapp_no,
                device_id, device_model, is_active
              ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            `, [
              studentId, allotmentId, item.roll_number, item.full_name,
              studentEmail, studentPhone, course, admYear, sem,
              item.room_number || 'A-101', building,
              branch, building, floor, remarks, dateOfEntry, whatsappNo,
              `DEV-${item.roll_number.toLowerCase()}`,
              'Pending Self-Enrollment & Face Activation'
            ]);
          }

          count++;
        }
      }
      return count;
    });

    await recordAuditEvent(
      req.user.id,
      req.user.username,
      'ROSTER_CSV_COMMIT',
      'ALLOTMENT',
      null,
      `Imported ${inserted} students into hostel roster (Pre-create logins: ${preCreateLogins})`,
      req
    );

    res.json({
      success: true,
      message: `Successfully imported and activated ${inserted} student records!`,
      insertedCount: inserted,
      committedCount: inserted
    });
  } catch (err) {
    console.error('Upload commit failed:', err);
    const msg = String(err.message || '');
    if (msg.includes('UNIQUE constraint failed: users.email')) {
      return res.status(400).json({
        success: false,
        error: 'One or more records contain an email address that is already registered to an existing account. Please ensure all student emails are unique.'
      });
    }
    res.status(500).json({ success: false, error: 'Database transaction error: ' + err.message });
  }
});

// Manual Student Registration / Onboarding (Warden/Admin Form)
router.post('/students/manual-add', async (req, res) => {
  try {
    const {
      roll_number,
      full_name,
      room_number = 'A-101',
      hostel_block = 'Block A',
      email,
      phone,
      course = 'BTech',
      admission_year = new Date().getFullYear(),
      semester = 1,
      branch = '',
      building = '',
      floor = '',
      remarks = '',
      date_of_entry = '',
      whatsapp_no = '',
      create_login = true,
      default_password = 'Student@12345'
    } = req.body;

    const resolvedBlock = building.trim() || hostel_block.trim() || 'Block A';
    const resolvedPhone = whatsapp_no.trim() || phone.trim();

    if (!roll_number || !full_name) {
      return res.status(400).json({ success: false, error: 'Roll number and Full Name are required.' });
    }

    if (!email || !phone) {
      return res.status(400).json({ success: false, error: 'Student email and phone number are required for real OTP authentication.' });
    }

    const cleanRoll = roll_number.trim().toUpperCase();
    const cleanName = full_name.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();

    // 1. Check if roll number already exists in allotments or students
    const existingAllotment = await getQuery(`SELECT id FROM hostel_allotments WHERE roll_number = ?`, [cleanRoll]);
    const existingStudent = await getQuery(`SELECT id FROM students WHERE roll_number = ?`, [cleanRoll]);

    if (existingAllotment || existingStudent) {
      return res.status(400).json({ success: false, error: `Student with roll number "${cleanRoll}" is already registered on the hostel roster.` });
    }

    // 2. Pre-flight check: ensure username does not conflict with existing users
    const existingUsername = await getQuery(`SELECT username, role FROM users WHERE LOWER(username) = LOWER(?)`, [cleanRoll]);
    if (existingUsername) {
      return res.status(400).json({
        success: false,
        error: `A user account with roll number / username "${cleanRoll}" already exists (Role: ${existingUsername.role}). Please verify the roll number.`
      });
    }

    // 3. Pre-flight check: ensure email is not already in use by any user account (admin, warden, or student)
    const existingUserEmail = await getQuery(`SELECT username, role, email FROM users WHERE LOWER(email) = LOWER(?)`, [cleanEmail]);
    if (existingUserEmail) {
      return res.status(400).json({
        success: false,
        error: `The email "${cleanEmail}" is already registered to user account "${existingUserEmail.username}" (${existingUserEmail.role}). Each user must have a unique email address for OTP authentication and security.`
      });
    }

    // 4. Pre-flight check: ensure email is not already assigned to another student profile
    const existingStudentEmail = await getQuery(`SELECT roll_number, full_name FROM students WHERE LOWER(email) = LOWER(?)`, [cleanEmail]);
    if (existingStudentEmail) {
      return res.status(400).json({
        success: false,
        error: `The email "${cleanEmail}" is already assigned to student ${existingStudentEmail.full_name} (${existingStudentEmail.roll_number}). Please provide a distinct email address.`
      });
    }

    const allotmentId = uuidv4();
    const studentId = `HSTL-${admission_year}-${cleanRoll.replace(/[^a-zA-Z0-9]/g, '')}`;
    const userId = uuidv4();

    await withTransaction(async ({ runQuery }) => {
      // 1. Insert allotment record
      await runQuery(`
        INSERT INTO hostel_allotments (
          id, roll_number, full_name, room_number, hostel_block,
          email, phone, course, admission_year, semester,
          branch, building, floor, remarks, date_of_entry, whatsapp_no,
          is_registered
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        allotmentId, cleanRoll, cleanName, room_number.trim(), resolvedBlock,
        cleanEmail, resolvedPhone, course.trim(), parseInt(admission_year), parseInt(semester),
        branch.trim(), resolvedBlock, floor.trim(), remarks.trim(), date_of_entry.trim(), (whatsapp_no.trim() || resolvedPhone),
        create_login ? 1 : 0
      ]);

      // 2. Pre-create User & Student Profile if requested
      if (create_login) {
        const salt = await bcrypt.genSalt(10);
        const passHash = await bcrypt.hash(default_password, salt);

        await runQuery(`
          INSERT INTO users (id, username, email, password_hash, role, student_id, is_active, must_change_password)
          VALUES (?, ?, ?, ?, 'STUDENT', ?, 1, 0)
        `, [userId, cleanRoll, cleanEmail, passHash, studentId]);

        await runQuery(`
          INSERT INTO students (
            id, user_id, allotment_id, roll_number, full_name, email, phone,
            course, admission_year, semester, room_number, hostel_block,
            branch, building, floor, remarks, date_of_entry, whatsapp_no,
            device_id, device_model, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `, [
          studentId, userId, allotmentId, cleanRoll, cleanName, cleanEmail, resolvedPhone,
          course.trim(), parseInt(admission_year), parseInt(semester),
          room_number.trim(), resolvedBlock,
          branch.trim(), resolvedBlock, floor.trim(), remarks.trim(), date_of_entry.trim(), (whatsapp_no.trim() || resolvedPhone),
          `DEV-${cleanRoll.toLowerCase()}`,
          'Pending Biometric Enrollment'
        ]);
      } else {
        // Pre-create student profile without login account (user_id = null)
        await runQuery(`
          INSERT INTO students (
            id, user_id, allotment_id, roll_number, full_name, email, phone,
            course, admission_year, semester, room_number, hostel_block,
            branch, building, floor, remarks, date_of_entry, whatsapp_no,
            device_id, device_model, is_active
          ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `, [
          studentId, allotmentId, cleanRoll, cleanName, cleanEmail, resolvedPhone,
          course.trim(), parseInt(admission_year), parseInt(semester),
          room_number.trim(), resolvedBlock,
          branch.trim(), resolvedBlock, floor.trim(), remarks.trim(), date_of_entry.trim(), (whatsapp_no.trim() || resolvedPhone),
          `DEV-${cleanRoll.toLowerCase()}`,
          'Pending Self-Enrollment & Face Activation'
        ]);
      }
    });

    await recordAuditEvent(
      req.user.id,
      req.user.username,
      'MANUAL_ADD_STUDENT',
      'STUDENT',
      studentId,
      `Manually registered student ${cleanName} (${cleanRoll}) - Email: ${cleanEmail}, Phone: ${cleanPhone}`,
      req
    );

    res.json({
      success: true,
      message: `Student ${cleanName} (${cleanRoll}) added successfully!`,
      student: {
        id: studentId,
        roll_number: cleanRoll,
        full_name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        room_number: room_number.trim(),
        hostel_block: hostel_block.trim(),
        credentials: create_login ? {
          username: cleanRoll,
          default_password,
          reset_url: `/?mode=reset&user=${encodeURIComponent(cleanRoll)}`
        } : null
      }
    });
  } catch (err) {
    console.error('Manual student add failed:', err);
    const msg = String(err.message || '');
    if (msg.includes('UNIQUE constraint failed: users.email') || msg.includes('UNIQUE constraint failed: students.email')) {
      return res.status(400).json({
        success: false,
        error: `The email "${cleanEmail}" is already registered in the system. Each student must have a unique email address.`
      });
    }
    if (msg.includes('UNIQUE constraint failed: users.username') || msg.includes('UNIQUE constraint failed: students.roll_number') || msg.includes('UNIQUE constraint failed: hostel_allotments.roll_number')) {
      return res.status(400).json({
        success: false,
        error: `A student or user with roll number "${cleanRoll}" is already registered.`
      });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// Clear All Student Data (Fresh Slate)
router.post('/students/clear-all', async (req, res) => {
  try {
    await clearAllStudentData();
    await recordAuditEvent(
      req.user.id,
      req.user.username,
      'CLEAR_ALL_STUDENTS',
      'SYSTEM',
      null,
      'Wiped all student accounts, allotments, and biometric records for fresh production setup',
      req
    );
    res.json({
      success: true,
      message: 'All student accounts, roster allotments, and attendance data have been successfully cleared.'
    });
  } catch (err) {
    console.error('Failed to clear student data:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Geofence Configuration
router.get('/geofence', async (req, res) => {
  try {
    const config = await getQuery(`SELECT * FROM geofence_configs WHERE is_active = 1 LIMIT 1`);
    const activeConfig = config || {
      hostel_name: 'Aec hostel',
      latitude: 26.140462,
      longitude: 91.656606,
      radius_meters: 60.0
    };
    res.json({
      success: true,
      config: activeConfig,
      ...activeConfig,
      facility_name: activeConfig.hostel_name || 'Main Campus Facility'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/geofence', requireRole('ADMIN'), async (req, res) => {
  try {
    const { hostel_name, facility_name, latitude, longitude, radius_meters, reason } = req.body;
    const resolvedName = hostel_name || facility_name || 'Main Campus Facility';

    if (latitude === undefined || longitude === undefined || latitude === null || longitude === null) {
      return res.status(400).json({ success: false, error: 'Latitude and Longitude are required.' });
    }

    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    const rad = parseFloat(radius_meters);

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({
        success: false,
        error: 'Invalid coordinates: latitude must be between -90 and 90, longitude between -180 and 180.'
      });
    }

    if (isNaN(rad) || rad < 10 || rad > 150) {
      return res.status(400).json({
        success: false,
        error: `Invalid geofence radius (${radius_meters}m). Security policy mandates radius between 10.0m and 150.0m to prevent perimeter bypass.`
      });
    }

    const oldConfig = await getQuery(`SELECT * FROM geofence_configs WHERE is_active = 1 LIMIT 1`);

    if (oldConfig) {
      await runQuery(`
        UPDATE geofence_configs
        SET hostel_name = ?, latitude = ?, longitude = ?, radius_meters = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ?
        WHERE id = ?
      `, [resolvedName, lat, lon, rad, req.user.username, oldConfig.id]);
    } else {
      const newId = uuidv4();
      await runQuery(`
        INSERT INTO geofence_configs (id, hostel_name, latitude, longitude, radius_meters, is_active, updated_by)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `, [newId, resolvedName, lat, lon, rad, req.user.username]);
    }

    const updated = await getQuery(`SELECT * FROM geofence_configs WHERE is_active = 1 LIMIT 1`);

    const auditDetail = `Updated geofence from [${oldConfig?.latitude}, ${oldConfig?.longitude}, r=${oldConfig?.radius_meters}m] to [${lat}, ${lon}, r=${rad}m]. Reason: ${reason || 'Administrative update'}`;
    await recordAuditEvent(req.user.id, req.user.username, 'UPDATE_GEOFENCE', 'GEOFENCE', updated?.id || 'GEOFENCE-DEFAULT', auditDetail, req);

    res.json({
      success: true,
      message: 'Geofence configuration updated and audited successfully.',
      config: updated,
      ...updated,
      facility_name: updated?.hostel_name
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4b. ESP32 BLE Beacon & Physical Radio Anchor Configuration
router.get('/ble/config', requireRole('ADMIN'), async (req, res) => {
  try {
    const geo = await getQuery(`SELECT id, ble_mode FROM geofence_configs WHERE is_active = 1 LIMIT 1`);
    const beacons = await allQuery(`SELECT id, beacon_public_id, block_name, shared_secret_ref, is_active, last_seen_at, created_at, updated_at FROM site_ble_beacons ORDER BY block_name ASC`);
    res.json({
      success: true,
      ble_mode: geo?.ble_mode || 'STANDBY_OPTIONAL',
      beacons: beacons || []
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/ble/mode', requireRole('ADMIN'), async (req, res) => {
  try {
    const { ble_mode } = req.body;
    const allowed = ['STANDBY_OPTIONAL', 'SOFT_ANCHOR', 'STRICT_REQUIRED', 'STRICT_LOCK'];
    if (!allowed.includes(ble_mode)) {
      return res.status(400).json({ success: false, error: `Invalid ble_mode. Must be one of: ${allowed.join(', ')}` });
    }
    await runQuery(`UPDATE geofence_configs SET ble_mode = ?, updated_at = CURRENT_TIMESTAMP WHERE is_active = 1`, [ble_mode]);
    await recordAuditEvent(req.user.id, req.user.username, 'UPDATE_BLE_MODE', 'GEOFENCE', 'BLE_CONFIG', `Changed ESP32 BLE mode to ${ble_mode}`, req);
    res.json({ success: true, ble_mode, message: `BLE Radio Anchor mode switched to ${ble_mode}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4c. Strict Lock Localhost Vault & Cloud Sync Management (Warden Low-Spec Architecture)
router.get('/strict-vault/status', requireRole('ADMIN'), async (req, res) => {
  try {
    const localVaultDb = require('../config/localVaultDb');
    const status = await localVaultDb.getVaultStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/strict-vault/prepare-offline', requireRole('ADMIN'), async (req, res) => {
  try {
    const localVaultDb = require('../config/localVaultDb');
    const prepResult = await localVaultDb.prepareOfflineCache({ allQuery, getQuery });
    await recordAuditEvent(req.user.id, req.user.username, 'PREPARE_OFFLINE_VAULT', 'VAULT', 'LOCAL_SQLITE', 'Preloaded offline biometrics and beacon cache', req);
    res.json(prepResult);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/strict-vault/sync-to-cloud', requireRole('ADMIN'), async (req, res) => {
  try {
    const localVaultDb = require('../config/localVaultDb');
    const syncResult = await localVaultDb.syncVaultToCloud({ runQuery, getQuery, withTransaction });
    await recordAuditEvent(req.user.id, req.user.username, 'SYNC_OFFLINE_VAULT', 'VAULT', 'CLOUD_DB', `Synced ${syncResult.syncedAttendanceCount} attendance records to cloud`, req);
    res.json(syncResult);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/ble/generate-secret', requireRole('ADMIN'), async (req, res) => {
  try {
    const secret = bleBeaconService.generateBeaconSecret();
    res.json({ success: true, secret });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/ble/verify-token', requireRole('ADMIN'), async (req, res) => {
  try {
    const { beacon_public_id, rolling_code, slot } = req.body;
    const result = await bleBeaconService.verifyBleBeaconProof({
      beaconPublicId: beacon_public_id,
      rollingCode: rolling_code,
      timestampSlot: slot ? Number(slot) : null
    });
    res.json({ success: true, verification: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/ble/beacons', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id, beacon_public_id, block_name, shared_secret_ref, is_active = 1 } = req.body;
    if (!block_name && !beacon_public_id) {
      return res.status(400).json({ success: false, error: 'Floor/Wing Name is required.' });
    }

    // Auto-generate sequential beacon ID (e.g. FLR_0, FLR_1, FLR_2) if not specified
    let resolvedPublicId = beacon_public_id;
    if (!resolvedPublicId) {
      const countRow = await getQuery(`SELECT COUNT(*) as count FROM site_ble_beacons`);
      const nextNum = countRow?.count || 0;
      resolvedPublicId = `FLR_${nextNum}`;
    }

    const resolvedBlockName = block_name || resolvedPublicId;
    const secret = shared_secret_ref || bleBeaconService.generateBeaconSecret();
    const geo = await getQuery(`SELECT id FROM geofence_configs WHERE is_active = 1 LIMIT 1`);
    const geofenceId = geo?.id || null;

    let targetId = id;
    if (id) {
      await runQuery(`
        UPDATE site_ble_beacons
        SET beacon_public_id = ?, block_name = ?, shared_secret_ref = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [resolvedPublicId, resolvedBlockName, secret, is_active ? 1 : 0, id]);
      await recordAuditEvent(req.user.id, req.user.username, 'UPDATE_BLE_BEACON', 'BEACON', id, `Updated beacon ${resolvedPublicId} (${resolvedBlockName})`, req);
    } else {
      targetId = uuidv4();
      await runQuery(`
        INSERT INTO site_ble_beacons (id, geofence_id, beacon_public_id, shared_secret_ref, block_name, is_active)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [targetId, geofenceId, resolvedPublicId, secret, resolvedBlockName, is_active ? 1 : 0]);
      await recordAuditEvent(req.user.id, req.user.username, 'CREATE_BLE_BEACON', 'BEACON', targetId, `Registered new beacon ${resolvedPublicId} (${resolvedBlockName})`, req);
    }

    // Atomic In-Memory Cache Update (< 0.2ms write-through)
    beaconCache.set({
      id: targetId,
      geofence_id: geofenceId,
      beacon_public_id: resolvedPublicId,
      shared_secret_ref: secret,
      block_name: resolvedBlockName,
      is_active: is_active ? 1 : 0
    });

    res.json({
      success: true,
      message: 'Beacon saved and cached successfully',
      beacon: {
        id: targetId,
        beacon_public_id: resolvedPublicId,
        block_name: resolvedBlockName,
        shared_secret_ref: secret,
        is_active: is_active ? 1 : 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Toggle Beacon Kill Switch (Instant In-Memory & Database Deactivation)
router.post('/ble/beacons/:id/toggle', requireRole('ADMIN'), async (req, res) => {
  try {
    const beacon = await getQuery(`SELECT * FROM site_ble_beacons WHERE id = ?`, [req.params.id]);
    if (!beacon) {
      return res.status(404).json({ success: false, error: 'Beacon not found' });
    }
    const newActive = beacon.is_active === 1 ? 0 : 1;
    await runQuery(`UPDATE site_ble_beacons SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [newActive, req.params.id]);

    beacon.is_active = newActive;
    if (newActive === 1) {
      beaconCache.set(beacon);
    } else {
      beaconCache.deactivate(beacon.id);
    }

    await recordAuditEvent(req.user.id, req.user.username, 'TOGGLE_BLE_BEACON', 'BEACON', req.params.id, `Toggled beacon ${beacon.beacon_public_id} (${beacon.block_name}) active status to ${newActive}`, req);
    res.json({
      success: true,
      is_active: newActive,
      message: newActive ? 'Beacon activated and live in BeaconCache' : 'Beacon deactivated via Kill-Switch (Immediate Revocation)'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// One-Click Arduino Sketch Generator (.ino download for bare ESP32 Dev Module)
router.get('/ble/beacons/:id/sketch', requireRole('ADMIN'), async (req, res) => {
  try {
    const beacon = await getQuery(`SELECT * FROM site_ble_beacons WHERE id = ?`, [req.params.id]);
    if (!beacon) {
      return res.status(404).json({ success: false, error: 'Beacon not found' });
    }

    const sketch = `/**
 * ============================================================================
 * HOSTELGUARD ENTERPRISE v3.2: BARE ESP32 AIR-ANCHOR FIRMWARE
 * Floor/Wing:      ${beacon.block_name || 'Main Hostel'}
 * Target:          ESP32 Dev Module (Arduino IDE 2.3.10)
 * Partition:       Huge APP (3MB No OTA/1MB SPIFFS)
 * Zero Hardware:   Zero external RTC chip, zero external resistors
 * ============================================================================
 */

#include <WiFi.h>
#include <time.h>
#include <sys/time.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <mbedtls/md.h>

// ----------------------------------------------------------------------------
// 1. FLOOR PARAMETERS (Auto-configured by HostelGuard Admin)
// ----------------------------------------------------------------------------
const char* WIFI_SSID         = "HostelGuard_WiFi";
const char* WIFI_SSID_ALT     = "iPhone";
const char* WIFI_PASSWORD     = "Hostel@12345";

const char* BEACON_PUBLIC_ID  = "${beacon.beacon_public_id}";
const char* BEACON_NAME       = "${beacon.block_name || beacon.beacon_public_id}";
const char* SHARED_SECRET_HEX = "${beacon.shared_secret_ref}";

// BLE UUID Definitions
#define SERVICE_UUID              "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID       "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define TIME_SYNC_CHAR_UUID       "beb5483e-36e1-4688-b7f5-ea07361b26a9"
#define OFFLINE_SIGN_CHAR_UUID    "beb5483e-36e1-4688-b7f5-ea07361b26aa"

const char* NTP_SERVER        = "pool.ntp.org";
const long  GMT_OFFSET_SEC    = 19800; // +05:30 Asia/Kolkata
const int   DAYLIGHT_OFFSET   = 0;

BLEServer*         pServer = NULL;
BLECharacteristic* pRollingChar = NULL;
BLECharacteristic* pTimeSyncChar = NULL;
BLECharacteristic* pOfflineSignChar = NULL;

bool     deviceConnected = false;
uint32_t lastComputedSlot = 0;
String   currentRollingToken = "INIT0000";
unsigned long lastKeepAlivePulse = 0;

uint8_t hexPairToByte(char high, char low) {
  auto hexVal = [](char c) -> uint8_t {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return 0;
  };
  return (hexVal(high) << 4) | hexVal(low);
}

String computeHmacHex(const char* secretHex, const char* payload, int outLength) {
  uint8_t keyBytes[32];
  for (int i = 0; i < 32; i++) {
    keyBytes[i] = hexPairToByte(secretHex[i * 2], secretHex[i * 2 + 1]);
  }
  uint8_t hmacOutput[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  mbedtls_md_hmac_starts(&ctx, keyBytes, 32);
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)payload, strlen(payload));
  mbedtls_md_hmac_finish(&ctx, hmacOutput);
  mbedtls_md_free(&ctx);

  char hexBuf[65];
  for (int i = 0; i < 32; i++) {
    snprintf(&hexBuf[i * 2], 3, "%02X", hmacOutput[i]);
  }
  hexBuf[outLength] = '\0';
  return String(hexBuf);
}

class ServerCallbacks: public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    Serial.println("[BLE] Phone Connected to Floor Beacon: " + String(BEACON_NAME));
  }
  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    Serial.println("[BLE] Client Disconnected. Advertising...");
    pServer->startAdvertising();
  }
};

class TimeSyncCallbacks: public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pChar) {
    String val = pChar->getValue().c_str();
    if (val.length() > 0) {
      int sep = val.indexOf(':');
      if (sep > 0) {
        String epochStr = val.substring(0, sep);
        String hmacStr = val.substring(sep + 1);
        time_t epoch = (time_t)epochStr.toInt();
        String expected = computeHmacHex(SHARED_SECRET_HEX, ("TIMESYNC|" + String(BEACON_PUBLIC_ID) + "|" + epochStr).c_str(), 16);
        if (hmacStr.equalsIgnoreCase(expected)) {
          struct timeval tv = { epoch, 0 };
          settimeofday(&tv, NULL);
          Serial.printf("[GATT TIME RELAY] RTC Calibrated from Phone: %ld\n", epoch);
        }
      }
    }
  }
};

class OfflineSignCallbacks: public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pChar) {
    String val = pChar->getValue().c_str();
    if (val.startsWith("SIGN:")) {
      int firstSep = val.indexOf(':', 5);
      String imgHash = firstSep > 0 ? val.substring(5, firstSep) : val.substring(5);
      time_t now = time(nullptr);
      uint32_t slot = (uint32_t)(now / 30);
      String payload = imgHash + ":" + String(BEACON_PUBLIC_ID) + ":" + String(slot);
      String sig = computeHmacHex(SHARED_SECRET_HEX, payload.c_str(), 32);
      String response = String(BEACON_PUBLIC_ID) + ":" + String(slot) + ":" + sig;
      pChar->setValue((uint8_t*)response.c_str(), response.length());
      pChar->notify();
      Serial.printf("[OFFLINE SIGN] Signed frame hash for slot #%u\n", slot);
    }
  }
};

void keepPowerBankAwake() {
  if (millis() - lastKeepAlivePulse > 20000) {
    lastKeepAlivePulse = millis();
    volatile uint32_t dummy = 0;
    for (int i = 0; i < 200000; i++) dummy += i; // 100ms CPU current pulse
  }
}

void setup() {
  Serial.begin(9600);
  delay(1000);
  Serial.println("\n=======================================================");
  Serial.printf("  HOSTELGUARD v3.2 AIR-ANCHOR: %s (%s)\n", BEACON_NAME, BEACON_PUBLIC_ID);
  Serial.println("=======================================================");

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int retry = 0;
  while (WiFi.status() != WL_CONNECTED && retry < 16) {
    delay(500);
    Serial.print(".");
    retry++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET, NTP_SERVER);
    struct tm ti;
    if (getLocalTime(&ti)) {
      Serial.printf("\n[NTP SYNC OK] Current Time: %02d:%02d:%02d\n", ti.tm_hour, ti.tm_min, ti.tm_sec);
    }
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
  } else {
    Serial.println("\n[NTP Offline] Waiting for Web Bluetooth Phone Time Relay...");
  }

  BLEDevice::init(BEACON_PUBLIC_ID);
  BLEDevice::setPower(ESP_PWR_LVL_P9);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);

  pRollingChar = pService->createCharacteristic(
                   CHARACTERISTIC_UUID,
                   BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
                 );
  pRollingChar->addDescriptor(new BLE2902());

  pTimeSyncChar = pService->createCharacteristic(
                    TIME_SYNC_CHAR_UUID,
                    BLECharacteristic::PROPERTY_WRITE
                  );
  pTimeSyncChar->setCallbacks(new TimeSyncCallbacks());

  pOfflineSignChar = pService->createCharacteristic(
                       OFFLINE_SIGN_CHAR_UUID,
                       BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
                     );
  pOfflineSignChar->setCallbacks(new OfflineSignCallbacks());
  pOfflineSignChar->addDescriptor(new BLE2902());

  pService->start();

  BLEAdvertising* pAdv = BLEDevice::getAdvertising();
  pAdv->addServiceUUID(SERVICE_UUID);

  BLEAdvertisementData advData;
  advData.setName(BEACON_PUBLIC_ID);
  advData.setCompleteServices(BLEUUID(SERVICE_UUID));
  pAdv->setAdvertisementData(advData);

  BLEAdvertisementData scanData;
  scanData.setName(BEACON_NAME);
  pAdv->setScanResponseData(scanData);

  pAdv->setScanResponse(true);
  pAdv->setMinPreferred(0x06);
  pAdv->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("✅ Bare ESP32 Air-Anchor Active & Broadcasting!");
}

void loop() {
  keepPowerBankAwake();
  time_t now = time(nullptr);
  uint32_t currentSlot = (uint32_t)(now / 30);

  if (currentSlot != lastComputedSlot) {
    lastComputedSlot = currentSlot;
    char payload[64];
    snprintf(payload, sizeof(payload), "%s:%u", BEACON_PUBLIC_ID, currentSlot);
    currentRollingToken = computeHmacHex(SHARED_SECRET_HEX, payload, 8);

    char buffer[128];
    snprintf(buffer, sizeof(buffer), "{\"id\":\"%s\",\"code\":\"%s\",\"slot\":%u}",
             BEACON_PUBLIC_ID, currentRollingToken.c_str(), currentSlot);

    pRollingChar->setValue((uint8_t*)buffer, strlen(buffer));
    pRollingChar->notify();
    Serial.printf("[TICK] Slot #%u -> %s\n", currentSlot, currentRollingToken.c_str());
  }
  delay(1000);
}
`;

    const filename = `esp32_${(beacon.beacon_public_id || 'beacon').toLowerCase().replace(/[^a-z0-9_]/g, '_')}.ino`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(sketch);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/ble/beacons/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    beaconCache.delete(req.params.id);
    await runQuery(`DELETE FROM site_ble_beacons WHERE id = ?`, [req.params.id]);
    await recordAuditEvent(req.user.id, req.user.username, 'DELETE_BLE_BEACON', 'BEACON', req.params.id, `Deleted beacon ${req.params.id}`, req);
    res.json({ success: true, message: 'Beacon deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Attendance Reports & Export
// 4b. Monthly & Annual Roll Call Ledger across all hostel residents
router.get('/attendance-ledger', async (req, res) => {
  try {
    const year = req.query.year ? parseInt(req.query.year, 10) : null;
    const month = req.query.month ? parseInt(req.query.month, 10) : null;
    const ledger = await getAllStudentsAttendanceSummary(year, month);
    res.json({ success: true, ledger });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Attendance Reports & Export (includes recorded attendances and absent students without records)
router.get('/reports', async (req, res) => {
  try {
    const { date, block, status, search } = req.query;
    const targetDate = date || getIstDateString();
    const upperStatus = status ? status.trim().toUpperCase() : '';

    let recordedAttendances = [];

    // 1. Query attendance_records (for specific status or all recorded entries)
    if (upperStatus !== 'ABSENT') {
      let conditions = ['a.date = ?'];
      let params = [targetDate];

      if (upperStatus) {
        if (upperStatus === 'OVERRIDDEN') {
          conditions.push('(a.is_override = 1 OR a.status = ?)');
          params.push(upperStatus);
        } else {
          conditions.push('a.status = ?');
          params.push(upperStatus);
        }
      }

      if (block) {
        conditions.push('s.hostel_block = ?');
        params.push(block);
      }

      if (search) {
        conditions.push('(a.roll_number LIKE ? OR a.full_name LIKE ?)');
        params.push(`%${search.trim()}%`, `%${search.trim()}%`);
      }

      recordedAttendances = await allQuery(`
        SELECT
          a.*,
          a.id AS attendance_id,
          a.roll_number AS roll_no,
          a.time_marked AS check_in_time,
          a.verified_distance AS distance_meters,
          s.course,
          s.semester,
          s.room_number,
          COALESCE(s.hostel_block, 'Block A') AS hostel_block,
          COALESCE(s.hostel_block, 'Block A') AS block_name
        FROM attendance_records a
        LEFT JOIN students s ON a.student_id = s.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY a.time_marked DESC
      `, params);
    } else {
      // If filtering explicitly by ABSENT, check for records explicitly saved with status = 'ABSENT'
      let conditions = ['a.date = ?', "a.status = 'ABSENT'"];
      let params = [targetDate];

      if (block) {
        conditions.push('s.hostel_block = ?');
        params.push(block);
      }

      if (search) {
        conditions.push('(a.roll_number LIKE ? OR a.full_name LIKE ?)');
        params.push(`%${search.trim()}%`, `%${search.trim()}%`);
      }

      recordedAttendances = await allQuery(`
        SELECT
          a.*,
          a.id AS attendance_id,
          a.roll_number AS roll_no,
          a.time_marked AS check_in_time,
          a.verified_distance AS distance_meters,
          s.course,
          s.semester,
          s.room_number,
          COALESCE(s.hostel_block, 'Block A') AS hostel_block,
          COALESCE(s.hostel_block, 'Block A') AS block_name
        FROM attendance_records a
        LEFT JOIN students s ON a.student_id = s.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY a.time_marked DESC
      `, params);
    }

    // 2. Query active students who have NOT marked attendance on targetDate
    // This applies when status is empty ("All Statuses"), "ALL", or "ABSENT"
    let absentStudents = [];
    if (!upperStatus || upperStatus === 'ABSENT' || upperStatus === 'ALL') {
      let absentConditions = [
        's.is_active = 1',
        `NOT EXISTS (
          SELECT 1 FROM attendance_records a
          WHERE (a.student_id = s.id OR a.roll_number = s.roll_number)
            AND a.date = ?
        )`
      ];
      let absentParams = [targetDate];

      if (block) {
        absentConditions.push('s.hostel_block = ?');
        absentParams.push(block);
      }

      if (search) {
        absentConditions.push('(s.roll_number LIKE ? OR s.full_name LIKE ?)');
        absentParams.push(`%${search.trim()}%`, `%${search.trim()}%`);
      }

      const rawAbsent = await allQuery(`
        SELECT
          NULL AS id,
          NULL AS attendance_id,
          s.id AS student_id,
          s.roll_number,
          s.roll_number AS roll_no,
          s.full_name,
          ? AS date,
          NULL AS time_marked,
          NULL AS check_in_time,
          'ABSENT' AS status,
          NULL AS verified_distance,
          NULL AS distance_meters,
          'Not Marked' AS verification_method,
          0 AS is_override,
          NULL AS override_reason,
          NULL AS override_by,
          s.course,
          s.semester,
          s.room_number,
          COALESCE(s.hostel_block, 'Block A') AS hostel_block,
          COALESCE(s.hostel_block, 'Block A') AS block_name,
          s.phone,
          s.email
        FROM students s
        WHERE ${absentConditions.join(' AND ')}
        ORDER BY s.hostel_block ASC, s.room_number ASC, s.full_name ASC
      `, [targetDate, ...absentParams]);

      absentStudents = rawAbsent;
    }

    // Combine records: present/recorded attendances first, followed by un-marked absent students
    const records = [...recordedAttendances, ...absentStudents].map(r => ({
      ...r,
      time_marked_12: r.time_marked ? formatTime12h(r.time_marked) : (r.check_in_time ? formatTime12h(r.check_in_time) : null)
    }));

    // Compute global summary statistics for the targetDate
    const totalStudents = await getQuery(`SELECT COUNT(*) as count FROM students WHERE is_active = 1`);
    const presentToday = await getQuery(`SELECT COUNT(*) as count FROM attendance_records WHERE date = ? AND status IN ('PRESENT', 'LATE')`, [targetDate]);

    const totalCount = totalStudents?.count || 0;
    const presentCount = presentToday?.count || 0;
    const absentCount = Math.max(0, totalCount - presentCount);

    res.json({
      success: true,
      date: targetDate,
      summary: {
        totalRegistered: totalCount,
        present: presentCount,
        absent: absentCount
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
        SET status = ?, is_override = 1, override_reason = ?, override_by = ?, time_marked = ?
        WHERE id = ?
      `, [status, reason, req.user.username, getIstTime12h(), existingRecord.id]);
    } else {
      await runQuery(`
        INSERT INTO attendance_records (
          id, student_id, roll_number, full_name, date, time_marked, status, is_override, override_reason, override_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `, [uuidv4(), student.id, student.roll_number, student.full_name, date, getIstTime12h(), status, reason, req.user.username]);
    }

    await recordAuditEvent(req.user.id, req.user.username, 'ATTENDANCE_OVERRIDE', 'ATTENDANCE', student.id, `Overrode ${student.roll_number} on ${date} to ${status}: ${reason}`, req);

    res.json({ success: true, message: `Attendance updated to ${status} for ${student.full_name}.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE single attendance record
router.delete('/attendance/:id', async (req, res) => {
  try {
    const record = await getQuery('SELECT * FROM attendance_records WHERE id = ?', [req.params.id]);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Attendance record not found.' });
    }
    await runQuery('DELETE FROM attendance_records WHERE id = ?', [req.params.id]);
    await recordAuditEvent(req.user.id, req.user.username, 'DELETE_ATTENDANCE_RECORD', 'ATTENDANCE', record.id, `Deleted attendance for ${record.roll_number} on ${record.date}`, req);
    res.json({ success: true, message: `Attendance record for ${record.roll_number} (${record.date}) deleted successfully.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE all / date-filtered attendance records
router.delete('/attendance', async (req, res) => {
  try {
    const { date } = req.query;
    let sql = 'DELETE FROM attendance_records';
    const params = [];
    let logDetail = 'Cleared all historical attendance records across all dates';
    if (date && date !== 'all') {
      sql += ' WHERE date = ?';
      params.push(date);
      logDetail = `Cleared all attendance records for date ${date}`;
    }
    const result = await runQuery(sql, params);
    await recordAuditEvent(req.user.id, req.user.username, 'PURGE_ATTENDANCE_RECORDS', 'ATTENDANCE', date || 'ALL', logDetail, req);
    res.json({ success: true, message: `Successfully cleared attendance records. (${result.changes || 0} records deleted)` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Attendance Correction Requests Management
router.get('/corrections', async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `
      SELECT c.*, c.roll_number AS roll_no, c.resolution_note AS review_notes, s.full_name, s.course, s.semester, s.hostel_block, s.room_number
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
    res.json({ success: true, requests, corrections: requests });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/corrections/:id/review', async (req, res) => {
  try {
    const decision = req.body.decision || req.body.status; // 'APPROVED' or 'REJECTED'
    const resolution_note = req.body.resolution_note || req.body.review_notes || '';
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          `, [uuidv4(), correction.student_id, correction.roll_number, student.full_name, correction.date, getIstTime12h(), correction.requested_status, `Approved correction: ${correction.reason}`, req.user.username]);
        }
      }
    });

    await recordAuditEvent(req.user.id, req.user.username, 'REVIEW_CORRECTION', 'CORRECTION', correction.id, `${decision} correction for ${correction.roll_number} on ${correction.date}`, req);

    res.json({ success: true, message: `Correction request marked as ${decision}.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE single correction request
router.delete('/corrections/:id', async (req, res) => {
  try {
    const correction = await getQuery('SELECT * FROM attendance_corrections WHERE id = ?', [req.params.id]);
    if (!correction) {
      return res.status(404).json({ success: false, error: 'Correction request not found.' });
    }
    await runQuery('DELETE FROM attendance_corrections WHERE id = ?', [req.params.id]);
    await recordAuditEvent(req.user.id, req.user.username, 'DELETE_CORRECTION', 'CORRECTION', correction.id, `Deleted correction request #${correction.id} for ${correction.roll_number}`, req);
    res.json({ success: true, message: `Correction request #${correction.id} deleted successfully.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE all / status-filtered correction requests
router.delete('/corrections', async (req, res) => {
  try {
    const { status } = req.query;
    let sql = 'DELETE FROM attendance_corrections';
    const params = [];
    let logDetail = 'Cleared all attendance correction requests';
    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
      logDetail = `Cleared all ${status} attendance correction requests`;
    }
    const result = await runQuery(sql, params);
    await recordAuditEvent(req.user.id, req.user.username, 'PURGE_CORRECTIONS', 'CORRECTION', status || 'ALL', logDetail, req);
    res.json({ success: true, message: `Successfully cleared attendance correction requests. (${result.changes || 0} removed)` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Security Alerts & Strike Reset
router.get('/security/alerts', async (req, res) => {
  try {
    const rawAlerts = await allQuery(`
      SELECT 
        a.id,
        a.student_id,
        a.roll_number,
        a.incident_type,
        a.calculated_distance,
        a.details,
        a.ip_address,
        a.created_at,
        s.full_name,
        s.is_flagged_forge,
        s.failed_attempts
      FROM security_audit_logs a
      LEFT JOIN students s ON (a.student_id = s.id OR a.roll_number = s.roll_number)
      ORDER BY a.created_at DESC
      LIMIT 100
    `);

    const rawFlaggedStudents = await allQuery(`
      SELECT 
        s.id,
        s.roll_number,
        s.full_name,
        s.course,
        s.semester,
        s.hostel_block,
        s.room_number,
        s.failed_attempts,
        s.is_flagged_forge
      FROM students s
      WHERE s.is_flagged_forge = 1 OR s.failed_attempts > 0
      ORDER BY s.is_flagged_forge DESC, s.failed_attempts DESC
    `);

    // Normalized format supporting BOTH camelCase and snake_case
    const formattedStudents = rawFlaggedStudents.map(s => ({
      ...s,
      student_id: s.id,
      roll_no: s.roll_number,
      block_name: s.hostel_block || 'Hostel',
      strike_count: s.failed_attempts || 0,
      is_flagged: Boolean(s.is_flagged_forge === 1 || (s.failed_attempts || 0) >= 3)
    }));

    const formattedLogs = rawAlerts.map(a => ({
      ...a,
      event_type: a.incident_type,
      distance_meters: a.calculated_distance,
      student_name: a.full_name || (a.roll_number ? `Student ${a.roll_number}` : `Student ID: ${a.student_id}`),
      timestamp: a.created_at
    }));

    res.json({
      success: true,
      flaggedCount: formattedStudents.filter(s => s.is_flagged_forge === 1 || s.failed_attempts >= 3).length,
      flaggedStudents: formattedStudents,
      flagged_students: formattedStudents,
      recentAuditLogs: formattedLogs,
      recent_logs: formattedLogs,
      recent_evidence: await allQuery(`
        SELECT 
          e.id, e.challenge_id, e.student_id, e.decision_outcome, e.total_risk_score,
          e.assurance_tier, e.mock_flag_status, e.gps_sample_count, e.wifi_match_status,
          e.ble_match_status, e.play_integrity_verdict, e.unfair_means_flags,
          e.pad_photometric_pass, e.policy_version, e.created_at,
          s.roll_number, s.full_name
        FROM attendance_evidence e
        LEFT JOIN students s ON e.student_id = s.id
        ORDER BY e.created_at DESC LIMIT 100
      `),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1-Click Approve / Override Manual Review from Security Desk (v3.0)
router.post('/security/approve-manual-review', async (req, res) => {
  try {
    const { student_id, studentId, roll_number, rollNumber, evidence_id, reason = 'Warden verified legitimate hostel presence' } = req.body;
    const identifier = student_id || studentId || roll_number || rollNumber;
    if (!identifier) {
      return res.status(400).json({ success: false, error: 'Student identifier is required.' });
    }

    const student = await getQuery('SELECT * FROM students WHERE id = ? OR roll_number = ?', [identifier, identifier]);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found.' });
    }

    if (evidence_id) {
      await runQuery('UPDATE attendance_evidence SET decision_outcome = ? WHERE id = ?', ['ALLOW', evidence_id]);
    }

    await clearForgeFlag(student.id);
    await recordAuditEvent(
      req.user.id,
      req.user.username,
      'MANUAL_REVIEW_APPROVED',
      'STUDENT',
      student.id,
      'Manual review approved for ' + student.roll_number + ': ' + reason,
      req
    );

    res.json({ success: true, message: 'Manual review verified and approved for student ' + student.full_name + '. Strikes cleared and account active.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reset Strike Counter with Mandatory Reason and Audit Entry
router.post('/security/reset-strike', async (req, res) => {
  try {
    const { rollNumber, roll_number, student_id, studentId, id, reason } = req.body;
    const identifier = rollNumber || roll_number || student_id || studentId || id;
    if (!identifier) {
      return res.status(400).json({ success: false, error: 'Student identifier is required.' });
    }

    const student = await getQuery(`SELECT * FROM students WHERE roll_number = ? OR id = ?`, [identifier, identifier]);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found.' });
    }

    await clearForgeFlag(student.id);
    await recordAuditEvent(req.user.id, req.user.username, 'STRIKE_COUNTER_RESET', 'STUDENT', student.id, `Reset strikes for ${student.roll_number}: ${reason || 'Administrative clearance'}`, req);

    res.json({ success: true, message: `Successfully reset strike counter for student ${student.roll_number}. Account unlocked.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reset All Flagged Strikes (Emergency clearance for batch testing)
router.post('/security/reset-all-strikes', async (req, res) => {
  try {
    const { reason = 'Batch administrative strike clearance' } = req.body;
    await runQuery(`UPDATE students SET failed_attempts = 0, is_flagged_forge = 0 WHERE is_flagged_forge = 1 OR failed_attempts > 0`);
    await recordAuditEvent(req.user.id, req.user.username, 'BATCH_STRIKE_RESET', 'STUDENTS', 'ALL', reason, req);
    res.json({ success: true, message: 'All student forge strikes have been reset and accounts unlocked.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE single security incident alert
router.delete('/security/alerts/:id', async (req, res) => {
  try {
    const alert = await getQuery('SELECT * FROM security_audit_logs WHERE id = ?', [req.params.id]);
    if (!alert) {
      return res.status(404).json({ success: false, error: 'Security alert not found.' });
    }
    await runQuery('DELETE FROM security_audit_logs WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Security incident alert deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE all security alerts
router.delete('/security/alerts', async (req, res) => {
  try {
    const result = await runQuery('DELETE FROM security_audit_logs');
    await recordAuditEvent(req.user.id, req.user.username, 'PURGE_SECURITY_LOGS', 'SECURITY', 'ALL', 'Purged all security incident and spoofing logs', req);
    res.json({ success: true, message: `All security incident alerts cleared successfully. (${result.changes || 0} removed)` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Audit Logs Viewer
router.get('/audit-logs', async (req, res) => {
  try {
    const { action, search, limit = 50 } = req.query;
    let sql = 'SELECT * FROM admin_audit_events';
    const params = [];
    const conditions = [];

    if (action) {
      conditions.push('action = ?');
      params.push(action);
    }

    if (search && search.trim()) {
      conditions.push('(username LIKE ? OR action LIKE ? OR target_id LIKE ? OR details LIKE ?)');
      params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const logs = await allQuery(sql, params);
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE single audit log entry
router.delete('/audit-logs/:id', async (req, res) => {
  try {
    const log = await getQuery('SELECT * FROM admin_audit_events WHERE id = ?', [req.params.id]);
    if (!log) {
      return res.status(404).json({ success: false, error: 'Audit log entry not found.' });
    }
    await runQuery('DELETE FROM admin_audit_events WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Audit log entry deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE all audit logs
router.delete('/audit-logs', async (req, res) => {
  try {
    const result = await runQuery('DELETE FROM admin_audit_events');
    // Record fresh entry so there is an immutable marker that audit trail was cleared
    await recordAuditEvent(req.user.id, req.user.username, 'PURGE_AUDIT_LOGS', 'SYSTEM', 'ALL', 'Administrator cleared historical audit log trail.', req);
    res.json({ success: true, message: `All historical administrative audit logs cleared successfully. (${result.changes || 0} removed)` });
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
      SELECT f.*, f.roll_number AS roll_no, f.resolution_note AS admin_response, s.full_name, s.course, s.room_number, s.hostel_block
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
    res.json({ success: true, tickets, feedback: tickets });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/feedback/:id/resolve', async (req, res) => {
  try {
    const status = req.body.status || 'RESOLVED';
    const resolution_note = req.body.resolution_note || req.body.resolution_notes || req.body.note || 'Resolved by administrator.';
    await runQuery(`
      UPDATE feedback_tickets
      SET status = ?, resolution_note = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [status, resolution_note, req.user.username, req.params.id]);

    await recordAuditEvent(req.user.id, req.user.username, 'RESOLVE_FEEDBACK', 'FEEDBACK', req.params.id, `Resolved ticket: status=${status}`, req);

    res.json({ success: true, message: 'Ticket updated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE single feedback ticket
router.delete('/feedback/:id', async (req, res) => {
  try {
    const ticket = await getQuery('SELECT * FROM feedback_tickets WHERE id = ?', [req.params.id]);
    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Feedback ticket not found.' });
    }
    await runQuery('DELETE FROM feedback_tickets WHERE id = ?', [req.params.id]);
    await recordAuditEvent(req.user.id, req.user.username, 'DELETE_FEEDBACK', 'FEEDBACK', ticket.id, `Deleted feedback ticket #${ticket.id}`, req);
    res.json({ success: true, message: 'Feedback ticket deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE all / filtered feedback tickets
router.delete('/feedback', async (req, res) => {
  try {
    const { status } = req.query;
    let sql = 'DELETE FROM feedback_tickets';
    const params = [];
    let logDetail = 'Cleared all student support tickets';
    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
      logDetail = `Cleared all ${status} student support tickets`;
    }
    const result = await runQuery(sql, params);
    await recordAuditEvent(req.user.id, req.user.username, 'PURGE_FEEDBACK', 'FEEDBACK', status || 'ALL', logDetail, req);
    res.json({ success: true, message: `All feedback tickets cleared successfully. (${result.changes || 0} removed)` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10B. Attendance Schedule & Real-World Time Window Management
router.get('/attendance-schedule', async (req, res) => {
  try {
    const config = (await getQuery(`SELECT * FROM attendance_schedule_configs WHERE id = 'default_schedule' LIMIT 1`)) || {
      default_start_time: '19:00',
      default_end_time: '19:30',
      is_enabled: 1,
      timezone: 'Asia/Kolkata'
    };
    const liveStatus = await getAttendanceWindowStatus();
    const overrides = await allQuery(`
      SELECT * FROM attendance_schedule_overrides
      ORDER BY override_date DESC
    `);

    res.json({
      success: true,
      config,
      liveStatus,
      overrides: overrides.map(o => ({
        ...o,
        startTime12: o.start_time ? formatTime12h(o.start_time) : null,
        endTime12: o.end_time ? formatTime12h(o.end_time) : null
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/attendance-schedule', async (req, res) => {
  try {
    const { default_start_time, default_end_time, is_enabled, timezone } = req.body;

    const startTime = default_start_time || '19:00';
    const endTime = default_end_time || '19:30';
    const enabled = is_enabled !== undefined ? (is_enabled ? 1 : 0) : 1;
    const tz = timezone || 'Asia/Kolkata';

    await runQuery(`
      INSERT INTO attendance_schedule_configs (id, default_start_time, default_end_time, is_enabled, timezone, updated_at, updated_by)
      VALUES ('default_schedule', ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(id) DO UPDATE SET
        default_start_time = excluded.default_start_time,
        default_end_time = excluded.default_end_time,
        is_enabled = excluded.is_enabled,
        timezone = excluded.timezone,
        updated_at = CURRENT_TIMESTAMP,
        updated_by = excluded.updated_by
    `, [startTime, endTime, enabled, tz, req.user.username]);

    await recordAuditEvent(req.user.id, req.user.username, 'UPDATE_SCHEDULE_CONFIG', 'SCHEDULE', 'default_schedule', `Updated default schedule: ${startTime} - ${endTime} (${tz}), enabled=${enabled}`, req);

    const liveStatus = await getAttendanceWindowStatus();
    res.json({
      success: true,
      message: `Default attendance window successfully updated to ${formatTime12h(startTime)} – ${formatTime12h(endTime)}.`,
      liveStatus
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/attendance-schedule/overrides', async (req, res) => {
  try {
    const { override_date, title, start_time, end_time, is_holiday, notes } = req.body;

    if (!override_date || !title) {
      return res.status(400).json({ success: false, error: 'Override date (YYYY-MM-DD) and event title are required.' });
    }

    const isHoliday = is_holiday ? 1 : 0;
    const startTime = isHoliday ? null : (start_time || '19:00');
    const endTime = isHoliday ? null : (end_time || '19:30');

    const existing = await getQuery(`SELECT id FROM attendance_schedule_overrides WHERE override_date = ?`, [override_date]);
    if (existing) {
      await runQuery(`
        UPDATE attendance_schedule_overrides
        SET title = ?, start_time = ?, end_time = ?, is_holiday = ?, notes = ?, created_by = ?
        WHERE id = ?
      `, [title, startTime, endTime, isHoliday, notes || '', req.user.username, existing.id]);
    } else {
      await runQuery(`
        INSERT INTO attendance_schedule_overrides (id, override_date, title, start_time, end_time, is_holiday, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [uuidv4(), override_date, title, startTime, endTime, isHoliday, notes || '', req.user.username]);
    }

    await recordAuditEvent(req.user.id, req.user.username, 'SET_SCHEDULE_OVERRIDE', 'SCHEDULE', override_date, `${isHoliday ? 'Holiday' : `Extension (${startTime}-${endTime})`}: ${title}`, req);

    res.json({
      success: true,
      message: `Schedule override for ${override_date} (${title}) saved successfully.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/attendance-schedule/overrides/:id', async (req, res) => {
  try {
    const override = await getQuery(`SELECT * FROM attendance_schedule_overrides WHERE id = ?`, [req.params.id]);
    if (!override) {
      return res.status(404).json({ success: false, error: 'Schedule override not found.' });
    }
    await runQuery(`DELETE FROM attendance_schedule_overrides WHERE id = ?`, [req.params.id]);
    await recordAuditEvent(req.user.id, req.user.username, 'DELETE_SCHEDULE_OVERRIDE', 'SCHEDULE', override.override_date, `Removed override for ${override.override_date} (${override.title})`, req);

    res.json({ success: true, message: `Schedule override for ${override.override_date} deleted.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/attendance-schedule/upload-holidays', upload.single('file'), async (req, res) => {
  try {
    let rows = [];

    if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (ext === '.csv') {
        const fileContent = fs.readFileSync(req.file.path, 'utf8');
        const lines = fileContent.split(/\r?\n/).filter(l => l.trim().length > 0);
        if (lines.length > 1) {
          const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[\s_-]+/g, ''));
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
            const rowObj = {};
            header.forEach((h, idx) => {
              rowObj[h] = cols[idx] || '';
            });
            rows.push(rowObj);
          }
        }
      } else if (['.xlsx', '.xls'].includes(ext)) {
        const workbook = XLSX.readFile(req.file.path);
        const firstSheetName = workbook.SheetNames[0];
        rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName]);
      } else {
        const raw = fs.readFileSync(req.file.path, 'utf8');
        rows = JSON.parse(raw);
      }
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    } else if (req.body.holidays) {
      rows = typeof req.body.holidays === 'string' ? JSON.parse(req.body.holidays) : req.body.holidays;
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, error: 'No holiday/event records found in upload.' });
    }

    let insertedCount = 0;
    for (const r of rows) {
      const dateRaw = r.date || r.override_date || r.Date || r['Holiday Date'] || r['Event Date'] || '';
      const dateStr = String(dateRaw).trim().slice(0, 10);
      const title = String(r.title || r.Title || r.name || r['Holiday Name'] || r['Event Name'] || r.Reason || 'Campus Holiday').trim();
      const startTime = r.start_time || r.startTime || r['Start Time'] || null;
      const endTime = r.end_time || r.endTime || r['End Time'] || null;
      const isHoliday = (r.is_holiday !== undefined && r.is_holiday !== null) ? (String(r.is_holiday).toLowerCase() === 'true' || String(r.is_holiday) === '1' ? 1 : 0) : (startTime ? 0 : 1);
      const notes = r.notes || r.Notes || r.description || '';

      if (dateStr && dateStr.match(/^\d{4}-\d{2}-\d{2}$/) && title) {
        const existing = await getQuery(`SELECT id FROM attendance_schedule_overrides WHERE override_date = ?`, [dateStr]);
        if (existing) {
          await runQuery(`
            UPDATE attendance_schedule_overrides
            SET title = ?, start_time = ?, end_time = ?, is_holiday = ?, notes = ?, created_by = ?
            WHERE id = ?
          `, [title, startTime, endTime, isHoliday, notes, req.user.username, existing.id]);
        } else {
          await runQuery(`
            INSERT INTO attendance_schedule_overrides (id, override_date, title, start_time, end_time, is_holiday, notes, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, [uuidv4(), dateStr, title, startTime, endTime, isHoliday, notes, req.user.username]);
        }
        insertedCount++;
      }
    }

    await recordAuditEvent(req.user.id, req.user.username, 'BULK_IMPORT_HOLIDAYS', 'SCHEDULE', 'MULTIPLE', `Imported ${insertedCount} holiday/event schedule overrides`, req);

    res.json({
      success: true,
      count: insertedCount,
      message: `Successfully processed and imported ${insertedCount} holiday & event schedule overrides.`
    });
  } catch (err) {
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11. Complete System Credentials & Student Password Hub
router.get('/credentials-directory', async (req, res) => {
  try {
    // 1. Staff users
    const staff = await allQuery(`
      SELECT id, username, email, role, is_active, created_at
      FROM users
      WHERE role IN ('ADMIN', 'WARDEN')
      ORDER BY role ASC
    `);

    // 2. Student users and roster
    const students = await allQuery(`
      SELECT
        s.id as student_id,
        s.roll_number,
        s.full_name,
        s.email,
        s.phone,
        s.course,
        s.semester,
        s.room_number,
        s.hostel_block,
        s.is_active,
        s.device_id,
        u.id as user_id,
        u.username,
        u.must_change_password
      FROM students s
      LEFT JOIN users u ON (s.user_id = u.id OR s.roll_number = u.username)
      ORDER BY s.roll_number ASC
    `);

    // 3. Pre-allotted students not yet registered
    const pendingAllotments = await allQuery(`
      SELECT id, roll_number, full_name, room_number, hostel_block
      FROM hostel_allotments
      WHERE is_registered = 0
      ORDER BY roll_number ASC
    `);

    res.json({
      success: true,
      directory: {
        staff,
        students,
        pendingAllotments
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin One-Click Password Reset for Student
router.post('/students/:id/reset-password', async (req, res) => {
  try {
    const { new_password = 'Student@12345', reason = 'Admin initiated credential reset' } = req.body;

    const student = await getQuery(`SELECT * FROM students WHERE id = ? OR roll_number = ?`, [req.params.id, req.params.id]);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(new_password, salt);

    let user = await getQuery(`SELECT id FROM users WHERE id = ? OR username = ?`, [student.user_id, student.roll_number]);
    let userId = user?.id;

    if (userId) {
      await runQuery(`
        UPDATE users
        SET password_hash = ?, must_change_password = 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [hash, userId]);
    } else {
      userId = uuidv4();
      const email = student.email || `${student.roll_number.toLowerCase()}@student.hostel.local`;
      await runQuery(`
        INSERT INTO users (id, username, email, password_hash, role, student_id, is_active, must_change_password)
        VALUES (?, ?, ?, ?, 'STUDENT', ?, 1, 1)
      `, [userId, student.roll_number, email, hash, student.id]);

      await runQuery(`UPDATE students SET user_id = ? WHERE id = ?`, [userId, student.id]);
    }

    // Invalidate all active sessions for this student immediately
    await revokeAllUserSessions(userId);

    await recordAuditEvent(
      req.user.id,
      req.user.username,
      'ADMIN_RESET_STUDENT_PASSWORD',
      'STUDENT',
      student.id,
      `Password reset for student ${student.roll_number} (${reason})`,
      req
    );

    res.json({
      success: true,
      message: `Password for student ${student.roll_number} (${student.full_name}) has been reset successfully!`,
      newPassword: new_password,
      rollNumber: student.roll_number
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 12. SQLite Database Backup & Recovery Engine
router.post('/backup/create', requireRole('ADMIN'), async (req, res) => {
  try {
    const backupResult = await backupService.createBackup();
    await recordAuditEvent(
      req.user.id,
      req.user.username,
      'CREATE_DATABASE_BACKUP',
      'SYSTEM',
      null,
      `Created verified backup ${backupResult.backupFile} (${backupResult.sizeBytes} bytes)`,
      req
    );
    res.json({
      success: true,
      message: 'Database backup created and integrity verified successfully.',
      backup: backupResult
    });
  } catch (err) {
    console.error('Backup error:', err);
    res.status(500).json({ success: false, error: 'Backup failed: ' + err.message });
  }
});

router.get('/backup/list', requireRole('ADMIN'), async (req, res) => {
  try {
    const backups = backupService.listBackups();
    res.json({
      success: true,
      count: backups.length,
      backups
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/backup/restore', requireRole('ADMIN'), async (req, res) => {
  try {
    const { filename, confirmation } = req.body;
    if (!filename || confirmation !== 'CONFIRM_RESTORE') {
      return res.status(400).json({
        success: false,
        error: 'Confirmation required: provide "filename" and set confirmation to "CONFIRM_RESTORE".'
      });
    }

    const backupPath = path.join(backupService.BACKUP_DIR, path.basename(filename));
    const restoreResult = await backupService.restoreBackup(backupPath);

    await recordAuditEvent(
      req.user.id,
      req.user.username,
      'RESTORE_DATABASE',
      'SYSTEM',
      null,
      `Restored database from ${filename}`,
      req
    );

    res.json({
      success: true,
      message: 'Database restored successfully!',
      result: restoreResult
    });
  } catch (err) {
    console.error('Restore error:', err);
    res.status(500).json({ success: false, error: 'Database restore error: ' + err.message });
  }
});

// 13. System Health & Readiness Diagnostics
router.get('/system-health', requireRole('ADMIN'), async (req, res) => {
  try {
    const integrityStatus = await checkDatabaseIntegrity();
    const aiHealth = await aiServiceClient.checkHealth();
    const backups = backupService.listBackups();
    const lastBackup = backups[0] || null;

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      components: {
        backend: {
          status: 'HEALTHY',
          uptimeSeconds: Math.round(process.uptime()),
          nodeVersion: process.version
        },
        database: {
          status: integrityStatus === 'ok' ? 'HEALTHY' : 'WARNING',
          integrityCheck: integrityStatus
        },
        aiEngine: {
          status: aiHealth.ok ? 'HEALTHY' : 'DEGRADED',
          details: aiHealth.data || aiHealth.error
        },
        storage: {
          backupDirectory: backupService.BACKUP_DIR,
          totalBackups: backups.length,
          lastBackup
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 14. Administrator Security & Master Recovery Key Desk
router.get('/security/profile', requireRole('ADMIN'), async (req, res) => {
  try {
    const adminUser = await getQuery(`
      SELECT id, username, email, role, must_change_password, created_at, updated_at
      FROM users WHERE id = ?
    `, [req.user.id]);

    const recoveryMeta = await getActiveRecoveryKeyMetadata();

    res.json({
      success: true,
      user: {
        id: adminUser?.id || req.user.id,
        username: adminUser?.username || req.user.username,
        email: adminUser?.email || req.user.email,
        role: 'ADMIN',
        mustChangePassword: Boolean(adminUser?.must_change_password),
        createdAt: adminUser?.created_at,
        updatedAt: adminUser?.updated_at
      },
      recoveryKey: recoveryMeta ? {
        hint: recoveryMeta.key_hint,
        createdAt: recoveryMeta.created_at,
        isActive: Boolean(recoveryMeta.is_active)
      } : null
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/security/update-profile', requireRole('ADMIN'), async (req, res) => {
  try {
    const { username, email, current_password } = req.body;

    if (!username || !email || !current_password) {
      return res.status(400).json({ success: false, error: 'Username, email, and current password are required.' });
    }

    if (email.trim().toLowerCase().endsWith('@hostelguard.local')) {
      return res.status(400).json({ success: false, error: 'Please enter a valid official email address.' });
    }

    const user = await getQuery(`SELECT password_hash FROM users WHERE id = ?`, [req.user.id]);
    const isMatch = await bcrypt.compare(current_password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ success: false, error: 'Incorrect current password.' });
    }

    const conflict = await getQuery(`
      SELECT id FROM users
      WHERE (LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)) AND id != ?
    `, [username.trim(), email.trim(), req.user.id]);

    if (conflict) {
      return res.status(409).json({ success: false, error: 'Username or email is already taken by another account.' });
    }

    await runQuery(`
      UPDATE users
      SET username = ?, email = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [username.trim(), email.trim().toLowerCase(), req.user.id]);

    await recordAuditEvent(
      req.user.id,
      username.trim(),
      'ADMIN_PROFILE_UPDATE',
      'USER',
      req.user.id,
      `Administrator profile updated: username='${username.trim()}', email='${email.trim().toLowerCase()}'`,
      req
    );

    res.json({
      success: true,
      message: 'Administrator profile updated successfully.',
      user: {
        id: req.user.id,
        username: username.trim(),
        email: email.trim().toLowerCase(),
        role: 'ADMIN'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/security/regenerate-master-key', requireRole('ADMIN'), async (req, res) => {
  try {
    const { current_password } = req.body;
    if (!current_password) {
      return res.status(400).json({ success: false, error: 'Current password is required to generate a new Master Recovery Key.' });
    }

    const user = await getQuery(`SELECT password_hash FROM users WHERE id = ?`, [req.user.id]);
    const isMatch = await bcrypt.compare(current_password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ success: false, error: 'Incorrect current password.' });
    }

    const newKey = await createMasterRecoveryKey();

    await recordAuditEvent(
      req.user.id,
      req.user.username,
      'MASTER_KEY_REGENERATED',
      'SYSTEM',
      'MASTER_KEY',
      'Administrator regenerated the Emergency Master Recovery Key',
      req
    );

    res.json({
      success: true,
      message: 'New Emergency Master Recovery Key generated! Store it securely.',
      masterRecoveryKey: newKey
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

