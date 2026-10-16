const request = require('supertest');
const { app } = require('../src/server');
const { initDatabase, runQuery, getQuery } = require('../src/db/database');
const { getAttendanceWindowStatus, formatTime12h, timeToMinutes } = require('../src/services/scheduleService');
const { v4: uuidv4 } = require('uuid');

let adminToken = '';

beforeAll(async () => {
  await initDatabase();

  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ username: 'admin', password: 'Admin@12345' });
  adminToken = loginRes.body.token;
});

describe('Schedule Service Unit Logic', () => {
  test('formatTime12h accurately formats 24h string to 12h', () => {
    expect(formatTime12h('19:00')).toBe('7:00 PM');
    expect(formatTime12h('19:30')).toBe('7:30 PM');
    expect(formatTime12h('09:15')).toBe('9:15 AM');
    expect(formatTime12h('00:00')).toBe('12:00 AM');
    expect(formatTime12h('12:00')).toBe('12:00 PM');
  });

  test('timeToMinutes computes correct minutes from midnight', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('01:30')).toBe(90);
    expect(timeToMinutes('19:00')).toBe(1140);
    expect(timeToMinutes('19:30')).toBe(1170);
  });

  test('getAttendanceWindowStatus evaluates default 7:00 PM to 7:30 PM window correctly', async () => {
    // During 19:15 (inside standard 19:00 - 19:30 window)
    const inside = await getAttendanceWindowStatus('2026-10-20', '19:15');
    expect(inside.isOpen).toBe(true);
    expect(inside.remainingMinutes).toBe(15);
    expect(inside.isHoliday).toBe(false);

    // Before 19:00 (e.g. 18:30)
    const before = await getAttendanceWindowStatus('2026-10-20', '18:30');
    expect(before.isOpen).toBe(false);
    expect(before.startsInMinutes).toBe(30);

    // After 19:30 (e.g. 20:00)
    const after = await getAttendanceWindowStatus('2026-10-20', '20:00');
    expect(after.isOpen).toBe(false);
    expect(after.isPastEnd).toBe(true);
  });

  test('Special Day feast delay override extends attendance window on that specific date', async () => {
    const overrideDate = '2026-10-25';
    // Clean any existing test override
    await runQuery(`DELETE FROM attendance_schedule_overrides WHERE override_date = ?`, [overrideDate]);

    await runQuery(`
      INSERT INTO attendance_schedule_overrides (id, override_date, title, start_time, end_time, is_holiday, notes, created_by)
      VALUES (?, ?, 'Diwali Feast Delay', '20:00', '21:30', 0, 'Delayed by 1 hour', 'Admin')
    `, [uuidv4(), overrideDate]);

    // At 19:15 on this date, standard window is not active because it is delayed to 20:00
    const at1915 = await getAttendanceWindowStatus(overrideDate, '19:15');
    expect(at1915.isOpen).toBe(false);
    expect(at1915.startTime).toBe('20:00');
    expect(at1915.endTime).toBe('21:30');
    expect(at1915.startsInMinutes).toBe(45);

    // At 20:30 on this date, the extended feast window is OPEN
    const at2030 = await getAttendanceWindowStatus(overrideDate, '20:30');
    expect(at2030.isOpen).toBe(true);
    expect(at2030.remainingMinutes).toBe(60);
    expect(at2030.title).toBe('Diwali Feast Delay');

    // Clean up
    await runQuery(`DELETE FROM attendance_schedule_overrides WHERE override_date = ?`, [overrideDate]);
  });

  test('Holiday override marks attendance as exempt/suspended for that entire day', async () => {
    const holidayDate = '2026-12-25';
    await runQuery(`DELETE FROM attendance_schedule_overrides WHERE override_date = ?`, [holidayDate]);

    await runQuery(`
      INSERT INTO attendance_schedule_overrides (id, override_date, title, is_holiday, notes, created_by)
      VALUES (?, ?, 'Christmas Campus Holiday', 1, 'Attendance Exempt', 'Admin')
    `, [uuidv4(), holidayDate]);

    const res = await getAttendanceWindowStatus(holidayDate, '19:15');
    expect(res.isOpen).toBe(false);
    expect(res.isHoliday).toBe(true);
    expect(res.title).toBe('Christmas Campus Holiday');

    await runQuery(`DELETE FROM attendance_schedule_overrides WHERE override_date = ?`, [holidayDate]);
  });
});

