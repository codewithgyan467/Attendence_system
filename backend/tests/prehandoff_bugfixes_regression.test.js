const request = require('supertest');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { app } = require('../src/server');
const { initDatabase, runQuery, getQuery } = require('../src/db/database');
const bleBeaconService = require('../src/services/bleBeaconService');
const localVaultDb = require('../src/config/localVaultDb');

describe('ATTENDRA Pre-Handoff Security & Bugfix Regressions', () => {
  const TEST_STUDENT_ID = 'REG-FIX-STUDENT-01';
  const TEST_ROLL = 'REG_FIX_01';
  const TEST_EMAIL = 'reg.fix.student@example.com';
  let wardenToken = '';

  beforeAll(async () => {
    await initDatabase();

    await runQuery(`DELETE FROM attendance_evidence WHERE student_id = ?`, [TEST_STUDENT_ID]);
    await runQuery(`DELETE FROM attendance_challenges WHERE student_id = ?`, [TEST_STUDENT_ID]);
    await runQuery(`DELETE FROM attendance_records WHERE student_id = ?`, [TEST_STUDENT_ID]);
    await runQuery(`DELETE FROM password_reset_otps WHERE identifier = ?`, [TEST_ROLL]);
    await runQuery(`DELETE FROM students WHERE id = ? OR roll_number = ?`, [TEST_STUDENT_ID, TEST_ROLL]);
    await runQuery(`DELETE FROM users WHERE username = ?`, [TEST_ROLL]);

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash('Student@12345', salt);
    const uId = uuidv4();

    await runQuery(`
      INSERT INTO users (id, username, email, password_hash, role, student_id, is_active)
      VALUES (?, ?, ?, ?, 'STUDENT', ?, 1)
    `, [uId, TEST_ROLL, TEST_EMAIL, hash, TEST_STUDENT_ID]);

    await runQuery(`
      INSERT INTO students (
        id, user_id, roll_number, full_name, email, phone, course, admission_year, semester,
        room_number, hostel_block, device_id, face_enrollment_status, is_active, failed_attempts, is_flagged_forge
      ) VALUES (?, ?, ?, 'Regression Test Student', ?, '+919876500001', 'B.Tech', 2026, 2, 'A-101', 'Block A', 'DEV-REG-01', 'ENROLLED', 1, 0, 0)
    `, [TEST_STUDENT_ID, uId, TEST_ROLL, TEST_EMAIL]);

    const wRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'warden', password: 'Warden@12345' });
    wardenToken = wRes.body.token;
  });

  afterAll(async () => {
    await runQuery(`UPDATE geofence_configs SET ble_mode = 'SOFT_ANCHOR' WHERE is_active = 1`);
    await runQuery(`DELETE FROM attendance_evidence WHERE student_id = ?`, [TEST_STUDENT_ID]);
    await runQuery(`DELETE FROM attendance_challenges WHERE student_id = ?`, [TEST_STUDENT_ID]);
    await runQuery(`DELETE FROM attendance_records WHERE student_id = ?`, [TEST_STUDENT_ID]);
    await runQuery(`DELETE FROM password_reset_otps WHERE identifier = ?`, [TEST_ROLL]);
    await runQuery(`DELETE FROM students WHERE id = ? OR roll_number = ?`, [TEST_STUDENT_ID, TEST_ROLL]);
    await runQuery(`DELETE FROM users WHERE username = ?`, [TEST_ROLL]);
  });

  test('1. Compact 19-byte ESP32 BLE payload works end-to-end on HTTP /verify-location without self-replay rejection', async () => {
    const geo = await getQuery(`SELECT * FROM geofence_configs WHERE is_active = 1 LIMIT 1`);
    const beacon1 = await bleBeaconService.resolveBeacon('HG-BEACON-BLKA-01');
    const secret = beacon1?.shared_secret_ref || 'HG_STRICT_ANCHOR_SECRET_2026';

    await runQuery(`UPDATE geofence_configs SET ble_mode = 'STRICT_REQUIRED' WHERE is_active = 1`);

    const step = Math.floor(Date.now() / 30000) & 0xFFFFFF;
    const stepHex = step.toString(16).toUpperCase().padStart(6, '0');
    const hmac8 = crypto
      .createHmac('sha256', secret)
      .update(`A01:${step}`)
      .digest('hex')
      .substring(0, 8)
      .toUpperCase();
    const rawPayload = `A01|${stepHex}|${hmac8}`;

    // First attempt MUST pass both route check and policy engine single-pass validation
    const firstRes = await request(app)
      .post('/api/v1/attendance/verify-location')
      .send({
        roll_number: TEST_ROLL,
        latitude: geo.latitude,
        longitude: geo.longitude,
        accuracy: 10,
        ble_proof: { rawPayload, rssi: -55 }
      });

    expect(firstRes.status).toBe(200);
    expect(firstRes.body.success).toBe(true);
    expect(firstRes.body.bleMatchStatus).toBe('VERIFIED_BEACON_PROXIMITY');
    expect(firstRes.body.bleVerified).toBe(true);

    // Genuine second HTTP replay of identical compact token MUST be rejected
    const replayRes = await request(app)
      .post('/api/v1/attendance/verify-location')
      .send({
        roll_number: TEST_ROLL,
        latitude: geo.latitude,
        longitude: geo.longitude,
        accuracy: 10,
        ble_proof: { rawPayload, rssi: -55 }
      });

    expect(replayRes.status).toBe(403);
    expect(replayRes.body.reason).toBe('BLE_TOKEN_REPLAY_COOLDOWN');

    // Spoofing client-only compactVerified boolean without rawPayload MUST fail
    const spoofRes = await request(app)
      .post('/api/v1/attendance/verify-location')
      .send({
        roll_number: TEST_ROLL,
        latitude: geo.latitude,
        longitude: geo.longitude,
        accuracy: 10,
        ble_proof: { compactVerified: true }
      });

    expect(spoofRes.status).toBe(403);
  });

  test('2. Production mode rejects demo:/simulated: bypass on POST /api/v1/auth/google-login', async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await request(app)
        .post('/api/v1/auth/google-login')
        .send({ credential: `demo:${TEST_EMAIL}` });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  test('3. Direct /forgot-password/reset enforces max 5 failed OTP attempts', async () => {
    await runQuery(`DELETE FROM password_reset_otps WHERE identifier = ?`, [TEST_ROLL]);
    await runQuery(`
      INSERT INTO password_reset_otps (id, identifier, otp_code, method, destination, expires_at, is_used, attempts)
      VALUES (?, ?, '654321', 'EMAIL', ?, datetime('now', '+10 minutes'), 0, 0)
    `, [uuidv4(), TEST_ROLL, TEST_EMAIL]);

    for (let i = 0; i < 5; i++) {
      const badRes = await request(app)
        .post('/api/v1/auth/forgot-password/reset')
        .send({ identifier: TEST_ROLL, otp: '000000', new_password: 'NewPassword@123' });
      expect(badRes.status).toBe(400);
    }

    // 6th call even with correct OTP must fail because OTP was locked & invalidated after 5 bad guesses
    const lockedRes = await request(app)
      .post('/api/v1/auth/forgot-password/reset')
      .send({ identifier: TEST_ROLL, otp: '654321', new_password: 'NewPassword@123' });

    expect(lockedRes.status).toBe(400);
    expect(lockedRes.body.error).toMatch(/too many incorrect attempts/i);
  });

  test('4. Warden role is blocked with 403 from destructive/sensitive adminRoutes endpoints', async () => {
    const res1 = await request(app)
      .get('/api/v1/admin/credentials-directory')
      .set('Authorization', `Bearer ${wardenToken}`);
    expect(res1.status).toBe(403);

    const res2 = await request(app)
      .post(`/api/v1/admin/students/${TEST_ROLL}/reset-device`)
      .set('Authorization', `Bearer ${wardenToken}`);
    expect(res2.status).toBe(403);

    const res3 = await request(app)
      .delete('/api/v1/admin/corrections')
      .set('Authorization', `Bearer ${wardenToken}`);
    expect(res3.status).toBe(403);
  });

  test('5. localVaultDb.syncVaultToCloud converts SQLite datetime strings cleanly to IST YYYY-MM-DD and 12h time', async () => {
    const vaultAttId = uuidv4();
    await localVaultDb.openVaultDb();
    await localVaultDb.runVaultQuery(`
      INSERT INTO local_attendance_vault
        (id, student_id, roll_no, hostel_id, status, latitude, longitude, distance_m, verified_at, synced_to_cloud)
      VALUES (?, ?, ?, 'Block A', 'PRESENT', 26.14, 91.65, 5.0, '2026-11-25 14:30:00', 0)
    `, [vaultAttId, TEST_STUDENT_ID, TEST_ROLL]);

    const syncRes = await localVaultDb.syncVaultToCloud({ runQuery, getQuery });
    expect(syncRes.syncedAttendanceCount).toBeGreaterThanOrEqual(1);

    const cloudRow = await getQuery(`SELECT date, time_marked FROM attendance_records WHERE id = ?`, [vaultAttId]);
    expect(cloudRow).toBeDefined();
    expect(cloudRow.date).toBe('2026-11-25'); // Proper YYYY-MM-DD, not raw timestamp string
    expect(cloudRow.time_marked).toMatch(/PM$/); // Converted 14:30 UTC -> 08:00 PM IST, not '12:00:00'

    await localVaultDb.runVaultQuery(`DELETE FROM local_attendance_vault WHERE id = ?`, [vaultAttId]);
  });

  test('6. GET /api/v1/admin/wifi/authorized returns 200 without authorizedWifiService.getAll crash', async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'admin@123' });
    expect(loginRes.status).toBe(200);
    const adminToken = loginRes.body.token;

    const wifiRes = await request(app)
      .get('/api/v1/admin/wifi/authorized')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(wifiRes.status).toBe(200);
    expect(wifiRes.body.success).toBe(true);
    expect(Array.isArray(wifiRes.body.authorizedList)).toBe(true);
  });
});
