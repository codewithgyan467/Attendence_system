const request = require('supertest');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { app } = require('../src/server');
const { initDatabase, runQuery, getQuery } = require('../src/db/database');
const bleBeaconService = require('../src/services/bleBeaconService');
const beaconCache = require('../src/services/beaconCache');

describe('HostelGuard Enterprise v3.2 - Multi-Floor BLE & Offline Store-and-Forward Sync Suite', () => {
  const TEST_STUDENT_ID = 'TEST-STUDENT-OFFLINE-UUID';
  const TEST_ROLL = 'TEST_OFFLINE_01';
  let adminToken = '';

  const FLOOR_BEACONS = [
    {
      id: 'BEACON-FLR-0-UUID',
      beacon_public_id: 'FLR_0',
      block_name: 'Ground Floor',
      shared_secret_ref: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
      is_active: 1
    },
    {
      id: 'BEACON-FLR-1-UUID',
      beacon_public_id: 'FLR_1',
      block_name: '1st Floor',
      shared_secret_ref: 'b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1',
      is_active: 1
    },
    {
      id: 'BEACON-FLR-2-UUID',
      beacon_public_id: 'FLR_2',
      block_name: '2nd Floor',
      shared_secret_ref: 'c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2',
      is_active: 1
    }
  ];

  beforeAll(async () => {
    await initDatabase();

    // Login Admin
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'Admin@12345' });
    adminToken = loginRes.body.token;

    // Clean test artifacts
    await runQuery(`DELETE FROM attendance_evidence WHERE student_id = ?`, [TEST_STUDENT_ID]);
    await runQuery(`DELETE FROM attendance_records WHERE student_id = ?`, [TEST_STUDENT_ID]);
    await runQuery(`DELETE FROM student_face_embeddings WHERE student_id = ?`, [TEST_STUDENT_ID]);
    await runQuery(`DELETE FROM students WHERE id = ?`, [TEST_STUDENT_ID]);
    await runQuery(`DELETE FROM users WHERE username = ?`, [TEST_ROLL]);

    for (const b of FLOOR_BEACONS) {
      await runQuery(`DELETE FROM site_ble_beacons WHERE beacon_public_id = ? OR id = ?`, [b.beacon_public_id, b.id]);
    }

    // Insert Student Record & Mock Face Embeddings
    const uId = uuidv4();
    await runQuery(`
      INSERT INTO users (id, username, email, password_hash, role, student_id, is_active)
      VALUES (?, ?, ?, 'testhash', 'STUDENT', ?, 1)
    `, [uId, TEST_ROLL, `${TEST_ROLL}@test.local`, TEST_STUDENT_ID]);

    await runQuery(`
      INSERT INTO students (
        id, user_id, roll_number, full_name, email, course, admission_year, semester,
        room_number, hostel_block, device_id, is_active
      ) VALUES (?, ?, ?, 'Offline Test Student', ?, 'B.Tech', 2026, 1, 'A-201', 'Block A', 'DEV-OFFLINE-PHONE-01', 1)
    `, [TEST_STUDENT_ID, uId, TEST_ROLL, `${TEST_ROLL}@test.local`]);

    const mockVec = Array(128).fill(0.088);
    await runQuery(`
      INSERT INTO student_face_embeddings (id, student_id, angle_label, embedding_vector, quality_score, liveness_score)
      VALUES (?, ?, 'FRONT', ?, 1.0, 1.0)
    `, [uuidv4(), TEST_STUDENT_ID, JSON.stringify(mockVec)]);

    // Seed Multi-Floor Beacons
    const geo = await getQuery(`SELECT id FROM geofence_configs WHERE is_active = 1 LIMIT 1`);
    for (const b of FLOOR_BEACONS) {
      await runQuery(`
        INSERT INTO site_ble_beacons (id, geofence_id, beacon_public_id, shared_secret_ref, block_name, is_active)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [b.id, geo?.id, b.beacon_public_id, b.shared_secret_ref, b.block_name, b.is_active]);
    }

    // Hydrate BeaconCache
    await beaconCache.hydrate();

    // Isolate geofence to STANDBY_OPTIONAL during offline sync test suite
    await runQuery(`UPDATE geofence_configs SET ble_mode = 'STANDBY_OPTIONAL' WHERE is_active = 1`);
  });

  afterAll(async () => {
    await runQuery(`UPDATE geofence_configs SET ble_mode = 'STRICT_REQUIRED' WHERE is_active = 1`);
    await runQuery(`DELETE FROM attendance_evidence WHERE student_id = ?`, [TEST_STUDENT_ID]);
    await runQuery(`DELETE FROM attendance_records WHERE student_id = ?`, [TEST_STUDENT_ID]);
    await runQuery(`DELETE FROM student_face_embeddings WHERE student_id = ?`, [TEST_STUDENT_ID]);
    await runQuery(`DELETE FROM students WHERE id = ?`, [TEST_STUDENT_ID]);
    await runQuery(`DELETE FROM users WHERE username = ?`, [TEST_ROLL]);

    for (const b of FLOOR_BEACONS) {
      await runQuery(`DELETE FROM site_ble_beacons WHERE beacon_public_id = ? OR id = ?`, [b.beacon_public_id, b.id]);
    }
  });

  test('1. Sub-1ms Cloud Container Keepalive Endpoint', async () => {
    const res = await request(app).get('/api/v1/health/keepalive');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });

  test('2. Multi-Floor O(1) BeaconCache Resolution & Live Rolling TOTP Verification', async () => {
    const currentSlot = Math.floor(Date.now() / 30000);

    for (const floor of FLOOR_BEACONS) {
      const code = bleBeaconService.computeRollingToken(floor.shared_secret_ref, floor.beacon_public_id, currentSlot);

      // Verify via BeaconCache
      const verification = await bleBeaconService.verifyBleBeaconProof({
        beaconPublicId: floor.beacon_public_id,
        rollingCode: code
      });

      expect(verification.isValid).toBe(true);
      expect(verification.beaconPublicId).toBe(floor.beacon_public_id);
      expect(verification.blockName).toBe(floor.block_name);
    }
  });

  test('3. Crowdsourced Phone-to-ESP32 Time Relay packet generation and validation', () => {
    const beacon = FLOOR_BEACONS[0];
    const nowSec = Math.floor(Date.now() / 1000);
    const packet = bleBeaconService.generateTimeSyncPacket(beacon.beacon_public_id, beacon.shared_secret_ref, nowSec);

    expect(packet).toContain(`${nowSec}:`);
    const isValid = bleBeaconService.verifyTimeSyncPacket(packet, beacon.beacon_public_id, beacon.shared_secret_ref);
    expect(isValid).toBe(true);

    // Tampered time packet fails
    const tamperedPacket = `${nowSec + 9999}:FAKECALL00000000`;
    const isTamperedValid = bleBeaconService.verifyTimeSyncPacket(tamperedPacket, beacon.beacon_public_id, beacon.shared_secret_ref);
    expect(isTamperedValid).toBe(false);
  });

  test('4. Challenge endpoint returns ble_time_sync_packet for mobile time relay', async () => {
    const geo = await getQuery(`SELECT * FROM geofence_configs WHERE is_active = 1 LIMIT 1`);
    const res = await request(app)
      .post('/api/v1/attendance/challenge')
      .send({
        roll_number: TEST_ROLL,
        latitude: geo.latitude,
        longitude: geo.longitude,
        accuracy: 10,
        beacon_public_id: 'FLR_1'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.challengeToken).toBeDefined();
    expect(res.body.ble_time_sync_packet).toBeDefined();
  });

  test('5. Valid Offline Hardware-Signed Selfie upload (delayed by 15 mins) marks attendance', async () => {
    // Curfew 15 minutes ago
    const fifteenMinsAgoMs = Date.now() - (15 * 60 * 1000);
    const slot30s = Math.floor(fifteenMinsAgoMs / 30000);

    const mockPhotoBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...MOCK_OFFLINE_FRAME...';
    const imageHash = crypto.createHash('sha256').update(TEST_STUDENT_ID + mockPhotoBase64).digest('hex');

    const beacon = FLOOR_BEACONS[1]; // 1st Floor
    const hwSignature = bleBeaconService.computeOfflineSignature(beacon.shared_secret_ref, imageHash, beacon.beacon_public_id, slot30s);

    const res = await request(app)
      .post('/api/v1/attendance/offline-sync')
      .send({
        student_id: TEST_STUDENT_ID,
        frame_base64: mockPhotoBase64,
        image_hash: imageHash,
        beacon_id: beacon.beacon_public_id,
        slot_30s: slot30s,
        hw_signature: hwSignature,
        device_id: 'DEV-OFFLINE-PHONE-01'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('PRESENT');
    expect(res.body.offlineVerified).toBe(true);
    expect(res.body.record.beaconId).toBe('FLR_1');

    // Verify record in SQLite database
    const rec = await getQuery(`SELECT * FROM attendance_records WHERE student_id = ?`, [TEST_STUDENT_ID]);
    expect(rec).toBeDefined();
    expect(rec.status).toBe('PRESENT');
  });

  test('6. Tampered selfie frame with original BLE signature is REJECTED (400)', async () => {
    const slot30s = Math.floor(Date.now() / 30000);
    const legitimatePhoto = 'data:image/jpeg;base64,LEGITIMATE_PHOTO_FRAME';
    const legitimateHash = crypto.createHash('sha256').update(TEST_STUDENT_ID + legitimatePhoto).digest('hex');

    const beacon = FLOOR_BEACONS[0];
    const hwSignature = bleBeaconService.computeOfflineSignature(beacon.shared_secret_ref, legitimateHash, beacon.beacon_public_id, slot30s);

    // Attacker modifies webcam frame but passes legitimate image hash & signature
    const tamperedPhoto = 'data:image/jpeg;base64,TAMPERED_STUDENT_PHOTO_FRAME';

    const res = await request(app)
      .post('/api/v1/attendance/offline-sync')
      .send({
        student_id: TEST_STUDENT_ID,
        frame_base64: tamperedPhoto,
        image_hash: legitimateHash, // Mismatch with tamperedPhoto
        beacon_id: beacon.beacon_public_id,
        slot_30s: slot30s,
        hw_signature: hwSignature
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('tampered');
  });

  test('7. Replay of an already-used slot_30s + student_id offline proof is REJECTED (409)', async () => {
    const fifteenMinsAgoMs = Date.now() - (15 * 60 * 1000);
    const slot30s = Math.floor(fifteenMinsAgoMs / 30000);
    const mockPhoto = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...MOCK_OFFLINE_FRAME...';
    const imageHash = crypto.createHash('sha256').update(TEST_STUDENT_ID + mockPhoto).digest('hex');

    const beacon = FLOOR_BEACONS[1];
    const hwSignature = bleBeaconService.computeOfflineSignature(beacon.shared_secret_ref, imageHash, beacon.beacon_public_id, slot30s);

    // Replay exact same payload
    const res = await request(app)
      .post('/api/v1/attendance/offline-sync')
      .send({
        student_id: TEST_STUDENT_ID,
        frame_base64: mockPhoto,
        image_hash: imageHash,
        beacon_id: beacon.beacon_public_id,
        slot_30s: slot30s,
        hw_signature: hwSignature
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('already recorded');
  });

  test('8. Revoked floor beacon via Admin Kill-Switch REJECTS offline sync (403)', async () => {
    // Create new student for clean date
    const cleanStudentId = 'TEST-STUDENT-REVOKED-UUID';
    const cleanRoll = 'TEST_REVOKED_01';
    const uId = uuidv4();

    await runQuery(`
      INSERT INTO users (id, username, email, password_hash, role, student_id, is_active)
      VALUES (?, ?, ?, 'testhash', 'STUDENT', ?, 1)
    `, [uId, cleanRoll, `${cleanRoll}@test.local`, cleanStudentId]);

    await runQuery(`
      INSERT INTO students (
        id, user_id, roll_number, full_name, email, course, admission_year, semester,
        room_number, hostel_block, device_id, is_active
      ) VALUES (?, ?, ?, 'Revoked Test Student', ?, 'B.Tech', 2026, 1, 'B-301', 'Block B', 'DEV-REVOKED-PHONE', 1)
    `, [cleanStudentId, uId, cleanRoll, `${cleanRoll}@test.local`]);

    const mockVec = Array(128).fill(0.088);
    await runQuery(`
      INSERT INTO student_face_embeddings (id, student_id, angle_label, embedding_vector, quality_score, liveness_score)
      VALUES (?, ?, 'FRONT', ?, 1.0, 1.0)
    `, [uuidv4(), cleanStudentId, JSON.stringify(mockVec)]);

    // Deactivate Floor 2 Beacon via Admin Kill Switch API
    const targetBeacon = FLOOR_BEACONS[2];
    const killRes = await request(app)
      .post(`/api/v1/admin/ble/beacons/${targetBeacon.id}/toggle`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(killRes.status).toBe(200);
    expect(killRes.body.is_active).toBe(0);

    // Verify it is also deactivated in RAM BeaconCache
    const cachedBeacon = beaconCache.get(targetBeacon.beacon_public_id);
    expect(cachedBeacon.is_active).toBe(0);

    // Now try offline check-in with this revoked beacon
    const slot30s = Math.floor(Date.now() / 30000);
    const mockPhoto = 'data:image/jpeg;base64,REVOKED_BEACON_FRAME';
    const imageHash = crypto.createHash('sha256').update(cleanStudentId + mockPhoto).digest('hex');
    const hwSignature = bleBeaconService.computeOfflineSignature(targetBeacon.shared_secret_ref, imageHash, targetBeacon.beacon_public_id, slot30s);

    const res = await request(app)
      .post('/api/v1/attendance/offline-sync')
      .send({
        student_id: cleanStudentId,
        frame_base64: mockPhoto,
        image_hash: imageHash,
        beacon_id: targetBeacon.beacon_public_id,
        slot_30s: slot30s,
        hw_signature: hwSignature
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.reason).toBe('BEACON_INACTIVE_OR_REVOKED');

    // Clean up
    await runQuery(`DELETE FROM students WHERE id = ?`, [cleanStudentId]);
    await runQuery(`DELETE FROM users WHERE id = ?`, [uId]);
  });
});

