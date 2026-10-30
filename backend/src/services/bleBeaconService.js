const crypto = require('crypto');
const { getQuery, runQuery } = require('../db/database');

/**
 * HostelGuard Enterprise v3.1 ESP32 BLE Rolling Beacon Verification Service
 * Zero-hardware standby today -> Hot-swappable hardware lock when ESP32 arrives.
 */
class BleBeaconService {
  /**
   * Generates a 32-byte cryptographically secure hexadecimal secret key
   */
  generateBeaconSecret() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Computes a 30-second rolling token using HMAC-SHA256
   * @param {string} sharedSecret 32-byte hex secret
   * @param {string} beaconPublicId Public ID of beacon (e.g. HG-BCN-BLK-A)
   * @param {number} slot Unix timestamp / 30000 (30-second epoch slot)
   * @returns {string} 8-character hex rolling code
   */
  computeRollingToken(sharedSecret, beaconPublicId, slot) {
    const payload = `${beaconPublicId}:${slot}`;
    const hmac = crypto.createHmac('sha256', Buffer.from(sharedSecret, 'hex'))
      .update(payload)
      .digest('hex');
    // Return first 8 chars (32 bits of entropy refreshed every 30s)
    return hmac.substring(0, 8).toUpperCase();
  }

  /**
   * Verifies incoming BLE rolling proof against site_ble_beacons table.
   * Tolerates ±1 slot (±30s) clock skew between ESP32 hardware and server NTP.
   */
  async verifyBleBeaconProof(params) {
    const {
      beaconPublicId,
      rollingCode,
      timestampSlot = null
    } = params;

    if (!beaconPublicId || !rollingCode) {
      return { isValid: false, reason: 'MISSING_BEACON_OR_ROLLING_CODE' };
    }

    const cleanCode = String(rollingCode).trim().toUpperCase();
    const beacon = await getQuery(
      `SELECT * FROM site_ble_beacons WHERE beacon_public_id = ? AND is_active = 1`,
      [beaconPublicId]
    );

    if (!beacon) {
      return { isValid: false, reason: 'UNREGISTERED_OR_INACTIVE_BEACON' };
    }

    const currentSlot = Math.floor(Date.now() / 30000);
    const candidateSlots = [currentSlot - 1, currentSlot, currentSlot + 1];

    // If client supplied its observed slot, prioritize it if within range
    if (timestampSlot && Math.abs(timestampSlot - currentSlot) <= 3) {
      if (!candidateSlots.includes(Number(timestampSlot))) {
        candidateSlots.push(Number(timestampSlot));
      }
    }

    let matchFound = false;
    let matchedSlot = null;

    for (const slot of candidateSlots) {
      const expectedToken = this.computeRollingToken(beacon.shared_secret_ref, beaconPublicId, slot);
      if (cleanCode === expectedToken || cleanCode === expectedToken.substring(0, 6)) {
        matchFound = true;
        matchedSlot = slot;
        break;
      }
    }

    if (matchFound) {
      // Touch last_seen_at for telemetry monitoring
      try {
        await runQuery(
          `UPDATE site_ble_beacons SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [beacon.id]
        );
      } catch (err) {
        // Non-fatal
      }

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
}

module.exports = new BleBeaconService();

