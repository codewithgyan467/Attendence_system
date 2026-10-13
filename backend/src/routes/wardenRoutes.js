const express = require('express');
const router = express.Router();
const { getQuery, allQuery, withTransaction } = require('../db/database');
const { requireAuth, requireRole, recordAuditEvent } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// Scoped access for Wardens and Admins
router.use(requireAuth, requireRole('WARDEN', 'ADMIN'));

// 1. Warden Overview (Hostel Blocks, Today's Presence/Absence, Exceptions)
router.get('/overview', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const blocks = await allQuery(`
      SELECT b.*,
        (SELECT COUNT(*) FROM students s WHERE s.hostel_block = b.block_name AND s.is_active = 1) as resident_count,
        (SELECT COUNT(*) FROM attendance_records a JOIN students s ON a.student_id = s.id WHERE s.hostel_block = b.block_name AND a.date = ? AND a.status = 'PRESENT') as present_today
      FROM hostel_blocks b
    `, [today]);

    const totalResidents = blocks.reduce((acc, b) => acc + (b.resident_count || 0), 0);
    const totalPresent = blocks.reduce((acc, b) => acc + (b.present_today || 0), 0);
    const totalAbsent = Math.max(0, totalResidents - totalPresent);

    const pendingCorrections = await getQuery(`SELECT COUNT(*) as count FROM attendance_corrections WHERE status = 'PENDING'`);
    const openTickets = await getQuery(`SELECT COUNT(*) as count FROM feedback_tickets WHERE status = 'OPEN'`);

    res.json({
      success: true,
      summary: {
        totalResidents,
        presentToday: totalPresent,
        absentToday: totalAbsent,
        pendingCorrections: pendingCorrections?.count || 0,
        openTickets: openTickets?.count || 0,
        date: today
      },
      blocks
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Exception Investigation (Students who failed location or missed attendance today)
router.get('/exceptions', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Students with strikes or flagged for forge
    const flaggedStudents = await allQuery(`
      SELECT id, roll_number, full_name, hostel_block, room_number, course, semester, failed_attempts, is_flagged_forge
      FROM students
      WHERE is_active = 1 AND (is_flagged_forge = 1 OR failed_attempts > 0)
      ORDER BY failed_attempts DESC
    `);

    // Absent students today
    const absentStudents = await allQuery(`
      SELECT s.id, s.roll_number, s.full_name, s.hostel_block, s.room_number, s.course, s.phone
      FROM students s
      WHERE s.is_active = 1 AND s.id NOT IN (
        SELECT student_id FROM attendance_records WHERE date = ? AND status IN ('PRESENT', 'EXCUSED')
      )
      ORDER BY s.hostel_block, s.room_number
    `, [today]);

    res.json({
      success: true,
      flaggedCount: flaggedStudents.length,
      absentCount: absentStudents.length,
      flaggedStudents,
      absentStudents
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Correction Requests Management
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
    const { decision, resolution_note } = req.body;
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
      await runQuery(`
        UPDATE attendance_corrections
        SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, resolution_note = ?
        WHERE id = ?
      `, [decision, req.user.username, resolution_note || '', correction.id]);

      if (decision === 'APPROVED') {
        const student = await getQuery(`SELECT * FROM students WHERE id = ?`, [correction.student_id]);
        const existingAtt = await getQuery(`SELECT id FROM attendance_records WHERE student_id = ? AND date = ?`, [correction.student_id, correction.date]);

        if (existingAtt) {
          await runQuery(`
            UPDATE attendance_records
            SET status = ?, is_override = 1, override_reason = ?, override_by = ?
            WHERE id = ?
          `, [correction.requested_status, `Warden approved: ${correction.reason}`, req.user.username, existingAtt.id]);
        } else {
          await runQuery(`
            INSERT INTO attendance_records (
              id, student_id, roll_number, full_name, date, time_marked, status, is_override, override_reason, override_by
            ) VALUES (?, ?, ?, ?, ?, CURRENT_TIME, ?, 1, ?, ?)
          `, [uuidv4(), correction.student_id, correction.roll_number, student.full_name, correction.date, correction.requested_status, `Warden approved: ${correction.reason}`, req.user.username]);
        }
      }
    });

    await recordAuditEvent(req.user.id, req.user.username, 'WARDEN_REVIEW_CORRECTION', 'CORRECTION', correction.id, `Warden ${decision} correction for ${correction.roll_number}`, req);

    res.json({ success: true, message: `Correction request marked as ${decision}.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Feedback & Facility Support
router.get('/feedback', async (req, res) => {
  try {
    const tickets = await allQuery(`
      SELECT f.*, s.full_name, s.course, s.room_number, s.hostel_block
      FROM feedback_tickets f
      JOIN students s ON f.student_id = s.id
      ORDER BY f.created_at DESC
    `);
    res.json({ success: true, tickets });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/feedback/:id/respond', async (req, res) => {
  try {
    const { status = 'RESOLVED', resolution_note } = req.body;
    await runQuery(`
      UPDATE feedback_tickets
      SET status = ?, resolution_note = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [status, resolution_note || '', req.user.username, req.params.id]);

    await recordAuditEvent(req.user.id, req.user.username, 'WARDEN_RESPOND_FEEDBACK', 'FEEDBACK', req.params.id, `Status updated to ${status}`, req);

    res.json({ success: true, message: 'Ticket updated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
