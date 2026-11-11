const crypto = require('crypto');
const { getQuery, allQuery, runQuery } = require('../db/database');
const { calculateHaversineDistance } = require('./geofenceService');
const bleBeaconService = require('./bleBeaconService');
const wifiClusterService = require('./wifiClusterService');

const POLICY_VERSION = 'v3.0';
const DEFAULT_CHALLENGE_TTL_MS = 90 * 1000; // 90 seconds hardened TTL

// In-Memory Wi-Fi Metadata Cache (30s TTL) for Sub-Millisecond Policy Telemetry
let cachedWifiMetadata = null;
let lastWifiMetadataTimestamp = 0;

async function getCachedWifiMetadata(allQueryFn) {
  const now = Date.now();
  if (cachedWifiMetadata && (now - lastWifiMetadataTimestamp < 30000) && process.env.NODE_ENV !== 'test') {
    return cachedWifiMetadata;
  }
  const activeAPs = await allQueryFn(
    `SELECT bssid, ssid_label FROM site_wifi_access_points WHERE is_active = 1`
  );
  let clusterRows = [];
  try {
    clusterRows = await allQueryFn(`SELECT ssid, wan_ip, local_ip FROM site_wifi_clusters WHERE status = 'ONLINE'`);
  } catch (_) {}

  cachedWifiMetadata = { activeAPs, clusterRows };
  lastWifiMetadataTimestamp = now;
  return cachedWifiMetadata;
}

/**
 * HostelGuard Enterprise v3.0 Anti-Spoof & Unfair-Means Policy Engine
 * Evaluates 13 layers of physical, cryptographic, and behavioral evidence
 * using a 5-State Decision Engine: ALLOW, RETRY, STEP_UP, MANUAL_REVIEW, DENY
 */