describe('Attendance Schedule Admin API Endpoints', () => {
  test('GET /api/v1/attendance/schedule returns current schedule status', async () => {
    const res = await request(app).get('/api/v1/attendance/schedule');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.schedule).toBeDefined();
  });

  test('GET and POST /api/v1/admin/attendance-schedule updates default hours', async () => {
    const getRes = await request(app)
      .get('/api/v1/admin/attendance-schedule')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.config).toBeDefined();

    // Update to 19:00 - 19:45
    const updateRes = await request(app)
      .post('/api/v1/admin/attendance-schedule')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        default_start_time: '19:00',
        default_end_time: '19:45',
        is_enabled: true,
        timezone: 'Asia/Kolkata'
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.success).toBe(true);

    // Restore to default 19:00 - 19:30
    await request(app)
      .post('/api/v1/admin/attendance-schedule')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        default_start_time: '19:00',
        default_end_time: '19:30',
        is_enabled: true,
        timezone: 'Asia/Kolkata'
      });
  });

  test('POST and DELETE /api/v1/admin/attendance-schedule/overrides', async () => {
    const testDate = '2026-11-14';
    const createRes = await request(app)
      .post('/api/v1/admin/attendance-schedule/overrides')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        override_date: testDate,
        title: 'Children Day Hostel Celebration',
        start_time: '20:15',
        end_time: '21:15',
        is_holiday: false,
        notes: 'Extended hours for cultural evening'
      });

    expect(createRes.status).toBe(200);
    expect(createRes.body.success).toBe(true);

    const override = await getQuery(`SELECT * FROM attendance_schedule_overrides WHERE override_date = ?`, [testDate]);
    expect(override).toBeDefined();
    expect(override.title).toBe('Children Day Hostel Celebration');

    // Delete override
    const delRes = await request(app)
      .delete(`/api/v1/admin/attendance-schedule/overrides/${override.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);
  });

  test('POST /api/v1/admin/attendance-schedule/upload-holidays bulk imports events', async () => {
    const holidaysPayload = [
      { date: '2026-08-15', title: 'Independence Day', is_holiday: 1, notes: 'National Holiday' },
      { date: '2026-10-02', title: 'Gandhi Jayanti', is_holiday: 1, notes: 'National Holiday' },
      { date: '2026-11-20', title: 'Hostel Annual Sports Fest', start_time: '20:30', end_time: '22:00', is_holiday: 0 }
    ];

    const res = await request(app)
      .post('/api/v1/admin/attendance-schedule/upload-holidays')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ holidays: holidaysPayload });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(3);

    // Clean up test rows
    await runQuery(`DELETE FROM attendance_schedule_overrides WHERE override_date IN ('2026-08-15', '2026-10-02', '2026-11-20')`);
  });
});

describe('Individual and Bulk Deletion Operations', () => {
  test('DELETE /admin/corrections single and clear all', async () => {
    const student = await getQuery(`SELECT id, roll_number FROM students LIMIT 1`);
    const testId = `CORR-TEST-${Date.now()}`;
    await runQuery(`
      INSERT INTO attendance_corrections (id, student_id, roll_number, date, original_status, requested_status, reason, status)
      VALUES (?, ?, ?, '2026-10-15', 'ABSENT', 'PRESENT', 'Medical checkup test', 'PENDING')
    `, [testId, student.id, student.roll_number]);

    // Single delete
    const singleDel = await request(app)
      .delete(`/api/v1/admin/corrections/${testId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(singleDel.status).toBe(200);
    expect(singleDel.body.success).toBe(true);

    const check = await getQuery(`SELECT id FROM attendance_corrections WHERE id = ?`, [testId]);
    expect(check).toBeNull();

    // Clear all test
    const clearRes = await request(app)
      .delete('/api/v1/admin/corrections?status=REJECTED')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(clearRes.status).toBe(200);
    expect(clearRes.body.success).toBe(true);
  });

  test('DELETE /admin/security/alerts single and clear all', async () => {
    const alertId = `ALERT-TEST-${Date.now()}`;
    await runQuery(`
      INSERT INTO security_audit_logs (id, roll_number, incident_type, calculated_distance, details)
      VALUES (?, 'TEST_ROLL', 'GPS_SPOOF_TEST', 150.0, 'Simulated mock location test')
    `, [alertId]);

    // Single delete
    const delRes = await request(app)
      .delete(`/api/v1/admin/security/alerts/${alertId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);

    const check = await getQuery(`SELECT id FROM security_audit_logs WHERE id = ?`, [alertId]);
    expect(check).toBeNull();
  });

  test('DELETE /admin/feedback single and clear all', async () => {
    const student = await getQuery(`SELECT id, roll_number FROM students LIMIT 1`);
    const ticketId = `TICKET-TEST-${Date.now()}`;
    await runQuery(`
      INSERT INTO feedback_tickets (id, student_id, roll_number, category, subject, message, status)
      VALUES (?, ?, ?, 'GENERAL', 'Test Subject', 'Test Message', 'OPEN')
    `, [ticketId, student.id, student.roll_number]);

    // Single delete
    const singleDel = await request(app)
      .delete(`/api/v1/admin/feedback/${ticketId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(singleDel.status).toBe(200);
    expect(singleDel.body.success).toBe(true);

    const check = await getQuery(`SELECT id FROM feedback_tickets WHERE id = ?`, [ticketId]);
    expect(check).toBeNull();
  });

  test('DELETE /admin/attendance single and date-filtered', async () => {
    const student = await getQuery(`SELECT id, roll_number, full_name FROM students LIMIT 1`);
    const attId = `ATT-TEST-${Date.now()}`;
    const testDate = '2026-09-01';

    await runQuery(`
      INSERT INTO attendance_records (id, student_id, roll_number, full_name, date, time_marked, status)
      VALUES (?, ?, ?, ?, ?, '19:15:00', 'PRESENT')
    `, [attId, student.id, student.roll_number, student.full_name, testDate]);

    // Delete single
    const singleDel = await request(app)
      .delete(`/api/v1/admin/attendance/${attId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(singleDel.status).toBe(200);
    expect(singleDel.body.success).toBe(true);

    // Delete by date
    const clearDate = await request(app)
      .delete(`/api/v1/admin/attendance?date=${testDate}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(clearDate.status).toBe(200);
    expect(clearDate.body.success).toBe(true);
  });
});
