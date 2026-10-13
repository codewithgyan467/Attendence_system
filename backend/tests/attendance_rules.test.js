const request = require('supertest');
const { app } = require('../src/server');
const { initDatabase, runQuery, getQuery } = require('../src/db/database');
const { v4: uuidv4 } = require('uuid');

let adminToken = '';
const TEST_STUDENT_ID = 'TEST-STUDENT-UUID-001';
const TEST_ROLL = 'TEST_ROLL_999';

beforeAll(async () => {
  await initDatabase();

  // Obtain admin token
  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ username: 'admin', password: 'Admin@12345' });
  adminToken = loginRes.body.token;

  // Insert test student if not present
  await runQuery(`DELETE FROM students WHERE roll_number = ?`, [TEST_ROLL]);
  await runQuery(`DELETE FROM users WHERE username = ?`, [TEST_ROLL]);

  const userId = uuidv4();
  await runQuery(`
    INSERT INTO users (id, username, email, password_hash, role, student_id, is_active)
    VALUES (?, ?, ?, 'testhash', 'STUDENT', ?, 1)
  `, [userId, TEST_ROLL, `${TEST_ROLL}@test.local`, TEST_STUDENT_ID]);

  await runQuery(`
    INSERT INTO students (
      id, user_id, roll_number, full_name, email, course, admission_year, semester,
      room_number, hostel_block, device_id, failed_attempts, is_flagged_forge, is_active
    ) VALUES (?, ?, ?, 'Test Automated Student', ?, 'B.Tech', 2024, 1, 'A-101', 'Block A', 'DEV-TEST-001', 0, 0, 1)
  `, [TEST_STUDENT_ID, userId, TEST_ROLL, `${TEST_ROLL}@test.local`]);
});

afterAll(async () => {
  await runQuery(`DELETE FROM attendance_challenges WHERE student_id = ?`, [TEST_STUDENT_ID]);
  await runQuery(`DELETE FROM attendance_records WHERE student_id = ?`, [TEST_STUDENT_ID]);
  await runQuery(`DELETE FROM security_audit_logs WHERE student_id = ?`, [TEST_STUDENT_ID]);
  await runQuery(`DELETE FROM students WHERE id = ?`, [TEST_STUDENT_ID]);
  await runQuery(`DELETE FROM users WHERE username = ?`, [TEST_ROLL]);
});

describe('Attendance Domain Rules & Fraud Security', () => {
  test('Out-of-range location request is rejected and records Strike 1', async () => {
    const res = await request(app)
      .post('/api/v1/attendance/verify-location')
      .send({
        roll_number: TEST_ROLL,
        latitude: 10.000000, // Very far away from hostel
        longitude: 10.000000,
        accuracy: 10,
        is_mock_location: false
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);

    const student = await getQuery(`SELECT failed_attempts, is_flagged_forge FROM students WHERE id = ?`, [TEST_STUDENT_ID]);
    expect(student.failed_attempts).toBe(1);
    expect(student.is_flagged_forge).toBe(0);
  });

  test('Reaching 3 out-of-range violations locks student account with 3-strike flag', async () => {
    // Strike 2
    await request(app)
      .post('/api/v1/attendance/verify-location')
      .send({ roll_number: TEST_ROLL, latitude: 10.0, longitude: 10.0 });

    // Strike 3
    const res3 = await request(app)
      .post('/api/v1/attendance/verify-location')
      .send({ roll_number: TEST_ROLL, latitude: 10.0, longitude: 10.0 });

    expect(res3.status).toBe(403);

    const student = await getQuery(`SELECT failed_attempts, is_flagged_forge FROM students WHERE id = ?`, [TEST_STUDENT_ID]);
    expect(student.failed_attempts).toBe(3);
    expect(student.is_flagged_forge).toBe(1);

    // 4th attempt should be blocked due to account lock
    const resBlocked = await request(app)
      .post('/api/v1/attendance/verify-location')
      .send({ roll_number: TEST_ROLL, latitude: 28.5450, longitude: 77.1926 });

    expect(resBlocked.status).toBe(403);
    expect(resBlocked.body.isLocked).toBe(true);
  });

  test('Admin strike reset clears student strikes and unlocks account with mandatory reason', async () => {
    const resetRes = await request(app)
      .post('/api/v1/admin/security/reset-strike')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        student_id: TEST_STUDENT_ID,
        reason: 'Automated hardware testing calibration confirmed.'
      });

    expect(resetRes.status).toBe(200);
    expect(resetRes.body.success).toBe(true);

    const student = await getQuery(`SELECT failed_attempts, is_flagged_forge FROM students WHERE id = ?`, [TEST_STUDENT_ID]);
    expect(student.failed_attempts).toBe(0);
    expect(student.is_flagged_forge).toBe(0);
  });

  test('Valid in-perimeter coordinates return single-use challenge token', async () => {
    // Fetch active geofence
    const geofence = await getQuery(`SELECT latitude, longitude FROM geofence_configs WHERE is_active = 1 LIMIT 1`);

    const res = await request(app)
      .post('/api/v1/attendance/verify-location')
      .send({
        roll_number: TEST_ROLL,
        latitude: geofence.latitude,
        longitude: geofence.longitude,
        accuracy: 5,
        is_mock_location: false
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sessionToken).toBeDefined();

    // Verify challenge token in database
    const challenge = await getQuery(`SELECT * FROM attendance_challenges WHERE challenge_token = ?`, [res.body.sessionToken]);
    expect(challenge).toBeDefined();
    expect(challenge.is_used).toBe(0);
  });

  test('Replay attack protection: Reusing an already used challenge token is rejected with 403', async () => {
    const fakeToken = uuidv4();
    const expiresAt = new Date(Date.now() + 300000).toISOString();

    // Insert an already used challenge token
    await runQuery(`
      INSERT INTO attendance_challenges (
        id, student_id, challenge_token, expires_at, is_used, verified_distance
      ) VALUES (?, ?, ?, ?, 1, 5.0)
    `, [uuidv4(), TEST_STUDENT_ID, fakeToken, expiresAt]);

    const replayRes = await request(app)
      .post('/api/v1/attendance/verify-face')
      .send({
        session_token: fakeToken,
        live_photo: 'data:image/jpeg;base64,mockdata'
      });

    expect(replayRes.status).toBe(403);
    expect(replayRes.body.error).toContain('already been used');
  });

  test('Duplicate attendance enforcement: Re-verifying location when marked today returns 400', async () => {
    const today = new Date().toISOString().split('T')[0];

    // Mark test student present for today
    await runQuery(`
      INSERT INTO attendance_records (
        id, student_id, roll_number, full_name, date, time_marked, status, verification_method
      ) VALUES (?, ?, ?, 'Test Automated Student', ?, '08:30:00', 'PRESENT', 'Biometric')
    `, [uuidv4(), TEST_STUDENT_ID, TEST_ROLL, today]);

    const res = await request(app)
      .post('/api/v1/attendance/verify-location')
      .send({
        roll_number: TEST_ROLL,
        latitude: 28.545,
        longitude: 77.192
      });

    expect(res.status).toBe(400);
    expect(res.body.isAlreadyPresent).toBe(true);
  });
});
