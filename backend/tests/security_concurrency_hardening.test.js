const request = require('supertest');
const { app } = require('../src/server');
const { runQuery, getQuery, checkDatabaseIntegrity, initDatabase } = require('../src/db/database');
const { createBackup, restoreBackup, listBackups, verifyFileIntegrity } = require('../src/services/backupService');
const { verifyPhoneEmailJsonUrl } = require('../src/services/notificationService');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

describe('Security, Concurrency & Release Hardening Tests', () => {
  let adminToken;
  let testUserId;
  let testStudentId;
  const testRoll = 'TEST-HARDEN-01';

  beforeAll(async () => {
    // 0. Ensure schema migrations and indexes are active
    await initDatabase();

    // 1. Authenticate as Admin to get Admin Bearer Token
    const adminRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'Admin@12345' });

    expect(adminRes.status).toBe(200);
    adminToken = adminRes.body.token;

    // 2. Setup a clean test student & user
    testUserId = uuidv4();
    testStudentId = `HSTL-2026-${testRoll}`;

    await runQuery(`
      INSERT OR REPLACE INTO users (id, username, email, password_hash, role, student_id, is_active)
      VALUES (?, ?, ?, '$2a$10$w857Q8k8N4fL52/B70hF8eD6V84h9e4i7u7K7t5i4u3i2o1p0a9s8', 'STUDENT', ?, 1)
    `, [testUserId, testRoll, `${testRoll.toLowerCase()}@test.local`, testStudentId]);

    await runQuery(`
      INSERT OR REPLACE INTO students (
        id, user_id, roll_number, full_name, email, phone, course,
        admission_year, semester, room_number, hostel_block, device_id, is_active
      ) VALUES (?, ?, ?, 'Test Hardened Student', ?, '+919999900001', 'B.Tech CS', 2026, 1, 'A-201', 'Block A', 'DEV-TEST-01', 1)
    `, [testStudentId, testUserId, testRoll, `${testRoll.toLowerCase()}@test.local`]);

    // Insert mock embeddings for face match
    const mockVec = Array(128).fill(0.088);
    await runQuery(`
      INSERT OR REPLACE INTO student_face_embeddings (id, student_id, angle_label, embedding_vector, quality_score, liveness_score)
      VALUES (?, ?, 'FRONT', ?, 1.0, 1.0)
    `, [uuidv4(), testStudentId, JSON.stringify(mockVec)]);
  });

  afterAll(async () => {
    await runQuery(`DELETE FROM student_face_embeddings WHERE student_id = ?`, [testStudentId]);
    await runQuery(`DELETE FROM attendance_challenges WHERE student_id = ?`, [testStudentId]);
    await runQuery(`DELETE FROM attendance_records WHERE student_id = ?`, [testStudentId]);
    await runQuery(`DELETE FROM students WHERE roll_number = ?`, [testRoll]);
    await runQuery(`DELETE FROM users WHERE username = ?`, [testRoll]);
  });

  describe('1. Refresh Token Engine & Token Family Compromise Defense', () => {
    let initialRefreshToken;
    let initialAccessToken;

    test('Login issues short-lived accessToken and 7-day opaque refreshToken', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'warden', password: 'Warden@12345' });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(typeof res.body.refreshToken).toBe('string');
      expect(res.body.refreshToken.length).toBe(64); // 32 hex bytes = 64 characters

      initialAccessToken = res.body.accessToken;
      initialRefreshToken = res.body.refreshToken;
    });

    test('POST /api/v1/auth/refresh rotates the refresh token and returns new tokens', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: initialRefreshToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      // Rotated token must differ from initial token
      expect(res.body.refreshToken).not.toBe(initialRefreshToken);
    });

    test('Token Family Compromise Defense: Replaying an already rotated token immediately terminates all user sessions', async () => {
      // Attacker attempts to reuse the already-rotated initialRefreshToken
      const attackRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: initialRefreshToken });

      expect(attackRes.status).toBe(401);
      expect(attackRes.body.error).toContain('Compromised refresh token detected');

      // Verify that all active tokens for this user are now revoked in database
      const wardenUser = await getQuery(`SELECT id FROM users WHERE username = 'warden'`);
      const unrevokedCount = await getQuery(`
        SELECT COUNT(*) as count FROM refresh_tokens WHERE user_id = ? AND is_revoked = 0
      `, [wardenUser.id]);

      expect(unrevokedCount.count).toBe(0);
    });
  });

  describe('2. SSRF Defense on Third-Party Phone.Email Endpoint', () => {
    test('Rejects non-HTTPS user_json_url with protocol error', async () => {
      await expect(
        verifyPhoneEmailJsonUrl('http://phone.email/user_data.json')
      ).rejects.toThrow('Insecure protocol');
    });

    test('Blocks SSRF attempts to Cloud Metadata IP (169.254.169.254)', async () => {
      await expect(
        verifyPhoneEmailJsonUrl('https://169.254.169.254/latest/meta-data/')
      ).rejects.toThrow(/SSRF Blocked/);
    });

    test('Blocks SSRF attempts to arbitrary external or internal domain', async () => {
      await expect(
        verifyPhoneEmailJsonUrl('https://malicious-attacker-server.com/steal')
      ).rejects.toThrow(/SSRF Blocked/);
    });
  });

  describe('3. Atomic Attendance Challenge Consumption & Concurrency Defense', () => {
    let challengeToken;

    beforeEach(async () => {
      // Clear today's attendance record for test student
      const today = new Date().toISOString().split('T')[0];
      await runQuery(`DELETE FROM attendance_records WHERE student_id = ? AND date = ?`, [testStudentId, today]);

      // Obtain a valid challenge token
      challengeToken = uuidv4();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      await runQuery(`
        INSERT INTO attendance_challenges (id, student_id, challenge_token, expires_at, is_used, verified_distance)
        VALUES (?, ?, ?, ?, 0, 8.5)
      `, [uuidv4(), testStudentId, challengeToken, expiresAt]);
    });

    test('Single valid submission marks attendance successfully', async () => {
      const res = await request(app)
        .post('/api/v1/attendance/verify-face')
        .send({
          challenge_token: challengeToken,
          live_photo: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe('PRESENT');
    });

    test('Simultaneous concurrent requests with same challenge token are race-condition safe (exactly 1 succeeds, others 409 Conflict)', async () => {
      // Fire 5 simultaneous requests concurrently
      const concurrentRequests = Array(5).fill(null).map(() =>
        request(app)
          .post('/api/v1/attendance/verify-face')
          .send({
            challenge_token: challengeToken,
            live_photo: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...'
          })
      );

      const responses = await Promise.all(concurrentRequests);
      const successCount = responses.filter(r => r.status === 200).length;
      const conflictCount = responses.filter(r => r.status === 409).length;

      // Crucial: Exactly ONE request can succeed; all duplicate concurrent requests must be rejected
      expect(successCount).toBe(1);
      expect(conflictCount).toBe(4);
    });
  });

  describe('4. Geofence Security & Boundary Enforcement', () => {
    test('Rejects geofence radius exceeding security policy (>150m)', async () => {
      const res = await request(app)
        .post('/api/v1/admin/geofence')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          latitude: 28.5450,
          longitude: 77.1926,
          radius_meters: 5000, // 5km is unsafe
          reason: 'Accidental extreme radius test'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid geofence radius');
    });

    test('Rejects invalid latitude/longitude out-of-bounds', async () => {
      const res = await request(app)
        .post('/api/v1/admin/geofence')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          latitude: 125.0, // Invalid latitude (>90)
          longitude: 77.1926,
          radius_meters: 25.0
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid coordinates');
    });

    test('Accepts valid geofence update and records audit event with reason', async () => {
      const res = await request(app)
        .post('/api/v1/admin/geofence')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          hostel_name: 'Campus Main Block',
          latitude: 28.5455,
          longitude: 77.1930,
          radius_meters: 35.0,
          reason: 'Boundary recalibration after fence extension'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.config.radius_meters).toBe(35.0);

      // Verify audit event
      const audit = await getQuery(`
        SELECT * FROM admin_audit_events WHERE action = 'UPDATE_GEOFENCE' ORDER BY created_at DESC LIMIT 1
      `);
      expect(audit).toBeDefined();
      expect(audit.details).toContain('Boundary recalibration');
    });
  });

  describe('5. Roster Upload Formula Injection (DDE) Sanitization', () => {
    test('Sanitizes malicious spreadsheet formula prefixes (=, +, -, @) during roster preview', async () => {
      const maliciousRows = [
        {
          roll_number: '=cmd|\'/C calc\'!A0',
          full_name: '@SUM(A1:A10)',
          room_number: '+A-999',
          hostel_block: '-Block Malicious',
          email: '=evil@hacker.com',
          phone: '+919999900002'
        }
      ];

      const res = await request(app)
        .post('/api/v1/admin/allotment/upload-preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ allotments: maliciousRows });

      expect(res.status).toBe(200);
      const records = res.body.preview?.records || res.body.validRecords;
      expect(records).toBeDefined();
      const sanitized = records[0];

      // Verify dangerous formula prefixes have been safely neutralized with single quote prefix
      expect(sanitized.roll_number.startsWith("'=")).toBe(true);
      expect(sanitized.full_name.startsWith("'@")).toBe(true);
      expect(sanitized.room_number.startsWith("'+")).toBe(true);
      expect(sanitized.hostel_block.startsWith("'-")).toBe(true);
    });
  });

  describe('6. SQLite Database Backup & Restore Engine', () => {
    let createdBackupPath;

    test('createBackup() flushes WAL and produces a verified SQLite database snapshot', async () => {
      const result = await createBackup();

      expect(result.success).toBe(true);
      expect(result.integrity).toBe('PASS');
      expect(result.sizeBytes).toBeGreaterThan(0);
      expect(fs.existsSync(result.backupPath)).toBe(true);

      createdBackupPath = result.backupPath;
    });

    test('listBackups() lists the created backup with metadata', () => {
      const backups = listBackups();
      expect(Array.isArray(backups)).toBe(true);
      expect(backups.length).toBeGreaterThan(0);
      expect(backups[0].filename).toBeDefined();
    });

    test('restoreBackup() validates backup integrity and restores cleanly', async () => {
      const testRestoreTarget = path.join(__dirname, '../data/test_restore_validation.sqlite');
      const restoreResult = await restoreBackup(createdBackupPath, testRestoreTarget);

      expect(restoreResult.success).toBe(true);
      expect(restoreResult.integrity).toBe('PASS');
      expect(fs.existsSync(testRestoreTarget)).toBe(true);

      // Verify target integrity
      const isTargetHealthy = await verifyFileIntegrity(testRestoreTarget);
      expect(isTargetHealthy).toBe(true);

      // Clean up test target file
      if (fs.existsSync(testRestoreTarget)) {
        fs.unlinkSync(testRestoreTarget);
      }
    });
  });

  describe('7. System Health Diagnostics Endpoint', () => {
    test('GET /api/v1/admin/system-health returns health status for all subcomponents', async () => {
      const res = await request(app)
        .get('/api/v1/admin/system-health')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.components.backend.status).toBe('HEALTHY');
      expect(res.body.components.database.status).toBe('HEALTHY');
      expect(res.body.components.storage.totalBackups).toBeGreaterThan(0);
    });
  });
});
