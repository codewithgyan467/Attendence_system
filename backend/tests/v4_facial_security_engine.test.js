const request = require('supertest');
const { app } = require('../src/server');
const { runQuery, getQuery } = require('../src/db/database');
const { v4: uuidv4 } = require('uuid');

describe('HostelGuard Enterprise v4.0 - Advanced Facial Security & Anti-Spoofing Engine', () => {
  let testStudentId;
  let testRollNumber;

  beforeAll(async () => {
    testRollNumber = `V4TEST_${Date.now().toString().slice(-6)}`;
    testStudentId = `HSTL-2026-${testRollNumber}`;

    // Seed test student
    const defaultHash = '$2a$10$wT3wYf.K4gU3k8uW5K9v0O.5T1o4f8p1M9G7r7A7g0N5y5L5s5K9O';
    const userId = uuidv4();
    await runQuery(`
      INSERT INTO users (id, username, email, password_hash, role, student_id, is_active)
      VALUES (?, ?, ?, ?, 'STUDENT', ?, 1)
    `, [userId, testRollNumber, `${testRollNumber}@hostel.local`, defaultHash, testStudentId]);

    await runQuery(`
      INSERT INTO students (
        id, user_id, roll_number, full_name, email, course, admission_year, semester,
        hostel_block, room_number, device_id, is_active
      ) VALUES (?, ?, ?, 'V4 Security Test Student', ?, 'B.Tech IT', 2026, 4, 'Block A', 'A-101', 'DEV-V4-001', 1)
    `, [testStudentId, userId, testRollNumber, `${testRollNumber}@hostel.local`]);

    // Seed facial embedding
    const testVec = Array(128).fill(0.088);
    await runQuery(`
      INSERT INTO student_face_embeddings (id, student_id, angle_label, embedding_vector, quality_score, liveness_score)
      VALUES (?, ?, 'FRONT', ?, 1.0, 1.0)
    `, [uuidv4(), testStudentId, JSON.stringify(testVec)]);

    // Isolate geofence to STANDBY_OPTIONAL for pure facial security validation
    await runQuery(`UPDATE geofence_configs SET ble_mode = 'STANDBY_OPTIONAL' WHERE is_active = 1`);
  });

  afterAll(async () => {
    await runQuery(`UPDATE geofence_configs SET ble_mode = 'STRICT_REQUIRED' WHERE is_active = 1`);
    await runQuery(`DELETE FROM student_face_embeddings WHERE student_id = ?`, [testStudentId]);
    await runQuery(`DELETE FROM attendance_records WHERE roll_number = ?`, [testRollNumber]);
    await runQuery(`DELETE FROM attendance_challenges WHERE student_id = ?`, [testStudentId]);
    await runQuery(`DELETE FROM students WHERE id = ?`, [testStudentId]);
    await runQuery(`DELETE FROM users WHERE username = ?`, [testRollNumber]);
  });

  test('Step 1: Geofence verification issues server-generated active liveness challenge', async () => {
    const geo = await getQuery(`SELECT latitude, longitude FROM geofence_configs WHERE is_active = 1 LIMIT 1`);
    const res = await request(app)
      .post('/api/v1/attendance/verify-location')
      .send({
        roll_number: testRollNumber,
        latitude: geo.latitude,
        longitude: geo.longitude,
        accuracy: 10,
        device_id: 'DEV-V4-001'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.stepPassed).toBe(true);
    expect(res.body.challengeToken).toBeDefined();
    expect(res.body.activeChallenge).toBeDefined();
    expect(['HOLD_STILL', 'TURN_LEFT', 'TURN_RIGHT', 'NOD_DOWN']).toContain(res.body.activeChallenge);
    expect(res.body.activeChallengeInstruction).toBeDefined();

    // Verify persisted in attendance_challenges
    const saved = await getQuery(`SELECT * FROM attendance_challenges WHERE challenge_token = ?`, [res.body.challengeToken]);
    expect(saved).not.toBeNull();
    expect(saved.active_challenge).toBe(res.body.activeChallenge);
  });

  test('Step 2: Virtual camera drivers are rejected and logged in security audits', async () => {
    const geo = await getQuery(`SELECT latitude, longitude FROM geofence_configs WHERE is_active = 1 LIMIT 1`);
    const locRes = await request(app)
      .post('/api/v1/attendance/verify-location')
      .send({
        roll_number: testRollNumber,
        latitude: geo.latitude,
        longitude: geo.longitude,
        accuracy: 10,
        device_id: 'DEV-V4-001'
      });

    const token = locRes.body.challengeToken;
    const dummyPhoto = 'data:image/jpeg;base64,' + Buffer.from('fake-camera-frame').toString('base64');

    // Attempt verification with OBS Virtual Camera
    const res = await request(app)
      .post('/api/v1/attendance/verify-face')
      .set('x-test-virtual-cam', 'true')
      .send({
        session_token: token,
        live_photo: dummyPhoto,
        device_info: {
          cameraLabel: 'OBS Virtual Camera Driver v29.1',
          isVirtualCamera: true
        }
      });

    expect(res.status).toBe(403);
    expect(res.body.status).toBe('VIRTUAL_CAMERA_BLOCKED');
    expect(res.body.error).toMatch(/virtual camera/i);
  });

  test('Step 3: Verification with temporal multi-frame sequence commits attendance atomically', async () => {
    // Clean any prior attendance record for test student
    await runQuery(`DELETE FROM attendance_records WHERE student_id = ?`, [testStudentId]);

    const geo = await getQuery(`SELECT latitude, longitude FROM geofence_configs WHERE is_active = 1 LIMIT 1`);
    const locRes = await request(app)
      .post('/api/v1/attendance/verify-location')
      .send({
        roll_number: testRollNumber,
        latitude: geo.latitude,
        longitude: geo.longitude,
        accuracy: 10,
        device_id: 'DEV-V4-001'
      });

    const token = locRes.body.challengeToken;
    const dummyPhoto = 'data:image/jpeg;base64,' + Buffer.from('test-live-frame-1').toString('base64');
    const dummyBurst = [
      dummyPhoto,
      'data:image/jpeg;base64,' + Buffer.from('test-live-frame-2').toString('base64'),
      'data:image/jpeg;base64,' + Buffer.from('test-live-frame-3').toString('base64')
    ];

    const res = await request(app)
      .post('/api/v1/attendance/verify-face')
      .send({
        session_token: token,
        live_photo: dummyPhoto,
        temporal_frames: dummyBurst,
        device_info: {
          cameraLabel: 'Integrated Camera (04f2:b604)',
          isVirtualCamera: false
        }
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify challenge consumed (is_used = 1)
    const consumed = await getQuery(`SELECT is_used FROM attendance_challenges WHERE challenge_token = ?`, [token]);
    expect(consumed.is_used).toBe(1);

    // Verify attendance recorded
    const record = await getQuery(`SELECT * FROM attendance_records WHERE student_id = ? ORDER BY created_at DESC LIMIT 1`, [testStudentId]);
    expect(record).not.toBeNull();
    expect(record.status).toBe('PRESENT');
  });

  test('Step 4: Replay attack on consumed challenge token is blocked', async () => {
    const dummyPhoto = 'data:image/jpeg;base64,' + Buffer.from('test-live-frame-1').toString('base64');
    const challenges = await getQuery(`SELECT challenge_token FROM attendance_challenges WHERE student_id = ? AND is_used = 1 LIMIT 1`, [testStudentId]);

    const res = await request(app)
      .post('/api/v1/attendance/verify-face')
      .send({
        session_token: challenges.challenge_token,
        live_photo: dummyPhoto
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/already been used/i);
  });

  test('Step 5: Student onboarding OTP enforces max 5 failed attempts limit', async () => {
    const testOnboardRoll = `ONB_${Date.now().toString().slice(-5)}`;
    await runQuery(`
      INSERT INTO hostel_allotments (id, roll_number, full_name, room_number, hostel_block, phone, is_registered)
      VALUES (?, ?, 'OTP Throttle Student', 'A-201', 'Block A', '+919999988888', 0)
    `, [uuidv4(), testOnboardRoll]);

    // Send OTP
    await request(app)
      .post('/api/v1/students/onboarding/send-otp')
      .send({ roll_number: testOnboardRoll, method: 'PHONE', contact_override: '+919999988888' });

    // Submit 5 wrong OTPs
    for (let i = 0; i < 5; i++) {
      const wrongRes = await request(app)
        .post('/api/v1/students/onboarding/verify-otp')
        .send({ roll_number: testOnboardRoll, otp: '000000' });
      expect(wrongRes.status).toBe(400);
    }

    // 6th attempt should be rejected because attempts exceeded and OTP invalidated
    const lockedRes = await request(app)
      .post('/api/v1/students/onboarding/verify-otp')
      .send({ roll_number: testOnboardRoll, otp: '000000' });

    expect(lockedRes.status).toBe(400);
    expect(lockedRes.body.error).toMatch(/too many incorrect attempts/i);

    // Cleanup
    await runQuery(`DELETE FROM password_reset_otps WHERE identifier = ?`, [testOnboardRoll]);
    await runQuery(`DELETE FROM hostel_allotments WHERE roll_number = ?`, [testOnboardRoll]);
  });
});