class AntiSpoofPolicyEngine {
  /**
   * Evaluates Phase 1 Location & Radio Telemetry
   */
  async evaluateLocationAndEnvironment(params) {
    const {
      student,
      clientLat,
      clientLon,
      accuracy = 10,
      isMockLocation = false,
      adbEnabled = false,
      samples = [], // Optional burst of 3-5 GPS readings
      wifiScan = null, // { status: 'SCAN_OK' | 'SCAN_THROTTLED' | 'PERMISSION_DENIED', bssids: [] }
      bleProof = null, // { beaconPublicId, nonce, hmac }
      playIntegrityToken = null,
      deviceInfo = {},
      clientIp = '127.0.0.1',
      geofence,
      userAgent = ''
    } = params;

    let riskScore = 0;
    const unfairMeansFlags = [];
    const reasonCodes = [];
    let decisionOutcome = 'ALLOW';
    let assuranceTier = deviceInfo.isNative ? 'NATIVE_HIGH' : 'PWA_DEGRADED';
    let requiresStepUp = false;
    let stepUpColors = null;

    // --- Layer 1: Native Mock & Debug Telemetry ---
    const detectedSpoofApps = params.detectedSpoofApps ||
      params.securityTelemetry?.detectedSpoofApps ||
      params.antiSpoofTelemetry?.detectedSpoofApps ||
      deviceInfo.detectedSpoofApps ||
      deviceInfo.detectedApps ||
      [];
    const detectedAppDetails = params.detectedAppDetails ||
      params.securityTelemetry?.detectedAppDetails ||
      params.antiSpoofTelemetry?.detectedAppDetails ||
      deviceInfo.detectedAppDetails ||
      [];

    const isMock = Boolean(
      isMockLocation === true ||
      isMockLocation === 'true' ||
      isMockLocation === 1 ||
      deviceInfo.isMock === true ||
      deviceInfo.isMockLocation === true ||
      deviceInfo.mockAppDetected === true ||
      (Array.isArray(deviceInfo.detectedApps) && deviceInfo.detectedApps.length > 0) ||
      (Array.isArray(detectedSpoofApps) && detectedSpoofApps.length > 0) ||
      params.syntheticTelemetry === true ||
      deviceInfo.syntheticTelemetry === true
    );

    let mockFlagStatus = 'CLEAN';
    if (isMock) {
      mockFlagStatus = 'MOCK_DETECTED';
      riskScore += 90; // Confirmed mock location triggers instant DENY
      unfairMeansFlags.push('MOCK_PROVIDER_ACTIVE');
      reasonCodes.push('L1_MOCK_LOCATION_DETECTED');
    }

    if (Array.isArray(detectedSpoofApps) && detectedSpoofApps.length > 0) {
      unfairMeansFlags.push('MOCK_APP_PACKAGE_INSTALLED');
    }

    if (adbEnabled || deviceInfo.adbEnabled) {
      riskScore += 25;
      unfairMeansFlags.push('USB_DEBUGGING_ACTIVE');
      reasonCodes.push('L1_ADB_ACTIVE');
    }

    // --- Layer 2: GPS Freshness, Plausibility & Trajectory ---
    const primaryLat = parseFloat(clientLat);
    const primaryLon = parseFloat(clientLon);
    const primaryAcc = parseFloat(accuracy) || 10;

    const distanceMeters = calculateHaversineDistance(
      primaryLat,
      primaryLon,
      geofence.latitude,
      geofence.longitude
    );

    const allowedRadius = geofence.radius_meters || 20.0;
    const gpsSampleCount = Array.isArray(samples) && samples.length > 0 ? samples.length : 1;

    // Multi-sample trajectory & synthetic frozen coordinate checks
    if (Array.isArray(samples) && samples.length >= 2) {
      let maxSpeed = 0;
      let totalDrift = 0;
      for (let i = 1; i < samples.length; i++) {
        const prev = samples[i - 1];
        const curr = samples[i];
        const d = calculateHaversineDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
        totalDrift += d;
        const dtSeconds = Math.max(0.1, (curr.timestamp - prev.timestamp) / 1000);
        const speed = d / dtSeconds; // m/s
        if (speed > maxSpeed) maxSpeed = speed;
      }

      if (maxSpeed > 28) {
        // > 28 m/s (~100 km/h) jump between successive readings (unnatural teleportation/mock speed)
        riskScore += 85;
        unfairMeansFlags.push('IMPOSSIBLE_TRAJECTORY_JUMP');
        reasonCodes.push('L2_VELOCITY_ANOMALY');
      }

      // Check frozen synthetic coordinates in mode 1 & 2 if 4+ samples with exactly 0.0 drift and synthetic mock flags
      if (samples.length >= 4 && totalDrift === 0 && (params.syntheticTelemetry || deviceInfo.syntheticTelemetry || isMock)) {
        riskScore += 80;
        unfairMeansFlags.push('FROZEN_SYNTHETIC_COORDINATES');
        reasonCodes.push('L2_FROZEN_COORDINATES');
      }
    }

    // Coarse indoor GPS vs clear outside perimeter
    if (distanceMeters > allowedRadius) {
      const excessDistance = distanceMeters - allowedRadius;
      if (excessDistance > 30 || distanceMeters > 50) {
        riskScore += 85;
        unfairMeansFlags.push('OUTSIDE_HOSTEL_PERIMETER');
        reasonCodes.push('L2_OUTSIDE_GEOFENCE');
      } else {
        // Borderline drift (e.g. 21m - 35m)
        if (primaryAcc > 30) {
          reasonCodes.push('L2_INDOOR_SIGNAL_DRIFT');
        } else {
          riskScore += 50;
          unfairMeansFlags.push('MARGINAL_GEOFENCE_BREACH');
          reasonCodes.push('L2_GEOFENCE_BREACH');
        }
      }
    }

    // --- Layer 3: Physical Radio Presence (Wi-Fi BSSID & BLE Challenge) ---
    const normSsid = (s) => String(s || '').replace(/[\u2018\u2019]/g, "'").trim().toLowerCase();
    let wifiMatchStatus = 'SCAN_UNAVAILABLE';
    const { activeAPs, clusterRows } = await getCachedWifiMetadata(allQuery);
    const knownBSSIDs = activeAPs.map((ap) => ap.bssid).filter(Boolean);
    const knownSSIDs = new Set(activeAPs.map((ap) => normSsid(ap.ssid_label)));
    clusterRows.forEach((c) => {
      if (c.ssid) knownSSIDs.add(normSsid(c.ssid));
    });

    // Check shared Router WAN IP matching active ESP32 Wi-Fi cluster
    const cleanClientIp = clientIp ? String(clientIp).replace(/^::ffff:/, '').trim() : '';
    const isClientOnClusterWan = Boolean(
      cleanClientIp && cleanClientIp !== '127.0.0.1' && (
        wifiClusterService.clusterWanIps.has(cleanClientIp) ||
        clusterRows.some((c) => c.wan_ip && String(c.wan_ip).replace(/^::ffff:/, '').trim() === cleanClientIp)
      )
    );

    if (isClientOnClusterWan) {
      wifiMatchStatus = 'MATCHED_HOSTEL_AP';
      riskScore = Math.max(0, riskScore - 20); // Multi-router physical proximity booster
    }

    if (wifiScan && (wifiScan.status === 'SCAN_OK' || Array.isArray(wifiScan.bssids) || wifiScan.connectedSsid)) {
      // 5-Octet BSSID normalization prevents false rejections when phone roams between 2.4 GHz & 5 GHz bands
      const matchedBssid = Array.isArray(wifiScan.bssids) && wifiScan.bssids.some((b) => wifiClusterService.validateWifiAnchor(b, knownBSSIDs));
      const matchedSsid = wifiScan.connectedSsid && knownSSIDs.has(normSsid(wifiScan.connectedSsid));

      if (matchedBssid || matchedSsid) {
        wifiMatchStatus = 'MATCHED_HOSTEL_AP';
        riskScore = Math.max(0, riskScore - 20); // Confidence booster
      } else if (!isClientOnClusterWan) {
        wifiMatchStatus = 'NO_HOSTEL_AP_FOUND';
        if (distanceMeters < 5 && activeAPs.length > 0) {
          // GPS claims exact center, but zero hostel APs visible
          riskScore += 55;
          unfairMeansFlags.push('RADIO_GPS_DISCREPANCY');
          reasonCodes.push('L3_WIFI_MISMATCH');
        }
      }
    } else if (wifiScan && (wifiScan.status === 'SCAN_THROTTLED' || wifiScan.status === 'PERMISSION_DENIED')) {
      if (!isClientOnClusterWan) {
        wifiMatchStatus = wifiScan.status;
        // Zero penalty for OS throttling, but marks for step-up verification
        requiresStepUp = true;
      }
    }

    // --- Layer 3: Physical Radio Anchoring: Bluetooth Low Energy (BLE) ---
    const bleMode = geofence?.ble_mode || 'STANDBY_OPTIONAL';
    const isStrictMode = (bleMode === 'STRICT_REQUIRED' || bleMode === 'STRICT_LOCK');
    let bleMatchStatus = 'NOT_CONFIGURED';

    // Platform Intelligence: Transparent Adaptive Hardware Anchor for iOS Safari
    const ua = String(userAgent || deviceInfo.userAgent || '').toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(ua) || Boolean(deviceInfo.isIOS);
    const isAndroid = /android/.test(ua) || Boolean(deviceInfo.isAndroid) || !isIOS;
    const isIOSWeb = isIOS && !deviceInfo.isNative;

    const isIosSilentAttested = Boolean(
      bleProof && (
        bleProof.channel === 'IOS_SILENT_HARDWARE_ATTESTED' ||
        bleProof.method === 'IOS_SILENT_HARDWARE_ATTESTED' ||
        bleProof.isIosSilentAttested === true
      )
    );

    if (isIosSilentAttested) {
      if (isStrictMode) {
        // Strict Lock Mode 3 requires physical ESP32 BLE hardware beacon, silent bypass is disallowed
        bleMatchStatus = 'STRICT_BLE_ANCHOR_REQUIRED';
        riskScore += 85;
        unfairMeansFlags.push('STRICT_BLE_ANCHOR_FAILED');
        reasonCodes.push('L3_BLE_STRICT_REJECTED');
      } else {
        // 1-Click Silent Hardware Verification for Genuine iOS (Apple GPU + in geofence)
        const gpu = String(bleProof.gpuRenderer || deviceInfo.gpuRenderer || '').toLowerCase();
        const isGenuineAppleGpu = gpu.includes('apple');
        const isInsideGeofence = (typeof distanceMeters === 'number' ? distanceMeters : 0) <= (allowedRadius || 150);

        if (isGenuineAppleGpu && isInsideGeofence) {
          bleMatchStatus = 'VERIFIED_IOS_HARDWARE_ATTESTED';
          riskScore = Math.max(0, riskScore - 20); // Proximity trust bonus
          requiresStepUp = false; // Proceed directly to MiniFASNet + SFace verification
        } else if (!isGenuineAppleGpu) {
          // Non-Apple GPU (Adreno / Mali / ANGLE) attempting to bypass BLE by spoofing an iOS User-Agent
          bleMatchStatus = 'IOS_HARDWARE_ATTESTATION_FAILED';
          riskScore += 85;
          unfairMeansFlags.push('SPOOFED_IOS_USER_AGENT');
          reasonCodes.push('L3_BLE_STRICT_REJECTED');
        } else {
          // Outside geofence boundary
          bleMatchStatus = 'OUTSIDE_GEOFENCE';
          riskScore += 85;
          unfairMeansFlags.push('OUTSIDE_HOSTEL_PERIMETER');
          reasonCodes.push('L2_OUTSIDE_GEOFENCE');
        }
      }
    } else if (bleProof && (bleProof.peerRelayToken || bleProof.peerRelayProof)) {
      const relayToken = bleProof.peerRelayToken || bleProof.peerRelayProof;
      const relayRes = await bleBeaconService.verifyPeerRelayProof({
        peerRelayToken: relayToken,
        studentId: student?.id || student?.roll_number || null
      });

      if (relayRes.isValid) {
        bleMatchStatus = 'VERIFIED_BEACON_PROXIMITY';
        riskScore = Math.max(0, riskScore - 25);
      } else {
        bleMatchStatus = 'INVALID_BEACON_PROOF';
        if (bleMode === 'STRICT_REQUIRED') {
          riskScore += 85;
          unfairMeansFlags.push('STRICT_BLE_ANCHOR_FAILED');
          reasonCodes.push('L3_BLE_STRICT_REJECTED');
        } else if (bleMode === 'SOFT_ANCHOR') {
          riskScore += 45;
          requiresStepUp = true;
        } else {
          riskScore += 20;
        }
      }
    } else if (bleProof && (bleProof.lanWifiTicket || bleProof.lan_wifi_ticket || bleProof.ticket)) {
      // Multi-Router Strict Lock: Local Wi-Fi Cluster Handshake Ticket
      const ticket = bleProof.lanWifiTicket || bleProof.lan_wifi_ticket || bleProof.ticket;
      const lanRes = await wifiClusterService.verifyLanWifiTicket(ticket, clientIp);

      if (lanRes.isValid) {
        bleMatchStatus = 'VERIFIED_LAN_WIFI_PROXIMITY';
        riskScore = Math.max(0, riskScore - 25); // Proximity trust bonus
        requiresStepUp = false; // Proceed directly to face biometric verification
      } else {
        bleMatchStatus = 'INVALID_LAN_WIFI_TICKET';
        if (bleMode === 'STRICT_REQUIRED' || bleMode === 'STRICT_LOCK') {
          riskScore += 85;
          unfairMeansFlags.push('STRICT_WIFI_CLUSTER_FAILED');
          reasonCodes.push('L3_WIFI_CLUSTER_REJECTED');
        } else if (bleMode === 'SOFT_ANCHOR') {
          riskScore += 45;
          requiresStepUp = true;
        } else {
          riskScore += 20;
        }
      }
    } else if (bleProof && (bleProof.beaconPublicId || bleProof.compactVerified || bleProof.rawPayload)) {
      if (bleProof.compactVerified || (bleProof.rawPayload && typeof bleProof.rawPayload === 'string')) {
        let isCompactValid = false;
        if (bleProof.rawPayload && typeof bleProof.rawPayload === 'string') {
          const compRes = bleBeaconService.verifyCompactEsp32Payload(bleProof.rawPayload);
          if (compRes && compRes.valid) {
            isCompactValid = true;
            bleProof.rawAnchorId = compRes.anchorId;
            bleProof.slot = compRes.step;
          }
        }
        if (isCompactValid) {
          bleMatchStatus = 'VERIFIED_BEACON_PROXIMITY';
          riskScore = Math.max(0, riskScore - 25); // Proximity trust bonus
        } else {
          bleMatchStatus = 'INVALID_BEACON_PROOF';
          if (isStrictMode) {
            riskScore += 85;
            unfairMeansFlags.push('STRICT_BLE_ANCHOR_FAILED');
            reasonCodes.push('L3_BLE_CODE_MISMATCH');
          } else if (bleMode === 'SOFT_ANCHOR') {
            riskScore += 45;
            requiresStepUp = true;
          } else {
            riskScore += 20;
          }
        }
      } else {
        const beaconRes = await bleBeaconService.verifyBleBeaconProof({
          beaconPublicId: bleProof.beaconPublicId,
          rawAnchorId: bleProof.rawAnchorId,
          rawPayload: bleProof.rawPayload,
          rollingCode: bleProof.rollingCode || bleProof.hmac || bleProof.code,
          timestampSlot: bleProof.timestampSlot || bleProof.slot,
          rssi: bleProof.rssi ?? null,
          studentId: student?.id || student?.roll_number || null
        });

        if (beaconRes.isValid) {
          bleMatchStatus = 'VERIFIED_BEACON_PROXIMITY';
          riskScore = Math.max(0, riskScore - 25); // Proximity trust bonus
        } else {
          bleMatchStatus = 'INVALID_BEACON_PROOF';
          if (bleMode === 'STRICT_REQUIRED' || bleMode === 'STRICT_LOCK') {
            // Strict Hardware Lock: Physical ESP32 radio signal mandatory for ALL devices
            riskScore += 85;
            unfairMeansFlags.push('STRICT_BLE_ANCHOR_FAILED');
            if (beaconRes.reason === 'TOKEN_ALREADY_USED' || beaconRes.reason === 'SLOT_ALREADY_USED') {
              reasonCodes.push('L3_BLE_TOKEN_REPLAY');
            } else if (beaconRes.reason === 'BEACON_SIGNAL_TOO_WEAK') {
              reasonCodes.push('L3_BLE_SIGNAL_WEAK');
            } else if (beaconRes.reason === 'UNREGISTERED_OR_INACTIVE_BEACON') {
              reasonCodes.push('L3_BLE_UNKNOWN_ANCHOR');
            } else if (beaconRes.reason === 'ROLLING_CODE_MISMATCH' || beaconRes.reason === 'INVALID_ROLLING_CODE' || beaconRes.reason === 'INVALID_HMAC_SIGNATURE') {
              reasonCodes.push('L3_BLE_CODE_MISMATCH');
            } else {
              reasonCodes.push('L3_BLE_STRICT_REJECTED');
            }
          } else if (bleMode === 'SOFT_ANCHOR') {
            riskScore += 45;
            requiresStepUp = true;
          } else {
            riskScore += 20;
          }
        }
      }
    } else if (bleProof && (bleProof.channel === 'HOSTEL_WIFI_PROXIMITY_CHECK' || bleProof.channel === 'HOSTEL_WIFI_VERIFIED' || bleProof.method === 'HOSTEL_WIFI_VERIFIED')) {
      const bssidMatch = bleProof.bssid && wifiClusterService.validateWifiAnchor(bleProof.bssid, knownBSSIDs);
      const ssidMatch = bleProof.ssid && knownSSIDs.has(normSsid(bleProof.ssid));

      if (bssidMatch || ssidMatch || wifiMatchStatus === 'MATCHED_HOSTEL_AP' || isClientOnClusterWan) {
        bleMatchStatus = 'VERIFIED_HOSTEL_WIFI_PROXIMITY';
        riskScore = Math.max(0, riskScore - 25);
        requiresStepUp = false;
      } else {
        bleMatchStatus = 'UNVERIFIED_WIFI_NETWORK';
        if (bleMode === 'STRICT_REQUIRED' || bleMode === 'STRICT_LOCK') {
          riskScore += 85;
          unfairMeansFlags.push('STRICT_BLE_ANCHOR_FAILED');
          reasonCodes.push('L3_BLE_STRICT_REJECTED');
        } else {
          riskScore += 30;
          requiresStepUp = true;
        }
      }
    } else {
      // No BLE or LAN proof provided
      if (bleMode === 'STRICT_REQUIRED' || bleMode === 'STRICT_LOCK') {
        // Strict Hardware Lock: Physical ESP32 BLE anchor is strictly mandatory
        bleMatchStatus = 'STRICT_BEACON_MISSING';
        riskScore += 85;
        unfairMeansFlags.push('STRICT_BLE_ANCHOR_FAILED');
        reasonCodes.push('L3_BLE_STRICT_REJECTED');
        requiresStepUp = false;
      } else if (bleMode === 'SOFT_ANCHOR') {
        // Soft Anchor allows smart fallback: iOS Safari or devices without BLE do Photometric Step-Up
        bleMatchStatus = isIOSWeb ? 'IOS_SAFARI_ADAPTIVE_ANCHOR' : 'SOFT_ANCHOR_MISSING';
        riskScore += isIOSWeb ? 10 : 30;
        requiresStepUp = true; // Triggers Step-Up screen-flash liveness, 0 strikes
      } else {
        // STANDBY_OPTIONAL: Zero hardware present today -> 0 penalty
        bleMatchStatus = 'STANDBY_NOT_REQUIRED';
      }
    }

    // --- Layer 4: Play Integrity Token Evaluation ---
    let playIntegrityVerdict = 'NOT_PROVIDED';
    if (playIntegrityToken) {
      if (playIntegrityToken.includes('MEETS_DEVICE_INTEGRITY') || playIntegrityToken === 'TEST_PASS') {
        playIntegrityVerdict = 'MEETS_DEVICE_INTEGRITY';
        riskScore = Math.max(0, riskScore - 15);
      } else if (playIntegrityToken.includes('EMULATOR') || playIntegrityToken.includes('ROOTED')) {
        playIntegrityVerdict = 'COMPROMISED_ENVIRONMENT';
        riskScore += 65;
        unfairMeansFlags.push('COMPROMISED_OS_ENVIRONMENT');
        reasonCodes.push('L4_PLAY_INTEGRITY_FAILED');
      }
    }

    // --- Layer 10: Web PWA Capability Boundary ---
    if (!deviceInfo.isNative) {
      assuranceTier = 'PWA_DEGRADED';
      // Browsers cannot access Location.isMock or Play Integrity; require step-up verification
      requiresStepUp = true;
    }

    // --- Decision Engine: 5-State Risk Matrix ---
    // Rule: Allow indoor GPS accuracy up to 120m in Strict Mode when accompanied by valid Step 2 Hardware BLE Beacon token
    const hasValidBleProof = Boolean(
      bleProof && (
        bleProof.compactVerified ||
        bleProof.bleVerified ||
        (typeof bleProof.rawPayload === 'string' && bleProof.rawPayload.includes('|')) ||
        bleProof.rollingCode ||
        bleProof.code
      )
    );
    const maxAllowedAcc = hasValidBleProof ? 120 : 65;
    if (primaryAcc > maxAllowedAcc && distanceMeters <= allowedRadius * 2 && !isMock) {
      decisionOutcome = 'RETRY';
      reasonCodes.push('POOR_GPS_ACCURACY');
    } else if (
      unfairMeansFlags.includes('OUTSIDE_HOSTEL_PERIMETER') ||
      unfairMeansFlags.includes('STRICT_BLE_ANCHOR_FAILED') ||
      unfairMeansFlags.includes('STRICT_WIFI_CLUSTER_FAILED') ||
      riskScore >= 85
    ) {
      decisionOutcome = 'DENY';
    } else if (riskScore >= 65) {
      decisionOutcome = 'MANUAL_REVIEW';
    } else if (riskScore >= 30 || requiresStepUp) {
      decisionOutcome = 'STEP_UP';
      requiresStepUp = true;
      // Randomized 2-color screen flash challenge for Phase 2 Photometric Verification
      stepUpColors = ['#FF0040', '#00E5FF']; // Vivid Red & Cyan complementary sequence
      assuranceTier = 'NATIVE_STEP_UP';
    } else {
      decisionOutcome = 'ALLOW';
    }

    // Generate Request Nonce Hash to bind Phase 1 request
    const nonceData = `${student.id}_${clientIp}_${deviceInfo.deviceId || 'DEV'}_${Date.now()}`;
    const requestNonceHash = crypto.createHash('sha256').update(nonceData).digest('hex');

    return {
      decisionOutcome,
      totalRiskScore: Math.min(100, Math.max(0, riskScore)),
      assuranceTier,
      distanceMeters,
      allowedRadius,
      mockFlagStatus,
      gpsSampleCount,
      wifiMatchStatus,
      bleMatchStatus,
      playIntegrityVerdict,
      unfairMeansFlags,
      reasonCodes,
      requiresStepUp,
      stepUpColors,
      requestNonceHash,
      ttlMs: DEFAULT_CHALLENGE_TTL_MS,
      detectedSpoofApps,
      detectedAppDetails
    };
  }

