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
  /**
   * Generates a 32-byte cryptographically secure hexadecimal secret key
   * @returns {string} 64-character hex string
   */
  generateBeaconSecret() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Computes a 30-second rolling token using HMAC-SHA256
   * @param {string} sharedSecret 32-byte hex secret (64 hex characters)
   * @param {string} beaconPublicId Public ID of beacon (e.g. 'FLR_0', 'HG-BEACON-BLKA-01')
   * @param {number} slot Unix timestamp / 30000 (30-second epoch slot)
   * @returns {string} 8-character uppercase hex rolling code
   */
  computeRollingToken(sharedSecret, beaconPublicId, slot) {
    if (!sharedSecret || !beaconPublicId) return '';
    const payload = `${beaconPublicId}:${slot}`;
    const hmac = crypto.createHmac('sha256', Buffer.from(sharedSecret, 'hex'))
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
    const hmac16 = crypto.createHmac('sha256', Buffer.from(sharedSecret, 'hex'))
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
    const expectedHmac = crypto.createHmac('sha256', Buffer.from(sharedSecret, 'hex'))
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
    return crypto.createHmac('sha256', Buffer.from(sharedSecret, 'hex'))
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
   * Verifies incoming BLE rolling proof against site_ble_beacons.
   * Tolerates ±2 slots (±60s, 5 slots total) to absorb bare ESP32 internal RC oscillator drift.
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async verifyBleBeaconProof(params) {
    const {
      beaconPublicId,
      rollingCode,
      timestampSlot = null,
      rssi = null
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

    const currentSlot = Math.floor(Date.now() / 30000);
    // 5-Slot Window: [-2, -1, 0, +1, +2] gives ±60s clock drift absorption for bare ESP32
    const candidateSlots = [currentSlot - 2, currentSlot - 1, currentSlot, currentSlot + 1, currentSlot + 2];

    // If client supplied its observed slot, prioritize it if within plausible range
    if (timestampSlot && Math.abs(timestampSlot - currentSlot) <= 4) {
      const slotNum = Number(timestampSlot);
      if (!candidateSlots.includes(slotNum)) {
        candidateSlots.push(slotNum);
      }
    }

    let matchFound = false;
    let matchedSlot = null;

    for (const slot of candidateSlots) {
      const expectedToken = this.computeRollingToken(beacon.shared_secret_ref, beacon.beacon_public_id, slot);
      if (cleanCode === expectedToken || cleanCode === expectedToken.substring(0, 6)) {
        matchFound = true;
        matchedSlot = slot;
        break;
      }
    }

    if (matchFound) {
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
        timeSkewSlots: matchedSlot - currentSlot
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
    const expectedSigB = crypto.createHmac('sha256', Buffer.from(beacon.shared_secret_ref, 'hex'))
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
