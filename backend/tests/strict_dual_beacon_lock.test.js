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

    // 3. Set active geofence to STRICT_REQUIRED
    await runQuery(`
      UPDATE geofence_configs
      SET ble_mode = 'STRICT_REQUIRED', is_active = 1, latitude = 28.5455, longitude = 77.1930, radius_meters = 50
      WHERE is_active = 1
    `);
    geofence = await getQuery(`SELECT * FROM geofence_configs WHERE is_active = 1 LIMIT 1`);
  });

  afterAll(async () => {
    // Restore default configuration
    await runQuery(`UPDATE geofence_configs SET ble_mode = 'STANDBY_OPTIONAL' WHERE is_active = 1`);
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
});