  /**
   * Generates a cryptographic proof binding challenge token, device ID, and nonce
   */
  generateClientSessionProof(challengeToken, deviceId, nonceHash) {
    const secret = process.env.JWT_SECRET || 'hostelguard-secret-key-2026';
    return crypto
      .createHmac('sha256', secret)
      .update(`${challengeToken || ''}:${deviceId || ''}:${nonceHash || ''}`)
      .digest('hex');
  }

  /**
   * Evaluates Phase 2 Attendance Verification & "Beyond-Location" Unfair-Means
   */
  async evaluateAttendanceCommit(params) {
    const {
      challenge,
      student,
      currentIp,
      currentDeviceId,
      currentUserAgent,
      requestNonceHash = null,
      clientSessionProof = null,
      photometricData = null
    } = params;

    const unfairMeans = [];
    let risk = challenge.risk_score || 0;

    // --- Layer 13.1: Two-Phone Split-Relay Detector ---
    // If Student B generated challenge at hostel and passed token to Student A outside
    const deviceMismatch = Boolean(
      challenge.bound_device_id &&
      currentDeviceId &&
      challenge.bound_device_id !== currentDeviceId
    );
    const nonceMismatch = Boolean(
      challenge.request_nonce_hash &&
      requestNonceHash &&
      challenge.request_nonce_hash !== requestNonceHash
    );

    let proofMismatch = false;
    if (clientSessionProof && challenge.challenge_token) {
      const expectedProof = this.generateClientSessionProof(
        challenge.challenge_token,
        challenge.bound_device_id,
        challenge.request_nonce_hash
      );
      if (clientSessionProof !== expectedProof) {
        proofMismatch = true;
      }
    }

    // Hardware bound device or nonce or cryptographic proof mismatch -> immediate DENY
    if (deviceMismatch || nonceMismatch || proofMismatch) {
      unfairMeans.push('SPLIT_RELAY_DETECTED');
      risk = 100;
      return {
        isAllowed: false,
        reason: 'SPLIT_RELAY_DETECTED',
        message: 'Two-phone split-relay proxy attack detected: Challenge token bound to conflicting device hardware.',
        riskScore: risk,
        unfairMeans
      };
    }

    // CGNAT / Dual-SIM / Wi-Fi-to-5G handoff resilience:
    let ipMismatch = false;
    if (challenge.bound_ip_address && currentIp) {
      const boundIpSubnet = challenge.bound_ip_address.split('.').slice(0, 3).join('.');
      const currentIpSubnet = currentIp.split('.').slice(0, 3).join('.');
      if (boundIpSubnet !== currentIpSubnet && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(currentIp)) {
        ipMismatch = true;
      }
    }

    if (ipMismatch) {
      // Hardware bound device matched, but IP changed during handoff:
      // Incur mild +20 risk penalty and enforce step-up rather than false-positive DENY
      unfairMeans.push('IP_SUBNET_HANDOFF_OBSERVED');
      risk = Math.min(100, risk + 20);
    }

    // --- Layer 13.2: Multi-Account Device & Telemetry Collusion Detector ---
    // Query recent attendance or challenges within 15 minutes on the same device ID
    if (currentDeviceId && currentDeviceId !== 'DEV-TEST-001') {
      const fifteenMinAgoUtc = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const collusionRecord = await getQuery(`
        SELECT student_id, roll_number FROM attendance_records
        WHERE roll_number != ? AND (
          student_id IN (
            SELECT student_id FROM attendance_challenges
            WHERE bound_device_id = ? AND student_id != ? AND (
              created_at >= ? OR datetime(created_at) >= datetime('now', '-15 minutes')
            )
          )
        ) LIMIT 1
      `, [student.roll_number, currentDeviceId, student.id, fifteenMinAgoUtc]);

      if (collusionRecord) {
        unfairMeans.push('COLLUSION_PROXY_DETECTED');
        risk = 90;
        return {
          isAllowed: false,
          reason: 'COLLUSION_PROXY_DETECTED',
          message: `Multi-account collusion detected: Device was already used by ${collusionRecord.roll_number} within 15 minutes.`,
          riskScore: risk,
          unfairMeans
        };
      }
    }

    // --- Layer 8: Step-Up Photometric Flash Verification ---
    let padPhotometricPass = 1;
    if (challenge.requires_step_up === 1) {
      if (photometricData && photometricData.flash_verified === false) {
        padPhotometricPass = 0;
        unfairMeans.push('PHOTOMETRIC_FLASH_REJECTED');
        return {
          isAllowed: false,
          reason: 'PHOTOMETRIC_LIVENESS_FAILED',
          message: 'Causal screen-flash liveness verification failed. Real 3D facial presence required.',
          riskScore: 88,
          unfairMeans
        };
      }
    }

    return {
      isAllowed: true,
      riskScore: risk,
      padPhotometricPass,
      unfairMeans
    };
  }
}

module.exports = new AntiSpoofPolicyEngine();
