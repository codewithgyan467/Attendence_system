const request = require('supertest');
const { app } = require('../src/server');
const { runQuery, getQuery } = require('../src/db/database');
const wifiClusterService = require('../src/services/wifiClusterService');
const antiSpoofPolicyEngine = require('../src/services/antiSpoofPolicyEngine');
const bleBeaconService = require('../src/services/bleBeaconService');

describe('HostelGuard Enterprise v3.4: Multi-Router Strict Lock Cluster & Multitasking ESP32 Gateway Integration', () => {
  const SECRET = 'hostelguard_super_secret_32b_key';
  const BEACON_1 = 'HG-BEACON-BLKA-01';
  const BEACON_2 = 'HG-BEACON-BLKA-02';
  let geofence;
  let testStudent;

  beforeAll(async () => {
    // 1. Ensure test student exists
    const existing = await getQuery(`SELECT * FROM students WHERE roll_number = 'CLUSTER_TEST_01'`);
    if (!existing) {
      await runQuery(`
        INSERT INTO students (id, roll_number, full_name, hostel_block, room_number, course, admission_year, semester, device_id, face_enrollment_status, failed_attempts, is_flagged_forge)
        VALUES ('cluster-test-student-uuid', 'CLUSTER_TEST_01', 'Cluster Test Student', 'Block A', '101', 'B.Tech CSE', 2024, 4, 'DEV_CLUSTER_TEST', 'ENROLLED', 0, 0)
      `);
      testStudent = await getQuery(`SELECT * FROM students WHERE roll_number = 'CLUSTER_TEST_01'`);
    } else {
      testStudent = existing;
      await runQuery(`UPDATE students SET failed_attempts = 0, is_flagged_forge = 0 WHERE id = ?`, [testStudent.id]);
    }

    // 2. Setup geofence in STRICT_REQUIRED mode
    await runQuery(`
      UPDATE geofence_configs
      SET ble_mode = 'STRICT_REQUIRED', is_active = 1, latitude = 28.5455, longitude = 77.1930, radius_meters = 150
      WHERE is_active = 1
    `);
    geofence = await getQuery(`SELECT * FROM geofence_configs WHERE is_active = 1 LIMIT 1`);
  });

  afterAll(async () => {
    await runQuery(`UPDATE geofence_configs SET ble_mode = 'STRICT_REQUIRED', latitude = 26.140462, longitude = 91.656606, radius_meters = 150.0 WHERE is_active = 1`);
    await runQuery(`DELETE FROM students WHERE roll_number = 'CLUSTER_TEST_01'`);
  });

  test('1. ESP32 Floor 1 Gateway sends periodic heartbeat with HMAC signature -> Registered in Cluster', async () => {
    const slot = Math.floor(Date.now() / 30000);
    const localIp = '192.168.1.50';
    const sig = wifiClusterService.computeRollingToken(SECRET, BEACON_1, slot, localIp);

    const res = await request(app)
      .post('/api/admin/wifi-cluster/esp32-heartbeat')
      .send({
        beaconId: BEACON_1,
        shortName: 'HG-A01',
        floor: 1,
        ssid: 'Hostel_Floor1_WiFi',
        localIp,
        slot,
        signature: sig
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.gateway.beaconId).toBe(BEACON_1);
    expect(res.body.gateway.floor).toBe(1);
    expect(res.body.gateway.status).toBe('ONLINE');
    expect(wifiClusterService.activeGateways.has(BEACON_1)).toBe(true);
  });

  test('2. Heartbeat with forged / incorrect signature is strictly rejected', async () => {
    const slot = Math.floor(Date.now() / 30000);

    const res = await request(app)
      .post('/api/admin/wifi-cluster/esp32-heartbeat')
      .send({
        beaconId: BEACON_1,
        shortName: 'HG-A01',
        floor: 1,
        ssid: 'Hostel_Floor1_WiFi',
        localIp: '192.168.1.50',
        slot,
        signature: 'deadbeef' // Tampered signature
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Invalid ESP32 heartbeat HMAC signature');
  });

  test('3. Multi-Router Registration: Floor 2 Gateway registers on a separate router subnet', async () => {
    const slot = Math.floor(Date.now() / 30000);
    const localIp = '192.168.2.50';
    const sig = wifiClusterService.computeRollingToken(SECRET, BEACON_2, slot, localIp);

    const res = await request(app)
      .post('/api/admin/wifi-cluster/esp32-heartbeat')
      .send({
        beaconId: BEACON_2,
        shortName: 'HG-A02',
        floor: 2,
        ssid: 'Hostel_Floor2_WiFi',
        localIp,
        slot,
        signature: sig
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(wifiClusterService.activeGateways.size).toBeGreaterThanOrEqual(2);
  });

  test('4. GET /api/admin/wifi-cluster/status returns multi-router health and online gateway count', async () => {
    const res = await request(app).get('/api/admin/wifi-cluster/status');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.onlineGateways).toBeGreaterThanOrEqual(2);
    expect(res.body.isStrictLock).toBe(true);
    expect(Array.isArray(res.body.gateways)).toBe(true);
  });

  test('5. GET /api/admin/wifi-cluster/endpoints returns active LAN handshake URLs for both routers', async () => {
    const res = await request(app).get('/api/admin/wifi-cluster/endpoints');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBeGreaterThanOrEqual(2);
    expect(res.body.endpoints[0].handshakeUrl).toContain('/lan-handshake');
  });

  test('6. Student connects to Floor 1 Wi-Fi, receives valid LAN Ticket -> Passes Strict Mode Check-In', async () => {
    const slot = Math.floor(Date.now() / 30000);
    const clientLanIp = '192.168.1.105';
    const lanSig = wifiClusterService.computeRollingToken(SECRET, BEACON_1, slot, clientLanIp);
    const ticket = `${BEACON_1}|1|${clientLanIp}|${slot}|${lanSig}`;

    // Verify through policy engine
    const evaluation = await antiSpoofPolicyEngine.evaluateLocationAndEnvironment({
      student: testStudent,
      geofence,
      clientLat: 28.5455,
      clientLon: 77.1930,
      accuracy: 10,
      bleProof: {
        channel: 'LAN_WIFI_HANDSHAKE',
        lanWifiTicket: ticket
      }
    });

    expect(evaluation.bleMatchStatus).toBe('VERIFIED_LAN_WIFI_PROXIMITY');
    expect(evaluation.decisionOutcome).not.toBe('DENY');
    expect(evaluation.unfairMeansFlags).not.toContain('STRICT_WIFI_CLUSTER_FAILED');
    expect(evaluation.unfairMeansFlags).not.toContain('STRICT_BLE_ANCHOR_FAILED');
  });

  test('7. Anti-Replay Prevention: Replaying the exact same LAN Wi-Fi Ticket is blocked', async () => {
    const slot = Math.floor(Date.now() / 30000);
    const clientLanIp = '192.168.1.105';
    const lanSig = wifiClusterService.computeRollingToken(SECRET, BEACON_1, slot, clientLanIp);
    const ticket = `${BEACON_1}|1|${clientLanIp}|${slot}|${lanSig}`;

    // First attempt already consumed ticket in Test 6, second attempt must be rejected
    const verifyRes = await wifiClusterService.verifyLanWifiTicket(ticket);
    expect(verifyRes.isValid).toBe(false);
    expect(verifyRes.reason).toBe('LAN_TICKET_ALREADY_USED');
  });

  test('8. Tampering Prevention: Tampering with Client LAN IP without valid signature is rejected', async () => {
    const slot = Math.floor(Date.now() / 30000);
    const legitimateIp = '192.168.1.105';
    const attackerIp = '192.168.1.199'; // Tampered IP
    const lanSig = wifiClusterService.computeRollingToken(SECRET, BEACON_1, slot, legitimateIp);
    const tamperedTicket = `${BEACON_1}|1|${attackerIp}|${slot}|${lanSig}`;

    const verifyRes = await wifiClusterService.verifyLanWifiTicket(tamperedTicket);
    expect(verifyRes.isValid).toBe(false);
    expect(verifyRes.reason).toBe('INVALID_LAN_WIFI_SIGNATURE');
  });

  test('9. Expired Ticket: Ticket with historical slot outside window (+/- 2 slots) is rejected', async () => {
    const oldSlot = Math.floor(Date.now() / 30000) - 10; // 5 minutes ago
    const clientLanIp = '192.168.1.110';
    const lanSig = wifiClusterService.computeRollingToken(SECRET, BEACON_1, oldSlot, clientLanIp);
    const staleTicket = `${BEACON_1}|1|${clientLanIp}|${oldSlot}|${lanSig}`;

    const verifyRes = await wifiClusterService.verifyLanWifiTicket(staleTicket);
    expect(verifyRes.isValid).toBe(false);
    expect(verifyRes.reason).toBe('LAN_TICKET_EXPIRED');
  });

  test('10. Multi-Router Failover: Student on Floor 2 router presents Floor 2 ticket -> Passes seamlessly', async () => {
    const slot = Math.floor(Date.now() / 30000);
    const clientLanIp = '192.168.2.115';
    const lanSig = wifiClusterService.computeRollingToken(SECRET, BEACON_2, slot, clientLanIp);
    const floor2Ticket = `${BEACON_2}|2|${clientLanIp}|${slot}|${lanSig}`;

    const evaluation = await antiSpoofPolicyEngine.evaluateLocationAndEnvironment({
      student: testStudent,
      geofence,
      clientLat: 28.5455,
      clientLon: 77.1930,
      accuracy: 10,
      bleProof: {
        channel: 'LAN_WIFI_HANDSHAKE',
        lanWifiTicket: floor2Ticket
      }
    });

    expect(evaluation.bleMatchStatus).toBe('VERIFIED_LAN_WIFI_PROXIMITY');
    expect(evaluation.decisionOutcome).not.toBe('DENY');
  });

  test('11. Mode Preservation: STANDBY_OPTIONAL mode allows online check-in with zero hardware penalty', async () => {
    const standbyGeo = { ...geofence, ble_mode: 'STANDBY_OPTIONAL' };

    const evaluation = await antiSpoofPolicyEngine.evaluateLocationAndEnvironment({
      student: testStudent,
      geofence: standbyGeo,
      clientLat: 28.5455,
      clientLon: 77.1930,
      accuracy: 10,
      bleProof: null // No BLE and no Wi-Fi ticket
    });

    expect(evaluation.bleMatchStatus).toBe('STANDBY_NOT_REQUIRED');
    expect(evaluation.decisionOutcome).not.toBe('DENY');
  });

  test('12. Mode Preservation: SOFT_ANCHOR mode triggers photometric step-up without denying student', async () => {
    const softGeo = { ...geofence, ble_mode: 'SOFT_ANCHOR' };

    const evaluation = await antiSpoofPolicyEngine.evaluateLocationAndEnvironment({
      student: testStudent,
      geofence: softGeo,
      clientLat: 28.5455,
      clientLon: 77.1930,
      accuracy: 10,
      bleProof: null // No BLE and no Wi-Fi ticket
    });

    expect(evaluation.requiresStepUp).toBe(true);
    expect(evaluation.decisionOutcome).toBe('STEP_UP');
  });

  test('13. Mode Preservation: STRICT_REQUIRED mode blocks student on cellular data lacking BLE/Wi-Fi ticket', async () => {
    const evaluation = await antiSpoofPolicyEngine.evaluateLocationAndEnvironment({
      student: testStudent,
      geofence,
      clientLat: 28.5455,
      clientLon: 77.1930,
      accuracy: 10,
      bleProof: null // Remote student on mobile cellular data attempting check-in
    });

    expect(evaluation.bleMatchStatus).toBe('STRICT_BEACON_MISSING');
    expect(evaluation.decisionOutcome).toBe('DENY');
    expect(evaluation.unfairMeansFlags).toContain('STRICT_BLE_ANCHOR_FAILED');
  });
});
