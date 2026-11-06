const request = require('supertest');
const { app } = require('../src/server');
const { runQuery, getQuery, allQuery } = require('../src/db/database');
const bleBeaconService = require('../src/services/bleBeaconService');
const antiSpoofPolicyEngine = require('../src/services/antiSpoofPolicyEngine');
const beaconCache = require('../src/services/beaconCache');

describe('HostelGuard Strict Mode: Dual ESP32 Hardware Presence Lock Enforcement', () => {
  let testStudentId;
  let geofence;
  let beacon1;
  let beacon2;

  beforeAll(async () => {
    // 1. Ensure test student exists
    const existing = await getQuery(`SELECT * FROM students WHERE roll_number = 'BEACON_TEST_01'`);
    if (!existing) {
      testStudentId = 'beacon-test-student-uuid';
      await runQuery(`
        INSERT INTO students (id, roll_number, full_name, hostel_block, room_number, course, admission_year, semester, device_id, face_enrollment_status, failed_attempts, is_flagged_forge)
        VALUES (?, 'BEACON_TEST_01', 'Beacon Test Student', 'Block A', '101', 'B.Tech CSE', 2024, 4, 'DEV_BEACON_TEST', 'ENROLLED', 0, 0)
      `, [testStudentId]);
    } else {
      testStudentId = existing.id;
      await runQuery(`UPDATE students SET failed_attempts = 0, is_flagged_forge = 0 WHERE id = ?`, [testStudentId]);
    }

    // 2. Resolve Ground Floor and 1st Floor Beacons
    beacon1 = await bleBeaconService.resolveBeacon('HG-BEACON-BLKA-01');
    beacon2 = await bleBeaconService.resolveBeacon('HG-BEACON-BLKA-02');

    // 3. Capture initial geofence state and set active geofence to STRICT_REQUIRED for tests
    const existingGeofence = await getQuery(`SELECT ble_mode, latitude, longitude, radius_meters FROM geofence_configs WHERE is_active = 1 LIMIT 1`);
    const originalBleMode = existingGeofence?.ble_mode || 'STRICT_REQUIRED';

    await runQuery(`
      UPDATE geofence_configs
      SET ble_mode = 'STRICT_REQUIRED', is_active = 1, latitude = 28.5455, longitude = 77.1930, radius_meters = 50
      WHERE is_active = 1
    `);
    geofence = await getQuery(`SELECT * FROM geofence_configs WHERE is_active = 1 LIMIT 1`);
  });

  afterAll(async () => {
    // Restore original configuration (preserving STRICT_REQUIRED if active)
    await runQuery(`UPDATE geofence_configs SET ble_mode = 'STRICT_REQUIRED' WHERE is_active = 1`);
    await runQuery(`DELETE FROM students WHERE roll_number = 'BEACON_TEST_01'`);
  });

  test('1. Both Beacons (Ground Floor & Seeed XIAO ESP32-C6) are active and resolvable in BeaconCache', () => {
    expect(beacon1).toBeDefined();
    expect(beacon1.beacon_public_id).toBe('HG-BEACON-BLKA-01');
    expect(beacon1.is_active).toBe(1);

    expect(beacon2).toBeDefined();
    expect(beacon2.beacon_public_id).toBe('HG-BEACON-BLKA-02');
    expect(beacon2.is_active).toBe(1);
    expect(beacon2.block_name).toContain('XIAO ESP32-C6');
  });

  test('2. Strict Mode + In Perimeter + Valid Ground Floor Beacon (HG-BEACON-BLKA-01) -> PASSES', async () => {
    const slot = Math.floor(Date.now() / 30000);
    const token1 = bleBeaconService.computeRollingToken(beacon1.shared_secret_ref, beacon1.beacon_public_id, slot);

    const evaluation = await antiSpoofPolicyEngine.evaluateLocationAndEnvironment({
      student: { id: testStudentId, roll_number: 'BEACON_TEST_01', failed_attempts: 0 },
      geofence,
      clientLat: 28.5455,
      clientLon: 77.1930,
      accuracy: 10,
      bleProof: {
        beaconPublicId: 'HG-BEACON-BLKA-01',
        rollingCode: token1,
        slot
      }
    });

    expect(evaluation.bleMatchStatus).toBe('VERIFIED_BEACON_PROXIMITY');
    expect(evaluation.decisionOutcome).not.toBe('DENY');
    expect(evaluation.unfairMeansFlags).not.toContain('STRICT_BLE_ANCHOR_FAILED');
  });

  test('3. Strict Mode + In Perimeter + Valid 1st Floor Beacon (HG-BEACON-BLKA-02) -> PASSES', async () => {
    const slot = Math.floor(Date.now() / 30000);
    const token2 = bleBeaconService.computeRollingToken(beacon2.shared_secret_ref, beacon2.beacon_public_id, slot);

    const evaluation = await antiSpoofPolicyEngine.evaluateLocationAndEnvironment({
      student: { id: testStudentId, roll_number: 'BEACON_TEST_01', failed_attempts: 0 },
      geofence,
      clientLat: 28.5455,
      clientLon: 77.1930,
      accuracy: 10,
      bleProof: {
        beaconPublicId: 'HG-BEACON-BLKA-02',
        rollingCode: token2,
        slot
      }
    });

    expect(evaluation.bleMatchStatus).toBe('VERIFIED_BEACON_PROXIMITY');
    expect(evaluation.decisionOutcome).not.toBe('DENY');
    expect(evaluation.unfairMeansFlags).not.toContain('STRICT_BLE_ANCHOR_FAILED');
  });

  test('4. Strict Mode + In Perimeter + Beacon OFF / Missing BLE Proof -> STRICTLY DENIED', async () => {
    const evaluation = await antiSpoofPolicyEngine.evaluateLocationAndEnvironment({
      student: { id: testStudentId, roll_number: 'BEACON_TEST_01', failed_attempts: 0 },
      geofence,
      clientLat: 28.5455,
      clientLon: 77.1930,
      accuracy: 10,
      bleProof: null // Beacon turned off or student out of range
    });

    expect(evaluation.decisionOutcome).toBe('DENY');
    expect(evaluation.bleMatchStatus).toBe('STRICT_BEACON_MISSING');
    expect(evaluation.unfairMeansFlags).toContain('STRICT_BLE_ANCHOR_FAILED');
    expect(evaluation.reasonCodes).toContain('L3_BLE_STRICT_REJECTED');
  });

  test('5. Strict Mode + In Perimeter + Forged / Invalid BLE Code -> STRICTLY DENIED', async () => {
    const evaluation = await antiSpoofPolicyEngine.evaluateLocationAndEnvironment({
      student: { id: testStudentId, roll_number: 'BEACON_TEST_01', failed_attempts: 0 },
      geofence,
      clientLat: 28.5455,
      clientLon: 77.1930,
      accuracy: 10,
      bleProof: {
        beaconPublicId: 'HG-BEACON-BLKA-02',
        rollingCode: 'DEADBEEF', // Fake code
        slot: 12345
      }
    });

    expect(evaluation.decisionOutcome).toBe('DENY');
    expect(evaluation.bleMatchStatus).toBe('INVALID_BEACON_PROOF');
    expect(evaluation.unfairMeansFlags).toContain('STRICT_BLE_ANCHOR_FAILED');
  });

  test('6. Strict Mode + Valid Beacon Token + OUTSIDE Geofence Perimeter -> STRICTLY DENIED (Dual-Lock Guarantee)', async () => {
    const slot = Math.floor(Date.now() / 30000);
    const token2 = bleBeaconService.computeRollingToken(beacon2.shared_secret_ref, beacon2.beacon_public_id, slot);

    // Student is 500m outside the hostel
    const evaluation = await antiSpoofPolicyEngine.evaluateLocationAndEnvironment({
      student: { id: testStudentId, roll_number: 'BEACON_TEST_01', failed_attempts: 0 },
      geofence,
      clientLat: 28.5500, // ~500m away
      clientLon: 77.1930,
      accuracy: 10,
      bleProof: {
        beaconPublicId: 'HG-BEACON-BLKA-02',
        rollingCode: token2,
        slot
      }
    });

    // Dual-Lock: Both Beacon AND Geofence are mandatory. Being outside geofence MUST be DENIED!
    expect(evaluation.decisionOutcome).toBe('DENY');
    expect(evaluation.unfairMeansFlags).toContain('OUTSIDE_HOSTEL_PERIMETER');
    expect(evaluation.reasonCodes).toContain('L2_OUTSIDE_GEOFENCE');
  });

  test('7. /verify-location HTTP Endpoint enforces Strict Beacon Lock with zero unfair strike penalties', async () => {
    const res = await request(app)
      .post('/api/v1/attendance/verify-location')
      .send({
        roll_number: 'BEACON_TEST_01',
        latitude: 28.5455,
        longitude: 77.1930,
        accuracy: 10,
        ble_proof: null // Missing beacon
      });

    expect(res.status).toBe(403);
    expect(res.body.decision).toBe('DENY');
    expect(res.body.reason).toBe('STRICT_BLE_ANCHOR_FAILED');
    expect(res.body.message).toContain('Hardware Bluetooth Beacon');

    // Confirm that beacon outage does not increment strikes on student profile
    const student = await getQuery(`SELECT failed_attempts, is_flagged_forge FROM students WHERE id = ?`, [testStudentId]);
    expect(student.failed_attempts).toBe(0);
    expect(student.is_flagged_forge).toBe(0);
  });

  test('8. Admin dynamically registers Beacon 3 (Block A 2nd Floor) -> System immediately adapts in Strict Mode without restart', async () => {
    const beacon3Id = 'test-beacon-floor-3-uuid';
    const beacon3PublicId = 'HG-BEACON-BLKA-03';
    const beacon3Secret = bleBeaconService.generateBeaconSecret();

    // Insert new 3rd beacon dynamically (simulating Admin Portal "+ Register New ESP32 Beacon")
    await runQuery(`
      INSERT OR REPLACE INTO site_ble_beacons (id, geofence_id, beacon_public_id, shared_secret_ref, block_name, is_active)
      VALUES (?, ?, ?, ?, 'Block A 2nd Floor (Dynamic ESP32)', 1)
    `, [beacon3Id, geofence.id, beacon3PublicId, beacon3Secret]);

    // Fast RAM cache update
    beaconCache.set({
      id: beacon3Id,
      geofence_id: geofence.id,
      beacon_public_id: beacon3PublicId,
      shared_secret_ref: beacon3Secret,
      block_name: 'Block A 2nd Floor (Dynamic ESP32)',
      is_active: 1
    });

    // Compute rolling code for the newly added 3rd beacon
    const slot = Math.floor(Date.now() / 30000);
    const token3 = bleBeaconService.computeRollingToken(beacon3Secret, beacon3PublicId, slot);

    // Verify rolling proof directly
    const proofRes = await bleBeaconService.verifyBleBeaconProof({
      beaconPublicId: beacon3PublicId,
      rollingCode: token3,
      slot
    });
    expect(proofRes.isValid).toBe(true);
    expect(proofRes.beaconPublicId).toBe(beacon3PublicId);
    expect(proofRes.blockName).toBe('Block A 2nd Floor (Dynamic ESP32)');

    // Verify attendance location check in STRICT_REQUIRED mode with Beacon 3
    const evaluation = await antiSpoofPolicyEngine.evaluateLocationAndEnvironment({
      student: { id: testStudentId, roll_number: 'BEACON_TEST_01', failed_attempts: 0 },
      geofence,
      clientLat: 28.5455,
      clientLon: 77.1930,
      accuracy: 10,
      bleProof: {
        beaconPublicId: beacon3PublicId,
        rollingCode: token3,
        slot
      }
    });

    expect(evaluation.decisionOutcome).not.toBe('DENY');
    expect(evaluation.bleMatchStatus).toBe('VERIFIED_BEACON_PROXIMITY');
    expect(evaluation.unfairMeansFlags).not.toContain('STRICT_BLE_ANCHOR_FAILED');

    // Clean up test beacon 3
    await runQuery(`DELETE FROM site_ble_beacons WHERE id = ?`, [beacon3Id]);
    beaconCache.deactivate(beacon3Id);
  });

  test('9. Kill switch revocation on a beacon immediately blocks check-ins in Strict Mode', async () => {
    const beaconRevokeId = 'test-beacon-revoke-uuid';
    const beaconRevokePublicId = 'HG-BEACON-REVOKE-01';
    const secret = bleBeaconService.generateBeaconSecret();

    // Register active beacon
    await runQuery(`
      INSERT OR REPLACE INTO site_ble_beacons (id, geofence_id, beacon_public_id, shared_secret_ref, block_name, is_active)
      VALUES (?, ?, ?, ?, 'Revocation Test Beacon', 1)
    `, [beaconRevokeId, geofence.id, beaconRevokePublicId, secret]);

    beaconCache.set({
      id: beaconRevokeId,
      geofence_id: geofence.id,
      beacon_public_id: beaconRevokePublicId,
      shared_secret_ref: secret,
      block_name: 'Revocation Test Beacon',
      is_active: 1
    });

    const slot = Math.floor(Date.now() / 30000);
    const token = bleBeaconService.computeRollingToken(secret, beaconRevokePublicId, slot);

    // Deactivate beacon via Admin Kill-Switch
    await runQuery(`UPDATE site_ble_beacons SET is_active = 0 WHERE id = ?`, [beaconRevokeId]);
    beaconCache.deactivate(beaconRevokeId);

    // Try check-in with deactivated beacon in STRICT_REQUIRED mode
    const evaluation = await antiSpoofPolicyEngine.evaluateLocationAndEnvironment({
      student: { id: testStudentId, roll_number: 'BEACON_TEST_01', failed_attempts: 0 },
      geofence,
      clientLat: 28.5455,
      clientLon: 77.1930,
      accuracy: 10,
      bleProof: {
        beaconPublicId: beaconRevokePublicId,
        rollingCode: token,
        slot
      }
    });

    expect(evaluation.decisionOutcome).toBe('DENY');
    expect(evaluation.bleMatchStatus).toBe('INVALID_BEACON_PROOF');
    expect(evaluation.unfairMeansFlags).toContain('STRICT_BLE_ANCHOR_FAILED');

    // Clean up
    await runQuery(`DELETE FROM site_ble_beacons WHERE id = ?`, [beaconRevokeId]);
  });

  test('10. Server-Anchored Boot Offset: Calibrates offline Epoch-0 board and rejects replayed historical slots', async () => {
    const offlineBeaconId = 'test-beacon-offline-01';
    const offlinePublicId = 'HG-BEACON-OFFLINE-01';
    const secret = bleBeaconService.generateBeaconSecret();

    await runQuery(`
      INSERT OR REPLACE INTO site_ble_beacons (id, geofence_id, beacon_public_id, shared_secret_ref, block_name, is_active)
      VALUES (?, ?, ?, ?, 'Offline Epoch-0 Beacon', 1)
    `, [offlineBeaconId, geofence.id, offlinePublicId, secret]);

    beaconCache.set({
      id: offlineBeaconId,
      geofence_id: geofence.id,
      beacon_public_id: offlinePublicId,
      shared_secret_ref: secret,
      block_name: 'Offline Epoch-0 Beacon',
      is_active: 1
    });

    // 1. Initial check-in at ESP32 slot 42 (Epoch 0 boot)
    const token42 = bleBeaconService.computeRollingToken(secret, offlinePublicId, 42);
    const initRes = await bleBeaconService.verifyBleBeaconProof({
      beaconPublicId: offlinePublicId,
      rollingCode: token42,
      timestampSlot: 42
    });

    expect(initRes.isValid).toBe(true);
    expect(bleBeaconService.beaconAnchorStates.has(offlinePublicId)).toBe(true);

    // 2. Immediate replay of slot 42 by a student who already used it
    const studentCheckin1 = await bleBeaconService.verifyBleBeaconProof({
      beaconPublicId: offlinePublicId,
      rollingCode: token42,
      timestampSlot: 42,
      studentId: 'STUDENT_TEST_REPLAY'
    });
    expect(studentCheckin1.isValid).toBe(true);

    const replayAttempt = await bleBeaconService.verifyBleBeaconProof({
      beaconPublicId: offlinePublicId,
      rollingCode: token42,
      timestampSlot: 42,
      studentId: 'STUDENT_TEST_REPLAY'
    });
    expect(replayAttempt.isValid).toBe(false);
    expect(replayAttempt.reason).toBe('TOKEN_ALREADY_USED');

    // 3. Attacker captures slot 42 and attempts to replay it while claiming a historical slot
    // Simulate server advancing or an attacker submitting an out-of-window slot (e.g. slot 10 or slot 999)
    const staleSlot = 10;
    const staleToken = bleBeaconService.computeRollingToken(secret, offlinePublicId, staleSlot);
    const staleRes = await bleBeaconService.verifyBleBeaconProof({
      beaconPublicId: offlinePublicId,
      rollingCode: staleToken,
      timestampSlot: staleSlot,
      studentId: 'ATTACKER_01'
    });
    expect(staleRes.isValid).toBe(false);
    expect(staleRes.reason).toBe('ROLLING_CODE_MISMATCH');

    // Clean up
    await runQuery(`DELETE FROM site_ble_beacons WHERE id = ?`, [offlineBeaconId]);
    beaconCache.deactivate(offlineBeaconId);
    bleBeaconService.beaconAnchorStates.delete(offlinePublicId);
  });

  test('11. 5-Second Dynamic Peer Relay QR enables co-presence forwarding for iOS Safari PWA', async () => {
    const slot = Math.floor(Date.now() / 30000);
    const peerToken = bleBeaconService.generatePeerRelayToken(
      beacon1.beacon_public_id,
      beacon1.shared_secret_ref,
      slot,
      'VERIFIED_ANDROID_STUDENT'
    );

    // 1. Roommate with iPhone scans valid peer relay QR
    const verifyPeerRes = await bleBeaconService.verifyPeerRelayProof({
      peerRelayToken: peerToken,
      studentId: 'IPHONE_ROOMMATE_STUDENT'
    });

    expect(verifyPeerRes.isValid).toBe(true);
    expect(verifyPeerRes.isPeerRelay).toBe(true);
    expect(verifyPeerRes.beaconPublicId).toBe(beacon1.beacon_public_id);

    // 2. Attacker tries to reuse the consumed peer relay token
    const duplicateRelay = await bleBeaconService.verifyPeerRelayProof({
      peerRelayToken: peerToken,
      studentId: 'ANOTHER_STUDENT'
    });
    expect(duplicateRelay.isValid).toBe(false);
    expect(duplicateRelay.reason).toBe('PEER_RELAY_ALREADY_USED');

    // 3. Self-relay prevention (student cannot scan their own token)
    const selfToken = bleBeaconService.generatePeerRelayToken(
      beacon1.beacon_public_id,
      beacon1.shared_secret_ref,
      slot,
      'SELF_STUDENT'
    );
    const selfRes = await bleBeaconService.verifyPeerRelayProof({
      peerRelayToken: selfToken,
      studentId: 'SELF_STUDENT'
    });
    expect(selfRes.isValid).toBe(false);
    expect(selfRes.reason).toBe('SELF_RELAY_PROHIBITED');
  });

  test('12. Genuine iOS Silent Attestation (Apple GPU + in geofence) passes Layer 2 in STRICT_REQUIRED', async () => {
    const evaluation = await antiSpoofPolicyEngine.evaluateLocationAndEnvironment({
      student: { id: testStudentId, roll_number: 'BEACON_TEST_01', failed_attempts: 0 },
      geofence,
      clientLat: 28.5455,
      clientLon: 77.1930,
      accuracy: 10,
      bleProof: {
        channel: 'IOS_SILENT_HARDWARE_ATTESTED',
        isIosSilentAttested: true,
        gpuRenderer: 'Apple GPU',
        altitude: 215.4,
        altitudeAccuracy: 3.2,
        maxTouchPoints: 5
      },
      deviceInfo: {
        isIOS: true,
        gpuRenderer: 'Apple GPU'
      }
    });

    expect(evaluation.bleMatchStatus).toBe('VERIFIED_IOS_HARDWARE_ATTESTED');
    expect(evaluation.decisionOutcome).not.toBe('DENY');
    expect(evaluation.unfairMeansFlags).not.toContain('STRICT_BLE_ANCHOR_FAILED');
  });

  test('13. Spoofed iOS User-Agent from Android (Adreno/Mali GPU) is REJECTED', async () => {
    const evaluation = await antiSpoofPolicyEngine.evaluateLocationAndEnvironment({
      student: { id: testStudentId, roll_number: 'BEACON_TEST_01', failed_attempts: 0 },
      geofence,
      clientLat: 28.5455,
      clientLon: 77.1930,
      accuracy: 10,
      bleProof: {
        channel: 'IOS_SILENT_HARDWARE_ATTESTED',
        isIosSilentAttested: true,
        gpuRenderer: 'Adreno (TM) 730', // Android GPU spoofing iOS User-Agent
        maxTouchPoints: 5
      },
      deviceInfo: {
        isIOS: true,
        gpuRenderer: 'Adreno (TM) 730'
      }
    });

    expect(evaluation.bleMatchStatus).toBe('IOS_HARDWARE_ATTESTATION_FAILED');
    expect(evaluation.decisionOutcome).toBe('DENY');
    expect(evaluation.unfairMeansFlags).toContain('SPOOFED_IOS_USER_AGENT');
  });
});
