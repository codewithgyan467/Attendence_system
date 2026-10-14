const request = require('supertest');
const { app } = require('../src/server');
const { runQuery, getQuery, initDatabase } = require('../src/db/database');
const { v4: uuidv4 } = require('uuid');

const bcrypt = require('bcryptjs');

describe('System Reverification & Desk Contract Tests', () => {
  let adminToken;
  let wardenToken;
  let studentToken;
  let testUserId;
  let testStudentId;
  const testRoll = 'TEST-REVERIFY-01';

  beforeAll(async () => {
    await initDatabase();

    // 1. Authenticate as Admin
    const adminRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'Admin@12345' });
    expect(adminRes.status).toBe(200);
    adminToken = adminRes.body.token;

    // 2. Authenticate as Warden
    const wardenRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'warden', password: 'Warden@12345' });
    expect(wardenRes.status).toBe(200);
    wardenToken = wardenRes.body.token;

    // 3. Setup test student
    testUserId = uuidv4();
    testStudentId = `HSTL-2026-${testRoll}`;

    const salt = await bcrypt.genSalt(10);
    const passHash = await bcrypt.hash('Student@12345', salt);

    await runQuery(`
      INSERT OR REPLACE INTO users (id, username, email, password_hash, role, student_id, is_active)
      VALUES (?, ?, ?, ?, 'STUDENT', ?, 1)
    `, [testUserId, testRoll, `${testRoll.toLowerCase()}@test.local`, passHash, testStudentId]);

    await runQuery(`
      INSERT OR REPLACE INTO students (
        id, user_id, roll_number, full_name, email, phone, course,
        admission_year, semester, room_number, hostel_block, device_id, is_active
      ) VALUES (?, ?, ?, 'Test Reverified Student', ?, '+919999900002', 'B.Tech CS', 2026, 1, 'B-301', 'Block B', 'DEV-REVERIFY-01', 1)
    `, [testStudentId, testUserId, testRoll, `${testRoll.toLowerCase()}@test.local`]);

    const studentLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: testRoll, password: 'Student@12345' });
    expect(studentLogin.status).toBe(200);
    studentToken = studentLogin.body.token;
  });

  afterAll(async () => {
    await runQuery(`DELETE FROM feedback_tickets WHERE student_id = ?`, [testStudentId]);
    await runQuery(`DELETE FROM attendance_corrections WHERE student_id = ?`, [testStudentId]);
    await runQuery(`DELETE FROM attendance_records WHERE student_id = ?`, [testStudentId]);
    await runQuery(`DELETE FROM students WHERE roll_number = ?`, [testRoll]);
    await runQuery(`DELETE FROM users WHERE username = ?`, [testRoll]);
  });

  describe('1. Geofence Configuration Contract', () => {
    it('supports facility_name alias and returns top-level coordinates', async () => {
      const getRes = await request(app)
        .get('/api/v1/admin/geofence')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.success).toBe(true);
      expect(getRes.body.latitude).toBeDefined();
      expect(getRes.body.longitude).toBeDefined();
      expect(getRes.body.facility_name).toBeDefined();

      const postRes = await request(app)
        .post('/api/v1/admin/geofence')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          facility_name: 'Main Campus Facility',
          latitude: 28.5355,
          longitude: 77.3910,
          radius_meters: 25.0
        });

      expect(postRes.status).toBe(200);
      expect(postRes.body.success).toBe(true);
      expect(postRes.body.facility_name).toBe('Main Campus Facility');
      expect(postRes.body.radius_meters).toBe(25.0);
    });
  });

  describe('2. Attendance Reports Contract', () => {
    it('returns aliases for roll_no, block_name, check_in_time, distance_meters', async () => {
      const today = new Date().toISOString().split('T')[0];
      await runQuery(`
        INSERT OR REPLACE INTO attendance_records (
          id, student_id, roll_number, full_name, date, time_marked, status, verified_distance
        ) VALUES (?, ?, ?, 'Test Reverified Student', ?, '21:05:00', 'PRESENT', 14.2)
      `, [uuidv4(), testStudentId, testRoll, today]);

      const res = await request(app)
        .get(`/api/v1/admin/reports?date=${today}&search=${testRoll}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.records.length).toBeGreaterThan(0);
      const rec = res.body.records[0];
      expect(rec.roll_no).toBe(testRoll);
      expect(rec.roll_number).toBe(testRoll);
      expect(rec.block_name).toBe('Block B');
      expect(rec.hostel_block).toBe('Block B');
      expect(rec.check_in_time).toBe('21:05:00');
      expect(rec.distance_meters).toBe(14.2);
    });
  });

  describe('3. Correction Request Desk Contract', () => {
    const targetDate = '2026-10-10';
    let correctionId;

    it('allows student to submit correction and admin desk to view with dual keys', async () => {
      const subRes = await request(app)
        .post('/api/v1/students/corrections')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          date: targetDate,
          requested_status: 'PRESENT',
          reason: 'Medical clinic visit documented with dispensary slip'
        });

      expect(subRes.status).toBe(200);
      expect(subRes.body.success).toBe(true);

      const deskRes = await request(app)
        .get('/api/v1/admin/corrections?status=PENDING')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deskRes.status).toBe(200);
      expect(deskRes.body.requests).toBeDefined();
      expect(deskRes.body.corrections).toBeDefined();

      const item = deskRes.body.corrections.find(c => c.roll_number === testRoll && c.date === targetDate);
      expect(item).toBeDefined();
      expect(item.roll_no).toBe(testRoll);
      correctionId = item.id;
    });

    it('processes review using frontend payload { status, review_notes }', async () => {
      const reviewRes = await request(app)
        .post(`/api/v1/admin/corrections/${correctionId}/review`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'APPROVED',
          review_notes: 'Approved based on certified dispensary note'
        });

      expect(reviewRes.status).toBe(200);
      expect(reviewRes.body.success).toBe(true);

      const attRecord = await getQuery(`SELECT * FROM attendance_records WHERE student_id = ? AND date = ?`, [testStudentId, targetDate]);
      expect(attRecord).toBeDefined();
      expect(attRecord.status).toBe('PRESENT');
      expect(attRecord.is_override).toBe(1);
    });
  });

  describe('4. Support Feedback Ticket Contract', () => {
    let ticketId;

    it('translates human category "Hostel Facilities" into DB ROOM constraint without error', async () => {
      const subRes = await request(app)
        .post('/api/v1/students/feedback')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          category: 'Hostel Facilities',
          subject: 'Bathroom tap maintenance on 3rd floor',
          message: 'Room B-301 adjacent bathroom tap is leaking continuously.'
        });

      expect(subRes.status).toBe(200);
      expect(subRes.body.success).toBe(true);
    });

    it('returns dual keys { tickets, feedback } to student and admin desks', async () => {
      const studRes = await request(app)
        .get('/api/v1/students/feedback')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(studRes.status).toBe(200);
      expect(studRes.body.tickets).toBeDefined();
      expect(studRes.body.feedback).toBeDefined();
      expect(studRes.body.feedback.length).toBeGreaterThan(0);

      const adminRes = await request(app)
        .get('/api/v1/admin/feedback?status=OPEN')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(adminRes.status).toBe(200);
      expect(adminRes.body.tickets).toBeDefined();
      expect(adminRes.body.feedback).toBeDefined();

      const ticket = adminRes.body.feedback.find(t => t.roll_number === testRoll);
      expect(ticket).toBeDefined();
      expect(ticket.roll_no).toBe(testRoll);
      ticketId = ticket.id;
    });

    it('resolves feedback using frontend payload { status, resolution_notes }', async () => {
      const resolveRes = await request(app)
        .post(`/api/v1/admin/feedback/${ticketId}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'RESOLVED',
          resolution_notes: 'Plumber repaired washer in 3rd floor bathroom.'
        });

      expect(resolveRes.status).toBe(200);
      expect(resolveRes.body.success).toBe(true);

      const ticket = await getQuery(`SELECT * FROM feedback_tickets WHERE id = ?`, [ticketId]);
      expect(ticket.status).toBe('RESOLVED');
      expect(ticket.resolution_note).toBe('Plumber repaired washer in 3rd floor bathroom.');
    });
  });

  describe('5. Audit Log Search Contract', () => {
    it('filters audit events by free text search query', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/audit-logs?search=${testRoll}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.logs.length).toBeGreaterThan(0);
      expect(res.body.logs[0].details).toContain(testRoll);
    });
  });
});
