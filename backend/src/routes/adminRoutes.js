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
const { runQuery, getQuery, allQuery, withTransaction, clearAllStudentData } = require('../db/database');
const { requireAuth, requireRole, recordAuditEvent } = require('../middleware/auth');
const { clearForgeFlag } = require('../services/fraudService');

const upload = multer({ dest: 'uploads/' });

// Base router authentication guard
router.use(requireAuth);

// 1. Executive Dashboard KPIs & Real Chart.js Datasets (Admin only)
router.get('/dashboard-stats', requireRole('ADMIN'), async (req, res) => {
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

    const parsedRows = records.map((row, idx) => ({
      index: idx + 1,
      roll_number: String(row.roll_number || row.rollNumber || row.RollNo || row['Roll Number'] || row['Roll No'] || row['roll_no'] || row['Roll'] || '').trim().toUpperCase(),
      full_name: String(row.full_name || row.fullName || row.Name || row['Student Name'] || row['Student'] || row['Full Name'] || '').trim(),
      room_number: String(row.room_number || row.roomNumber || row.Room || row['Room No'] || row['Room'] || 'A-101').trim(),
      hostel_block: String(row.hostel_block || row.block || row.Hostel || row['Hostel Block'] || row['Block'] || 'Block A').trim(),
      email: String(row.email || row.Email || row['Email ID'] || row['Email Address'] || row['Student Email'] || '').trim().toLowerCase(),
      phone: String(row.phone || row.Phone || row['Phone Number'] || row['Mobile'] || row['Mobile No'] || row['Contact'] || '').trim(),
      course: String(row.course || row.Course || row['Department'] || row['Branch'] || 'B.Tech Computer Science').trim(),
      admission_year: parseInt(row.admission_year || row.admissionYear || row.Year || row['Batch'] || new Date().getFullYear()) || new Date().getFullYear(),
      semester: parseInt(row.semester || row.Semester || row.Sem || 1) || 1
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
          const studentPhone = item.phone || '';
          const admYear = item.admission_year || new Date().getFullYear();
          const sem = item.semester || 1;
          const course = item.course || 'B.Tech Computer Science';
          const studentId = `HSTL-${admYear}-${item.roll_number.replace(/[^a-zA-Z0-9]/g, '')}`;

          await runQuery(`
            INSERT INTO hostel_allotments (
              id, roll_number, full_name, room_number, hostel_block,
              email, phone, course, admission_year, semester, is_registered
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            allotmentId, item.roll_number, item.full_name,
            item.room_number || 'A-101', item.hostel_block || 'Block A',
            studentEmail, studentPhone, course, admYear, sem,
            preCreateLogins ? 1 : 0
          ]);

          if (preCreateLogins) {
            const userId = uuidv4();
            await runQuery(`
              INSERT INTO users (id, username, email, password_hash, role, student_id, is_active, must_change_password)
              VALUES (?, ?, ?, ?, 'STUDENT', ?, 1, 0)
            `, [userId, item.roll_number, studentEmail, defaultStudentHash, studentId]);

            await runQuery(`
              INSERT INTO students (
                id, user_id, allotment_id, roll_number, full_name, email, phone,
                course, admission_year, semester, room_number, hostel_block,
                device_id, device_model, is_active
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            `, [
              studentId, userId, allotmentId, item.roll_number, item.full_name,
              studentEmail, studentPhone, course, admYear, sem,
              item.room_number || 'A-101', item.hostel_block || 'Block A',
              `DEV-${item.roll_number.toLowerCase()}`,
              'Pending Biometric Enrollment'
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
      'ROSTER_UPLOAD_COMMIT',
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
      course = 'B.Tech Computer Science',
      admission_year = new Date().getFullYear(),
      semester = 1,
      create_login = true,
      default_password = 'Student@12345'
    } = req.body;

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

    // Check if roll number already exists
    const existingAllotment = await getQuery(`SELECT id FROM hostel_allotments WHERE roll_number = ?`, [cleanRoll]);
    const existingStudent = await getQuery(`SELECT id FROM students WHERE roll_number = ?`, [cleanRoll]);

    if (existingAllotment || existingStudent) {
      return res.status(400).json({ success: false, error: `Student with roll number ${cleanRoll} already exists.` });
    }

    const allotmentId = uuidv4();
    const studentId = `HSTL-${admission_year}-${cleanRoll.replace(/[^a-zA-Z0-9]/g, '')}`;
    const userId = uuidv4();

    await withTransaction(async ({ runQuery }) => {
      // 1. Insert allotment record
      await runQuery(`
        INSERT INTO hostel_allotments (
          id, roll_number, full_name, room_number, hostel_block,
          email, phone, course, admission_year, semester, is_registered
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        allotmentId, cleanRoll, cleanName, room_number.trim(), hostel_block.trim(),
        cleanEmail, cleanPhone, course.trim(), parseInt(admission_year), parseInt(semester),
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
            device_id, device_model, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `, [
          studentId, userId, allotmentId, cleanRoll, cleanName, cleanEmail, cleanPhone,
          course.trim(), parseInt(admission_year), parseInt(semester),
          room_number.trim(), hostel_block.trim(),
          `DEV-${cleanRoll.toLowerCase()}`,
          'Pending Biometric Enrollment'
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

module.exports = router;

