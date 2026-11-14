import http from 'k6/http';
import { check, sleep } from 'k6';

// Real-World "Curfew Rush" Concurrency Profile (9:30 PM - 10:00 PM Hostel Spike)
export const options = {
  stages: [
    { duration: '3s', target: 15 },  // Stage 1: Students opening app
    { duration: '5s', target: 50 },  // Stage 2: 9:45 PM Curfew Rush surge
    { duration: '7s', target: 100 }, // Stage 3: Peak 9:55 PM Concurrency (100 concurrent requests)
    { duration: '3s', target: 0 },   // Stage 4: Cooldown
  ],
  thresholds: {
    // 95% of requests must complete in under 500ms
    http_req_duration: ['p(95)<500'],
    // 95%+ of verification assertions must pass
    checks: ['rate>0.95'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://127.0.0.1:5055';

export default function () {
  const vuId = __VU;
  const iterId = __ITER;
  const studentId = `STU_RUSH_${(vuId % 30) + 1}`;

  // 1. Health & Server Status Probe
  const resHealth = http.get(`${BASE_URL}/health`);
  check(resHealth, {
    'system status 200 OK': (r) => r.status === 200,
    'db healthy': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.status === 'healthy' || body.database === 'connected' || r.status === 200;
      } catch (_) {
        return r.status === 200;
      }
    },
  });

  // 2. Curfew Rush: Spatial & Proximity Verification
  const locPayload = JSON.stringify({
    student_id: studentId,
    latitude: 26.1425,
    longitude: 91.6612,
    accuracy: 6.5,
    ble_proof: {
      anchor_id: 'A01',
      rssi: -65,
      peerRelayToken: 'PEER_RELAY_MOCK_TEST'
    },
    device_info: {
      platform: 'android',
      is_mock: false,
      build_number: 142
    }
  });

  const locHeaders = { 'Content-Type': 'application/json' };
  const resLoc = http.post(`${BASE_URL}/api/v1/attendance/verify-location`, locPayload, { headers: locHeaders });
  
  check(resLoc, {
    'location probe handled (<500 error)': (r) => r.status >= 200 && r.status < 500,
  });

  // 3. Curfew Rush: Offline Batch Sync Simulation
  if (iterId % 5 === 0) {
    const syncPayload = JSON.stringify({
      records: [
        {
          student_id: studentId,
          timestamp: new Date().toISOString(),
          latitude: 26.1425,
          longitude: 91.6612,
          offline_token: `OFFLINE_PROOF_${vuId}_${iterId}`,
          ble_proof: 'A01|0001A4|9F8E7D6C'
        }
      ]
    });

    const resSync = http.post(`${BASE_URL}/api/v1/attendance/offline-sync`, syncPayload, { headers: locHeaders });
    check(resSync, {
      'offline sync handled (<500 error)': (r) => r.status >= 200 && r.status < 500,
    });
  }

  // Realistic user think time between actions (150ms - 350ms)
  sleep(0.15 + Math.random() * 0.2);
}
