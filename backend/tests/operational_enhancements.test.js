const request = require('supertest');
const { app } = require('../src/server');
const { runQuery, getQuery, performMaintenanceCheckpoint, initDatabase } = require('../src/db/database');
const { v4: uuidv4 } = require('uuid');

describe('Operational Enhancements & System Optimization Suite', () => {
  let wardenToken;
  let studentToken;
  let testUserId;
  let testStudentId;
  let testStudentRoll = 'MUSTER_TEST_01';

  beforeAll(async () => {
    await initDatabase();

    // Clean up any stale records first
    try {
      await runQuery(`DELETE FROM attendance_corrections WHERE roll_number = ?`, [testStudentRoll]);
      await runQuery(`DELETE FROM attendance_records WHERE roll_number = ?`, [testStudentRoll]);
      await runQuery(`DELETE FROM students WHERE roll_number = ?`, [testStudentRoll]);
      await runQuery(`DELETE FROM users WHERE username = ?`, [testStudentRoll]);
    } catch (_) {}

    // Obtain authentic admin/warden token via login
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'Admin@12345' });
    wardenToken = loginRes.body.token;

    // Create a student user and matching student record
    testUserId = uuidv4();
    testStudentId = uuidv4();

    await runQuery(`
      INSERT INTO users (id, username, password_hash, role, is_active)
      VALUES (?, ?, '$2b$10$abcdefghijklmnopqrstuv', 'STUDENT', 1)
    `, [testUserId, testStudentRoll]);

    await runQuery(`
      INSERT INTO students (
        id, user_id, roll_number, full_name, email, course, admission_year, semester, hostel_block, room_number, phone, whatsapp_no, device_id, is_active
      ) VALUES (?, ?, ?, 'Muster Test Resident', 'muster@hostel.edu', 'B.Tech CS', 2024, 4, 'Block A', '101', '+919876543299', '+919876543288', 'DEV-MUSTER-01', 1)
    `, [testStudentId, testUserId, testStudentRoll]);

    const { generateToken } = require('../src/middleware/auth');
    studentToken = generateToken({ id: testUserId, username: testStudentRoll, role: 'STUDENT', student_id: testStudentId });
  });

  afterAll(async () => {
    try {
      await runQuery(`DELETE FROM attendance_corrections WHERE student_id = ?`, [testStudentId]);
      await runQuery(`DELETE FROM attendance_records WHERE student_id = ?`, [testStudentId]);
      await runQuery(`DELETE FROM students WHERE id = ?`, [testStudentId]);
      await runQuery(`DELETE FROM users WHERE id = ?`, [testUserId]);
    } catch (_) {}
  });

  test('1. Automated Database Maintenance Checkpoint operates cleanly', async () => {
    const res = await performMaintenanceCheckpoint();
    expect(res.ok).toBe(true);
  });

  test('2. Student can request in-person physical verification (fallback for injuries/camera failure)', async () => {
    const res = await request(app)
      .post('/api/v1/attendance/request-physical-verification')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        student_id: testStudentId,
        roll_number: testStudentRoll,
        reason: 'Medical condition / facial bandage',
        notes: 'Resting in Room 101 with eye dressing'
      });

    if (res.statusCode !== 200) console.log('ERR4:', res.body);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.requestId).toBeDefined();

    // Verify correction request was logged in database
    const reqRow = await getQuery(`
      SELECT * FROM attendance_corrections WHERE id = ?
    `, [res.body.requestId]);

    expect(reqRow).toBeDefined();
    expect(reqRow.reason).toContain('[PHYSICAL_VERIFICATION]');
  });

  test('3. Warden can query pending physical in-person verifications', async () => {
    const res = await request(app)
      .get('/api/v1/warden/pending-physical-verifications')
      .set('Authorization', `Bearer ${wardenToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.pending)).toBe(true);
    const found = res.body.pending.find((p) => p.roll_number === testStudentRoll);
    expect(found).toBeDefined();
  });

  test('4. Warden can sign off on physical attendance in person', async () => {
    const res = await request(app)
      .post('/api/v1/warden/verify-physical-attendance')
      .set('Authorization', `Bearer ${wardenToken}`)
      .send({
        student_id: testStudentId,
        roll_number: testStudentRoll,
        notes: 'Warden physically checked room 101; confirmed resident present.'
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify student attendance record is now PRESENT with WARDEN_PHYSICAL_SIGN_OFF
    const record = await getQuery(`
      SELECT * FROM attendance_records WHERE student_id = ? ORDER BY created_at DESC LIMIT 1
    `, [testStudentId]);

    expect(record).toBeDefined();
    expect(record.status).toBe('PRESENT');
    expect(record.verification_method).toBe('WARDEN_PHYSICAL_SIGN_OFF');
  });

  test('5. Warden Emergency Evacuation Muster Desk returns real-time safety headcount', async () => {
    const res = await request(app)
      .get('/api/v1/warden/emergency-muster')
      .set('Authorization', `Bearer ${wardenToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary).toBeDefined();
    expect(res.body.summary.total_residents).toBeGreaterThan(0);
    expect(res.body.summary.verified_inside_count).toBeGreaterThan(0);
    expect(Array.isArray(res.body.verifiedInside)).toBe(true);
    expect(Array.isArray(res.body.missingUnaccounted)).toBe(true);

    // Our test student was verified in test 4, so they should be inside
    const inside = res.body.verifiedInside.find((s) => s.roll_number === testStudentRoll);
    expect(inside).toBeDefined();
    expect(inside.verification_method).toBe('WARDEN_PHYSICAL_SIGN_OFF');
  });
});
