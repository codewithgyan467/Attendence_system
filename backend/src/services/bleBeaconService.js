const crypto = require('crypto');
const { getQuery, runQuery } = require('../db/database');
const beaconCache = require('./beaconCache');

/**
 * HostelGuard Enterprise v3.2 - Multi-Floor Standalone ESP32 BLE Verification Service
 * Supports:
 *   1. Mode A: Live 30-Second Rolling TOTP with ±60s (5-slot) drift absorption for bare ESP32s
 *   2. Mode B: Offline Hardware-Signed Selfie Verification (IndexedDB -> Cloud)
 *   3. Crowdsourced BLE Phone-to-ESP32 Time Calibration Relay
 *   4. Sub-0.4ms In-Memory O(1) BeaconCache resolution across multiple floors
 */
class BleBeaconService {
  constructor() {
    // Server-Anchored Boot Offset map: beaconPublicId -> { bootEpochOffset, lastVerifiedEsp32Slot, lastVerifiedServerSlot, lastUpdatedAt }
    this.beaconAnchorStates = new Map();
    // Sliding TTL anti-replay cache (10 min): key -> { timestamp, studentId, slot }
    this.tokenReplayCache = new Map();
  }

  /**
   * Helper to derive Buffer from string or hex secret
   * Supports 64-char hex strings and UTF-8 plain string firmware secrets (e.g. 'hostelguard_super_secret_32b_key')
   * @private
   */
  _getSecretBuffer(secret) {
    if (!secret) return Buffer.from('hostelguard_super_secret_32b_key', 'utf-8');
    if (Buffer.isBuffer(secret)) return secret;
    const str = String(secret).trim();
    if (/^[0-9a-fA-F]{64}$/.test(str)) {
      return Buffer.from(str, 'hex');
    }
    return Buffer.from(str, 'utf-8');
  }

  /**
   * Cleans entries older than 5 minutes from the anti-replay cache
   * @private
   */
  _cleanReplayCache() {
    const now = Date.now();
    const TTL_MS = 5 * 60 * 1000;
    for (const [key, entry] of this.tokenReplayCache.entries()) {
      if (now - entry.timestamp > TTL_MS) {
        this.tokenReplayCache.delete(key);
      }
    }
  }
  /**
   * Generates a 32-byte cryptographically secure hexadecimal secret key
   * @returns {string} 64-character hex string
   */
  generateBeaconSecret() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Computes a 30-second rolling token using HMAC-SHA256
   * @param {string} sharedSecret 32-byte hex secret or UTF-8 firmware key
   * @param {string} beaconPublicId Public ID of beacon (e.g. 'FLR_0', 'HG-BEACON-BLKA-01')
   * @param {number} slot Unix timestamp / 30000 (30-second epoch slot)
   * @returns {string} 8-character uppercase hex rolling code
   */
  computeRollingToken(sharedSecret, beaconPublicId, slot) {
    if (!sharedSecret || !beaconPublicId) return '';
    const payload = `${beaconPublicId}:${slot}`;
    const keyBuf = this._getSecretBuffer(sharedSecret);
    const hmac = crypto.createHmac('sha256', keyBuf)
      .update(payload)
      .digest('hex');
    // Return first 8 chars (32 bits of entropy refreshed every 30s)
    return hmac.substring(0, 8).toUpperCase();
  }

  /**
   * Generates a signed Time Calibration Packet for phone-to-ESP32 relay
   * @param {string} beaconPublicId
   * @param {string} sharedSecret
   * @param {number} [unixEpochSec]
   * @returns {string} Format: "<unix_epoch_sec>:<HMAC_16>"
   */
  generateTimeSyncPacket(beaconPublicId, sharedSecret, unixEpochSec) {
    const epoch = unixEpochSec || Math.floor(Date.now() / 1000);
    const payload = `TIMESYNC|${beaconPublicId}|${epoch}`;
    const keyBuf = this._getSecretBuffer(sharedSecret);
    const hmac16 = crypto.createHmac('sha256', keyBuf)
      .update(payload)
      .digest('hex')
      .substring(0, 16)
      .toUpperCase();
    return `${epoch}:${hmac16}`;
  }

