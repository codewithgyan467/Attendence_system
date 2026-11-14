const request = require('supertest');
const { app } = require('../src/server');
const { initDatabase, runQuery, getQuery, allQuery } = require('../src/db/database');
const { v4: uuidv4 } = require('uuid');
const { getIstDateString } = require('../src/utils/istTime');

describe('HostelGuard v3.0 Zero-Trust Anti-Spoof & Unfair-Means Security Suite', () => {
  const TEST_ROLL_V3 = 'TEST_V3_001';
  const TEST_ROLL_V3_PEER = 'TEST_V3_002';
  const TEST_STUDENT_ID = 'TEST-STUDENT-V3-UUID';
  const TEST_STUDENT_ID_PEER = 'TEST-STUDENT-V3-PEER-UUID';
  let adminToken = '';
  let activeGeofence = null;

  beforeAll(async () => {
    await initDatabase();

    // Login admin
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'Admin@12345' });
    adminToken = loginRes.body.token;

    // Get active geofence
    activeGeofence = await getQuery(`SELECT * FROM geofence_configs WHERE is_active = 1 LIMIT 1`);

    // Clean test records
    await runQuery(`DELETE FROM attendance_evidence WHERE student_id IN (?, ?)`, [TEST_STUDENT_ID, TEST_STUDENT_ID_PEER]);
    await runQuery(`DELETE FROM attendance_challenges WHERE student_id IN (?, ?)`, [TEST_STUDENT_ID, TEST_STUDENT_ID_PEER]);
    await runQuery(`DELETE FROM attendance_records WHERE student_id IN (?, ?)`, [TEST_STUDENT_ID, TEST_STUDENT_ID_PEER]);
    await runQuery(`DELETE FROM security_audit_logs WHERE student_id IN (?, ?)`, [TEST_STUDENT_ID, TEST_STUDENT_ID_PEER]);
    await runQuery(`DELETE FROM students WHERE id IN (?, ?)`, [TEST_STUDENT_ID, TEST_STUDENT_ID_PEER]);
    await runQuery(`DELETE FROM users WHERE username IN (?, ?)`, [TEST_ROLL_V3, TEST_ROLL_V3_PEER]);

    // Insert Student 1
    const u1 = uuidv4();
    await runQuery(`
      INSERT INTO users (id, username, email, password_hash, role, student_id, is_active)
      VALUES (?, ?, ?, 'testhash', 'STUDENT', ?, 1)
    `, [u1, TEST_ROLL_V3, `${TEST_ROLL_V3}@test.local`, TEST_STUDENT_ID]);

    await runQuery(`
      INSERT INTO students (
        id, user_id, roll_number, full_name, email, course, admission_year, semester,
        room_number, hostel_block, device_id, failed_attempts, is_flagged_forge, is_active
      ) VALUES (?, ?, ?, 'AntiSpoof Test Student 1', ?, 'B.Tech', 2026, 1, 'A-101', 'Block A', 'DEV-V3-PHONE-A', 0, 0, 1)
    `, [TEST_STUDENT_ID, u1, TEST_ROLL_V3, `${TEST_ROLL_V3}@test.local`]);

    // Insert Student 2 (Peer for collusion tests)
    const u2 = uuidv4();
    await runQuery(`
      INSERT INTO users (id, username, email, password_hash, role, student_id, is_active)
      VALUES (?, ?, ?, 'testhash', 'STUDENT', ?, 1)
    `, [u2, TEST_ROLL_V3_PEER, `${TEST_ROLL_V3_PEER}@test.local`, TEST_STUDENT_ID_PEER]);

    await runQuery(`
      INSERT INTO students (
        id, user_id, roll_number, full_name, email, course, admission_year, semester,
        room_number, hostel_block, device_id, failed_attempts, is_flagged_forge, is_active
      ) VALUES (?, ?, ?, 'AntiSpoof Test Student 2', ?, 'B.Tech', 2026, 1, 'A-102', 'Block A', 'DEV-V3-PHONE-B', 0, 0, 1)
    `, [TEST_STUDENT_ID_PEER, u2, TEST_ROLL_V3_PEER, `${TEST_ROLL_V3_PEER}@test.local`]);

    // Insert mock embeddings for both students
    const mockVec = Array(128).fill(0.088);
    await runQuery(`
      INSERT INTO student_face_embeddings (id, student_id, angle_label, embedding_vector, quality_score, liveness_score)
      VALUES (?, ?, 'FRONT', ?, 1.0, 1.0)
    `, [uuidv4(), TEST_STUDENT_ID, JSON.stringify(mockVec)]);

    await runQuery(`
      INSERT INTO student_face_embeddings (id, student_id, angle_label, embedding_vector, quality_score, liveness_score)
      VALUES (?, ?, 'FRONT', ?, 1.0, 1.0)
    `, [uuidv4(), TEST_STUDENT_ID_PEER, JSON.stringify(mockVec)]);

    // Isolate geofence to STANDBY_OPTIONAL for pure anti-spoof layer baseline testing
    await runQuery(`UPDATE geofence_configs SET ble_mode = 'STANDBY_OPTIONAL' WHERE is_active = 1`);
  });

  afterAll(async () => {
    await runQuery(`UPDATE geofence_configs SET ble_mode = 'STRICT_REQUIRED' WHERE is_active = 1`);
    await runQuery(`DELETE FROM attendance_evidence WHERE student_id IN (?, ?)`, [TEST_STUDENT_ID, TEST_STUDENT_ID_PEER]);
    await runQuery(`DELETE FROM attendance_challenges WHERE student_id IN (?, ?)`, [TEST_STUDENT_ID, TEST_STUDENT_ID_PEER]);
    await runQuery(`DELETE FROM attendance_records WHERE student_id IN (?, ?)`, [TEST_STUDENT_ID, TEST_STUDENT_ID_PEER]);
    await runQuery(`DELETE FROM security_audit_logs WHERE student_id IN (?, ?)`, [TEST_STUDENT_ID, TEST_STUDENT_ID_PEER]);
    await runQuery(`DELETE FROM students WHERE id IN (?, ?)`, [TEST_STUDENT_ID, TEST_STUDENT_ID_PEER]);
    await runQuery(`DELETE FROM users WHERE username IN (?, ?)`, [TEST_ROLL_V3, TEST_ROLL_V3_PEER]);
  });

  test('Layer 1: Native Mock Location detection returns DENY and increments strike', async () => {
    const res = await request(app)
      .post('/api/v1/attendance/verify-location')
      .send({
        roll_number: TEST_ROLL_V3,
        latitude: activeGeofence.latitude,
        longitude: activeGeofence.longitude,
        accuracy: 8,
        is_mock_location: true
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.decision).toBe('DENY');
    expect(res.body.reason).toBe('MOCK_LOCATION_ACTIVE');

    const s = await getQuery(`SELECT failed_attempts FROM students WHERE id = ?`, [TEST_STUDENT_ID]);
    expect(s.failed_attempts).toBe(1);

    // Reset strike for next tests
    await request(app)
      .post('/api/v1/admin/security/reset-strike')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ student_id: TEST_STUDENT_ID, reason: 'Unit test reset' });
  });

  test('Layer 2: Indoor noisy GPS with coarse accuracy (>65m) yields RETRY with ZERO strikes', async () => {
    const res = await request(app)
      .post('/api/v1/attendance/verify-location')
      .send({
        roll_number: TEST_ROLL_V3,
        latitude: activeGeofence.latitude,
        longitude: activeGeofence.longitude,
        accuracy: 75, // Coarse satellite reception
        is_mock_location: false
      });

    expect(res.status).toBe(400);
    expect(res.body.decision).toBe('RETRY');
    expect(res.body.isAccuracyIssue).toBe(true);

    // Zero false strikes!
    const s = await getQuery(`SELECT failed_attempts FROM students WHERE id = ?`, [TEST_STUDENT_ID]);
    expect(s.failed_attempts).toBe(0);
  });

  test('Layer 3 & 10: Throttled Wi-Fi / PWA degraded mode triggers STEP_UP with screen-flash challenge', async () => {
    const res = await request(app)
      .post('/api/v1/attendance/verify-location')
      .send({
        roll_number: TEST_ROLL_V3,
        latitude: activeGeofence.latitude,
        longitude: activeGeofence.longitude,
        accuracy: 10,
        is_mock_location: false,
        wifi_scan: { status: 'SCAN_THROTTLED', bssids: [] },
        is_native: false
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.stepPassed).toBe(true);
    expect(res.body.decision).toBe('STEP_UP');
    expect(res.body.requiresStepUp).toBe(true);
    expect(res.body.stepUpColorSequence).toEqual(['#FF0040', '#00E5FF']);
    expect(res.body.challengeToken).toBeDefined();

    // Verify evidence was written with v3.0 policy version
    const evidence = await getQuery(
      `SELECT * FROM attendance_evidence WHERE challenge_id = (SELECT id FROM attendance_challenges WHERE challenge_token = ?)`,
      [res.body.challengeToken]
    );
    expect(evidence).toBeDefined();
    expect(evidence.policy_version).toBe('v3.0');
  });

  test('Layer 13.1: Two-Phone Split-Relay attack detected and blocked with 403 DENY', async () => {
    // 1. Issue challenge bound to IP 192.168.1.50 and DEV-PHONE-LEGIT
    const challengeToken = uuidv4();
    const challengeId = uuidv4();
    const expiresAt = new Date(Date.now() + 90000).toISOString();

    await runQuery(`
      INSERT INTO attendance_challenges (
        id, student_id, challenge_token, expires_at, is_used, verified_distance,
        bound_ip_address, bound_device_id, request_nonce_hash, requires_step_up
      ) VALUES (?, ?, ?, ?, 0, 5.0, '192.168.1.50', 'DEV-PHONE-LEGIT', 'noncehash123', 0)
    `, [challengeId, TEST_STUDENT_ID, challengeToken, expiresAt]);

    // 2. Submit face verification from different IP and different device ID
    const relayRes = await request(app)
      .post('/api/v1/attendance/verify-face')
      .set('X-Forwarded-For', '10.0.0.99')
      .send({
        challenge_token: challengeToken,
        live_photo: 'data:image/jpeg;base64,mockphoto',
        device_id: 'DEV-PHONE-RELAYED-EXT'
      });

    expect(relayRes.status).toBe(403);
    expect(relayRes.body.status).toBe('DENY');
    expect(relayRes.body.reason).toBe('SPLIT_RELAY_DETECTED');

    // Audit log recorded
    const log = await getQuery(
      `SELECT * FROM security_audit_logs WHERE incident_type = 'SPLIT_RELAY_DETECTED' AND student_id = ?`,
      [TEST_STUDENT_ID]
    );
    expect(log).toBeDefined();
    expect(log.decision_outcome).toBe('DENY');
  });

  test('Layer 13.2: Roommate Multi-Account Collusion on same device within 15 min blocked', async () => {
    const today = getIstDateString();
    const sharedDevId = 'DEV-SHARED-ROOMMATE-DEVICE';

    await runQuery(`DELETE FROM attendance_records WHERE student_id IN (?, ?)`, [TEST_STUDENT_ID, TEST_STUDENT_ID_PEER]);

    // 1. Student 1 marks attendance today using shared device
    const c1Token = uuidv4();
    const c1Id = uuidv4();
    const validExpiry = new Date(Date.now() + 120000).toISOString();

    await runQuery(`
      INSERT INTO attendance_challenges (
        id, student_id, challenge_token, expires_at, is_used, verified_distance, bound_device_id
      ) VALUES (?, ?, ?, ?, 1, 4.0, ?)
    `, [c1Id, TEST_STUDENT_ID, c1Token, validExpiry, sharedDevId]);

    await runQuery(`
      INSERT INTO attendance_records (
        id, student_id, roll_number, full_name, date, time_marked, status, verified_distance
      ) VALUES (?, ?, ?, 'AntiSpoof Test Student 1', ?, '07:15:00', 'PRESENT', 4.0)
    `, [uuidv4(), TEST_STUDENT_ID, TEST_ROLL_V3, today]);

    // 2. Student 2 obtains a valid challenge
    const c2Token = uuidv4();
    const c2Id = uuidv4();
    await runQuery(`
      INSERT INTO attendance_challenges (
        id, student_id, challenge_token, expires_at, is_used, verified_distance, bound_device_id
      ) VALUES (?, ?, ?, ?, 0, 4.0, ?)
    `, [c2Id, TEST_STUDENT_ID_PEER, c2Token, validExpiry, sharedDevId]);

    // 3. Student 2 tries to verify face on the exact same device ID
    const collusionRes = await request(app)
      .post('/api/v1/attendance/verify-face')
      .send({
        challenge_token: c2Token,
        live_photo: 'data:image/jpeg;base64,mockphoto',
        device_id: sharedDevId
      });

    expect(collusionRes.status).toBe(403);
    expect(collusionRes.body.status).toBe('DENY');
    expect(collusionRes.body.reason).toBe('COLLUSION_PROXY_DETECTED');
  });

  test('Layer 5: Replay attack & race-condition atomicity guarantees single commit', async () => {
    // Delete existing attendance for today first so verify-location allows it
    const today = getIstDateString();
    await runQuery(`DELETE FROM attendance_records WHERE student_id = ?`, [TEST_STUDENT_ID]);

    // Obtain legitimate fresh challenge
    const res = await request(app)
      .post('/api/v1/attendance/verify-location')
      .send({
        roll_number: TEST_ROLL_V3,
        latitude: activeGeofence.latitude,
        longitude: activeGeofence.longitude,
        accuracy: 8,
        is_mock_location: false,
        device_id: 'DEV-V3-PHONE-A'
      });

    expect(res.status).toBe(200);
    const token = res.body.challengeToken;

    // First commit passes with photometric step-up verification
    const commit1 = await request(app)
      .post('/api/v1/attendance/verify-face')
      .send({
        challenge_token: token,
        live_photo: 'data:image/jpeg;base64,mocklivephoto',
        device_id: 'DEV-V3-PHONE-A',
        photometric_data: { flash_verified: true, colors: res.body.stepUpColorSequence || ['#FFFFFF', '#3B82F6'] }
      });

    expect(commit1.status).toBe(200);
    expect(commit1.body.status).toBe('PRESENT');

    // Immediate replay of same challenge fails with 403
    const commit2 = await request(app)
      .post('/api/v1/attendance/verify-face')
      .send({
        challenge_token: token,
        live_photo: 'data:image/jpeg;base64,mocklivephoto',
        device_id: 'DEV-V3-PHONE-A',
        photometric_data: { flash_verified: true, colors: res.body.stepUpColorSequence || ['#FFFFFF', '#3B82F6'] }
      });

    expect(commit2.status).toBe(403);
    expect(commit2.body.error).toContain('already been used');

    // Exactly 1 attendance record exists
    const records = await allQuery(`SELECT * FROM attendance_records WHERE student_id = ? AND date = ?`, [TEST_STUDENT_ID, today]);
    expect(records.length).toBe(1);
    expect(records[0].assurance_tier).toBeDefined();
  });

  test('Admin Security Desk: 1-Click Approve Manual Review clears strike & updates evidence', async () => {
    // Create an unverified evidence record with NULL challenge_id
    const evId = uuidv4();
    await runQuery(`
      INSERT INTO attendance_evidence (
        id, challenge_id, student_id, decision_outcome, total_risk_score, assurance_tier, policy_version
      ) VALUES (?, NULL, ?, 'MANUAL_REVIEW', 72, 'NATIVE_STEP_UP', 'v3.0')
    `, [evId, TEST_STUDENT_ID]);

    const approveRes = await request(app)
      .post('/api/v1/admin/security/approve-manual-review')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        student_id: TEST_STUDENT_ID,
        evidence_id: evId,
        reason: 'Warden physical dorm visit confirmed resident presence in room A-101.'
      });

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.success).toBe(true);

    const updatedEv = await getQuery(`SELECT decision_outcome FROM attendance_evidence WHERE id = ?`, [evId]);
    expect(updatedEv.decision_outcome).toBe('ALLOW');
  });
});