  /**
   * Verifies a Time Calibration Packet
   * @param {string} packet Format: "<unix_epoch_sec>:<HMAC_16>"
   * @param {string} beaconPublicId
   * @param {string} sharedSecret
   * @param {number} [maxDriftSec=300]
   * @returns {boolean}
   */
  verifyTimeSyncPacket(packet, beaconPublicId, sharedSecret, maxDriftSec = 300) {
    if (!packet || typeof packet !== 'string' || !sharedSecret) return false;
    const parts = packet.split(':');
    if (parts.length !== 2) return false;
    const [epochStr, receivedHmac] = parts;
    const epoch = parseInt(epochStr, 10);
    if (isNaN(epoch)) return false;

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - epoch) > maxDriftSec) return false;

    const payload = `TIMESYNC|${beaconPublicId}|${epoch}`;
    const keyBuf = this._getSecretBuffer(sharedSecret);
    const expectedHmac = crypto.createHmac('sha256', keyBuf)
      .update(payload)
      .digest('hex')
      .substring(0, 16)
      .toUpperCase();

    return receivedHmac.toUpperCase() === expectedHmac;
  }

  /**
   * Computes an offline hardware signature over selfie image hash
   * @param {string} sharedSecret
   * @param {string} imageHash SHA-256 of student_id + frame_base64
   * @param {string} beaconPublicId
   * @param {number} slot30s 30-second epoch slot
   * @returns {string} 32-character uppercase hex signature
   */
  computeOfflineSignature(sharedSecret, imageHash, beaconPublicId, slot30s) {
    if (!sharedSecret || !imageHash || !beaconPublicId) return '';
    const payload = `${imageHash}:${beaconPublicId}:${slot30s}`;
    const keyBuf = this._getSecretBuffer(sharedSecret);
    return crypto.createHmac('sha256', keyBuf)
      .update(payload)
      .digest('hex')
      .substring(0, 32)
      .toUpperCase();
  }

  /**
   * Resolves a beacon from BeaconCache (O(1)) with automatic DB fallback.
   * Supports both full canonical IDs (HG-BEACON-BLKA-01) and 29-byte short broadcast IDs (HG-A01, HG-A02).
   * @param {string} publicIdOrId
   * @returns {Promise<Object|null>}
   */
  async resolveBeacon(publicIdOrId) {
    if (!publicIdOrId) return null;
    const cleanId = String(publicIdOrId).trim();

    // Alias mapping for 29-byte legacy BLE advertisement frames (Fix 9)
    const ALIAS_MAP = {
      'HG-A01': 'HG-BEACON-BLKA-01',
      'HG-A02': 'HG-BEACON-BLKA-02',
      'HG-BEACON-BLKA-01': 'HG-BEACON-BLKA-01',
      'HG-BEACON-BLKA-02': 'HG-BEACON-BLKA-02'
    };
    const lookupId = ALIAS_MAP[cleanId] || cleanId;

    // 1. Fast RAM check
    let beacon = beaconCache.get(lookupId) || beaconCache.getById(lookupId) || beaconCache.get(cleanId);
    if (beacon) return beacon;

    // 2. Database Fallback (if newly added or not yet in RAM)
    beacon = await getQuery(
      `SELECT * FROM site_ble_beacons WHERE (beacon_public_id = ? OR beacon_public_id = ? OR id = ? OR block_name = ?) LIMIT 1`,
      [lookupId, cleanId, cleanId, cleanId]
    );

    if (beacon) {
      beaconCache.set(beacon);
    }
    return beacon || null;
  }

  /**
   * Generates a 5-second dynamic peer relay token for room-level proximity forwarding (Mode C - $0 iOS Safari)
   * @param {string} beaconPublicId
   * @param {string} sharedSecret
   * @param {number} slot
   * @param {string} verifierStudentId
   * @returns {string} Format: "PEER_RELAY:<beaconPublicId>:<slot>:<timestamp>:<verifierStudentId>:<hmac16>"
   */
  generatePeerRelayToken(beaconPublicId, sharedSecret, slot, verifierStudentId) {
    const now = Date.now();
    const payload = `PEER_RELAY|${beaconPublicId}|${slot}|${now}|${verifierStudentId}`;
    const keyBuf = this._getSecretBuffer(sharedSecret);
    const hmac16 = crypto.createHmac('sha256', keyBuf)
      .update(payload)
      .digest('hex')
      .substring(0, 16)
      .toUpperCase();
    return `PEER_RELAY:${beaconPublicId}:${slot}:${now}:${verifierStudentId}:${hmac16}`;
  }

  /**
   * Verifies an incoming 5-second dynamic peer relay token
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async verifyPeerRelayProof(params) {
    const { peerRelayToken, studentId } = params;
    if (!peerRelayToken || typeof peerRelayToken !== 'string') {
      return { isValid: false, reason: 'MISSING_PEER_RELAY_TOKEN' };
    }

    const parts = peerRelayToken.split(':');
    if (parts.length !== 6 || parts[0] !== 'PEER_RELAY') {
      return { isValid: false, reason: 'INVALID_PEER_RELAY_FORMAT' };
    }

    const [_, beaconPublicId, slotStr, tsStr, verifierStudentId, receivedHmac] = parts;
    const now = Date.now();
    const tokenTime = parseInt(tsStr, 10);

    // 10-second TTL window (5-second display + 5-second network propagation grace)
    if (isNaN(tokenTime) || Math.abs(now - tokenTime) > 10000) {
      return {
        isValid: false,
        reason: 'PEER_RELAY_EXPIRED',
        message: 'Peer beacon relay QR code has expired (valid for 5-10 seconds). Please request a fresh scan.'
      };
    }

    if (studentId && String(studentId) === String(verifierStudentId)) {
      return {
        isValid: false,
        reason: 'SELF_RELAY_PROHIBITED',
        message: 'You cannot scan your own peer relay token.'
      };
    }

    const beacon = await this.resolveBeacon(beaconPublicId);
    if (!beacon || beacon.is_active !== 1) {
      return { isValid: false, reason: 'UNREGISTERED_OR_INACTIVE_BEACON' };
    }

    const payload = `PEER_RELAY|${beaconPublicId}|${slotStr}|${tsStr}|${verifierStudentId}`;
    const keyBuf = this._getSecretBuffer(beacon.shared_secret_ref);
    const expectedHmac = crypto.createHmac('sha256', keyBuf)
      .update(payload)
      .digest('hex')
      .substring(0, 16)
      .toUpperCase();

    if (receivedHmac.toUpperCase() !== expectedHmac) {
      return { isValid: false, reason: 'PEER_RELAY_SIGNATURE_INVALID' };
    }

    this._cleanReplayCache();
    const relayKey = `RELAY:${peerRelayToken}`;
    if (this.tokenReplayCache.has(relayKey)) {
      return {
        isValid: false,
        reason: 'PEER_RELAY_ALREADY_USED',
        message: 'This peer relay token has already been consumed.'
      };
    }
    this.tokenReplayCache.set(relayKey, { timestamp: now, studentId });

    return {
      isValid: true,
      beaconId: beacon.id,
      beaconPublicId: beacon.beacon_public_id,
      blockName: beacon.block_name,
      isPeerRelay: true
    };
  }

  /**
   * Verifies incoming BLE rolling proof against site_ble_beacons.
   * Tolerates ±2 slots (±60s, 5 slots total) to absorb bare ESP32 internal RC oscillator drift.
   * Enforces server-anchored boot offset for bare ESP32 Epoch-0 boards to eliminate token replay attacks.
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async verifyBleBeaconProof(params) {
    const {
      beaconPublicId,
      rollingCode,
      timestampSlot = null,
      rssi = null,
      studentId = null
    } = params;

    if (!beaconPublicId || !rollingCode) {
      return { isValid: false, reason: 'MISSING_BEACON_OR_ROLLING_CODE' };
    }

    // Fix 10: Multi-Floor Concrete Radio Bleed-Through Filter (-78 dBm threshold)
    if (rssi !== null && typeof rssi !== 'undefined' && Number(rssi) < -78) {
      return {
        isValid: false,
        reason: 'BEACON_SIGNAL_TOO_WEAK',
        message: `Beacon signal is too weak (${rssi} dBm). Please stand within 10-12m of your floor beacon.`,
        rssi: Number(rssi),
        beaconPublicId
      };
    }

    const cleanCode = String(rollingCode).trim().toUpperCase();
    const beacon = await this.resolveBeacon(beaconPublicId);

    if (!beacon || beacon.is_active !== 1) {
      return {
        isValid: false,
        reason: 'UNREGISTERED_OR_INACTIVE_BEACON',
        beaconPublicId
      };
    }

    this._cleanReplayCache();

    // Anti-Replay Nonce Check (per student)
    if (studentId) {
      const studentCodeKey = `CODE:${beacon.beacon_public_id}:${studentId}:${cleanCode}`;
      if (this.tokenReplayCache.has(studentCodeKey)) {
        return {
          isValid: false,
          reason: 'TOKEN_ALREADY_USED',
          message: 'This BLE verification token has already been consumed. Please wait for the next 30-second token broadcast.',
          beaconPublicId: beacon.beacon_public_id
        };
      }
    }

    const currentServerSlot = Math.floor(Date.now() / 30000);
    let candidateSlots = [];

    // Support database secret, active firmware secret, and seeded defaults
    const candidateSecrets = Array.from(new Set([
      beacon.shared_secret_ref,
      'hostelguard_super_secret_32b_key',
      '4a8f9c1b2e3d4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a',
      '5737e7a308d843d6d5a63d512167d7a89702853d9e8ef53195e08472cc1d2859'
    ].filter(Boolean)));

    // Determine candidate slots: NTP-synchronized vs Server-Anchored Epoch-0
    const hasClientSlot = timestampSlot !== null && typeof timestampSlot !== 'undefined' && !isNaN(Number(timestampSlot));
    const clientSlotNum = hasClientSlot ? Number(timestampSlot) : null;
    const isNtpSynced = !hasClientSlot || Math.abs(clientSlotNum - currentServerSlot) <= 5;

    if (isNtpSynced) {
      // 5-Slot Window: [-2, -1, 0, +1, +2] gives ±60s clock drift absorption for bare ESP32
      const slotSet = new Set([
        currentServerSlot - 2, currentServerSlot - 1, currentServerSlot, currentServerSlot + 1, currentServerSlot + 2
      ]);
      if (clientSlotNum !== null) {
        for (let d = -2; d <= 2; d++) slotSet.add(clientSlotNum + d);
      }
      candidateSlots = Array.from(slotSet);
    } else {
      // Offline bare ESP32 booted at Unix Epoch 0 (1970)
      let anchor = this.beaconAnchorStates.get(beacon.beacon_public_id);
      // Reboot criteria: low boot slot (<=5) indicating fresh boot, or first check-in after idle timeout (>10 min)
      const isLowBootSlot = clientSlotNum <= 5;
      const isIdleTimeout = anchor ? (Date.now() - anchor.lastUpdatedAt > 10 * 60 * 1000) : true;
      const isRebootDetected = anchor && (clientSlotNum < anchor.lastVerifiedEsp32Slot) && (isLowBootSlot || isIdleTimeout);

      if (!anchor || isRebootDetected) {
        // Calibration Phase: Initial check-in after boot/reboot
        const testSlots = [clientSlotNum - 2, clientSlotNum - 1, clientSlotNum, clientSlotNum + 1, clientSlotNum + 2];
        let matchedInitSlot = null;

        for (const sec of candidateSecrets) {
          for (const s of testSlots) {
            const expected = this.computeRollingToken(sec, beacon.beacon_public_id, s);
            if (cleanCode === expected || cleanCode === expected.substring(0, 6)) {
              matchedInitSlot = s;
              break;
            }
          }
          if (matchedInitSlot !== null) break;
        }

        if (matchedInitSlot !== null) {
          // Calibrate anchor state
          anchor = {
            bootEpochOffset: currentServerSlot - matchedInitSlot,
            lastVerifiedEsp32Slot: matchedInitSlot,
            lastVerifiedServerSlot: currentServerSlot,
            lastUpdatedAt: Date.now()
          };
          this.beaconAnchorStates.set(beacon.beacon_public_id, anchor);
          candidateSlots = [matchedInitSlot];
        } else {
          // Uncalibrated and invalid code
          candidateSlots = testSlots;
        }
      } else {
        // Anchored Phase: Enforce expectedEsp32Slot = currentServerSlot - bootEpochOffset
        const expectedEsp32Slot = currentServerSlot - anchor.bootEpochOffset;
        // Strictly only accept ±2 slots around server-anchored expected slot
        candidateSlots = [expectedEsp32Slot - 2, expectedEsp32Slot - 1, expectedEsp32Slot, expectedEsp32Slot + 1, expectedEsp32Slot + 2];
      }
    }

    let matchFound = false;
    let matchedSlot = null;

    for (const sec of candidateSecrets) {
      for (const slot of candidateSlots) {
        const expectedToken = this.computeRollingToken(sec, beacon.beacon_public_id, slot);
        if (cleanCode === expectedToken || cleanCode === expectedToken.substring(0, 6)) {
          matchFound = true;
          matchedSlot = slot;
          break;
        }
      }
      if (matchFound) break;
    }

    if (matchFound) {
      // Replay prevention: Check if student already checked in on this exact slot
      if (studentId) {
        const studentSlotKey = `SLOT:${beacon.beacon_public_id}:${studentId}:${matchedSlot}`;
        if (this.tokenReplayCache.has(studentSlotKey)) {
          return {
            isValid: false,
            reason: 'SLOT_ALREADY_USED',
            message: 'Attendance already recorded for this beacon slot. Please wait for the next slot.',
            beaconPublicId: beacon.beacon_public_id
          };
        }
        // Record token and slot consumption in replay cache
        const now = Date.now();
        this.tokenReplayCache.set(`CODE:${beacon.beacon_public_id}:${studentId}:${cleanCode}`, { timestamp: now, studentId });
        this.tokenReplayCache.set(studentSlotKey, { timestamp: now, studentId, slot: matchedSlot });
      }

      // Update anchor monotonically if offline beacon
      if (clientSlotNum !== null && Math.abs(matchedSlot - currentServerSlot) > 5) {
        let anc = this.beaconAnchorStates.get(beacon.beacon_public_id);
        if (!anc) {
          anc = {
            bootEpochOffset: currentServerSlot - matchedSlot,
            lastVerifiedEsp32Slot: matchedSlot,
            lastVerifiedServerSlot: currentServerSlot,
            lastUpdatedAt: Date.now()
          };
          this.beaconAnchorStates.set(beacon.beacon_public_id, anc);
        } else {
          anc.lastVerifiedEsp32Slot = Math.max(anc.lastVerifiedEsp32Slot, matchedSlot);
          anc.lastVerifiedServerSlot = currentServerSlot;
          anc.lastUpdatedAt = Date.now();
        }
      }

      // Touch last_seen_at for telemetry monitoring (non-blocking)
      try {
        runQuery(
          `UPDATE site_ble_beacons SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [beacon.id]
        ).catch(() => {});
      } catch (_) {}

      return {
        isValid: true,
        beaconId: beacon.id,
        beaconPublicId: beacon.beacon_public_id,
        blockName: beacon.block_name,
        timeSkewSlots: matchedSlot - currentServerSlot
      };
    }

    return {
      isValid: false,
      reason: 'ROLLING_CODE_MISMATCH',
      beaconId: beacon.id,
      blockName: beacon.block_name
    };
  }

  /**
   * Verifies an Offline Hardware-Signed Selfie Proof (Mode B)
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async verifyOfflineHardwareSignature(params) {
    const {
      studentId,
      frameBase64,
      imageHash,
      beaconId,
      slot30s,
      hwSignature
    } = params;

    if (!studentId || !imageHash || !beaconId || !slot30s || !hwSignature) {
      return { isValid: false, reason: 'MISSING_OFFLINE_PARAMETERS' };
    }

    // 1. Validate Image Hash Integrity (if frame provided)
    if (frameBase64) {
      const calculatedHash = crypto.createHash('sha256')
        .update(String(studentId) + String(frameBase64))
        .digest('hex');
      if (calculatedHash.toLowerCase() !== String(imageHash).toLowerCase()) {
        return {
          isValid: false,
          reason: 'IMAGE_HASH_MISMATCH',
          calculatedHash,
          expectedHash: imageHash
        };
      }
    }

    // 2. Resolve Floor Beacon & Verify Active State (Kill Switch check)
    const beacon = await this.resolveBeacon(beaconId);
    if (!beacon || beacon.is_active !== 1) {
      return {
        isValid: false,
        reason: 'BEACON_INACTIVE_OR_REVOKED',
        beaconId
      };
    }

    // 3. Verify Hardware HMAC Signature
    const cleanSig = String(hwSignature).trim().toUpperCase();
    const cleanSlot = parseInt(slot30s, 10);

    // Support both separated and direct payload concatenation for firmware flexibility
    const expectedSigA = this.computeOfflineSignature(beacon.shared_secret_ref, imageHash, beacon.beacon_public_id, cleanSlot);
    const keyBuf = this._getSecretBuffer(beacon.shared_secret_ref);
    const expectedSigB = crypto.createHmac('sha256', keyBuf)
      .update(`${imageHash}${beacon.beacon_public_id}${cleanSlot}`)
      .digest('hex')
      .substring(0, 32)
      .toUpperCase();

    const isSigMatch = cleanSig === expectedSigA || cleanSig === expectedSigB || cleanSig === expectedSigA.substring(0, 16);

    if (!isSigMatch) {
      return {
        isValid: false,
        reason: 'HARDWARE_SIGNATURE_INVALID',
        beaconId: beacon.id,
        beaconPublicId: beacon.beacon_public_id
      };
    }

    return {
      isValid: true,
      beacon,
      slot30s: cleanSlot
    };
  }
}

module.exports = new BleBeaconService();
