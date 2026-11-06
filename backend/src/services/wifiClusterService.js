const crypto = require('crypto');
const { runQuery, getQuery, allQuery } = require('../db/database');
const bleBeaconService = require('./bleBeaconService');
const beaconCache = require('./beaconCache');

/**
 * HostelGuard Enterprise v3.4 - Multi-Router Strict Lock Cluster Service
 * Coordinates floor ESP32 multitasking gateways (BLE + LAN WebServer + Cloud Heartbeat),
 * tracks router WAN/LAN subnets, and verifies zero-cost cryptographic LAN Wi-Fi tickets.
 */
class WifiClusterService {
  constructor() {
    this.DEFAULT_SHARED_SECRET = 'hostelguard_super_secret_32b_key';
    // Active Gateways Map: beaconId -> { beaconId, shortName, floor, ssid, localIp, wanIp, slot, lastHeartbeat, status }
    this.activeGateways = new Map();
    // Known Cluster WAN IPs: Set of public IP addresses reported by active floor gateways
    this.clusterWanIps = new Set();
    // Anti-Replay Cache for LAN tickets (5-minute sliding TTL)
    this.ticketReplayCache = new Map();
  }

  /**
   * Helper to derive Buffer from string or hex secret
   * @private
   */
  _getSecretBuffer(secret) {
    if (!secret) secret = this.DEFAULT_SHARED_SECRET;
    if (typeof secret !== 'string') return Buffer.from(String(secret));
    if (/^[0-9a-fA-F]{64}$/.test(secret)) {
      return Buffer.from(secret, 'hex');
    }
    return Buffer.from(secret, 'utf-8');
  }

  /**
   * Cleans entries older than 5 minutes from ticket anti-replay cache
   * @private
   */
  _cleanReplayCache() {
    const now = Date.now();
    const TTL_MS = 5 * 60 * 1000;
    for (const [key, timestamp] of this.ticketReplayCache.entries()) {
      if (now - timestamp > TTL_MS) {
        this.ticketReplayCache.delete(key);
      }
    }
  }

  /**
   * Computes an 8-character hex rolling token matching ESP32 firmware generateRollingToken()
   * @param {string} secret
   * @param {string} beaconId
   * @param {number} slot
   * @param {string} [prefix=''] Optional client IP or local IP prefix
   * @returns {string} 8-character lowercase hex string
   */
  computeRollingToken(secret, beaconId, slot, prefix = '') {
    const payload = `${beaconId}:${slot}${prefix && prefix.length ? `:${prefix}` : ''}`;
    const keyBuf = this._getSecretBuffer(secret);
    const hmac = crypto.createHmac('sha256', keyBuf);
    hmac.update(payload);
    const hexDigest = hmac.digest('hex');
    return hexDigest.substring(0, 8).toLowerCase();
  }

  /**
   * Resolves secret for a beacon ID, checking BeaconCache, DB, or fallback default
   * @param {string} beaconId
   * @returns {Promise<string>}
   */
  async resolveSecret(beaconId) {
    if (!beaconId) return this.DEFAULT_SHARED_SECRET;
    try {
      const cached = beaconCache.get(beaconId);
      if (cached && cached.shared_secret_ref) {
        return cached.shared_secret_ref;
      }
      const beacon = await bleBeaconService.resolveBeacon(beaconId);
      if (beacon && beacon.shared_secret_ref) {
        return beacon.shared_secret_ref;
      }
    } catch (_) {}
    return this.DEFAULT_SHARED_SECRET;
  }

  /**
   * Records a cloud heartbeat sent by an ESP32 floor gateway
   * @param {Object} params
   * @returns {Promise<{ success: boolean, message: string, gateway?: Object }>}
   */
  async recordHeartbeat(params = {}) {
    const { beaconId, shortName, floor, ssid, localIp, slot, signature, wanIp } = params;

    if (!beaconId || !slot || !signature) {
      return { success: false, message: 'Missing required heartbeat parameters (beaconId, slot, signature).' };
    }

    const currentServerSlot = Math.floor(Date.now() / 30000);
    const slotNum = Number(slot);

    // Verify slot tolerance (within +/- 3 slots for network delay)
    if (Math.abs(slotNum - currentServerSlot) > 3) {
      return { success: false, message: `Heartbeat slot expired or desynchronized (Server: ${currentServerSlot}, ESP32: ${slotNum}).` };
    }

    const secret = await this.resolveSecret(beaconId);
    const candidateSecrets = Array.from(new Set([secret, this.DEFAULT_SHARED_SECRET].filter(Boolean)));
    const sigClean = String(signature).trim().toLowerCase();
    let isSigValid = false;

    for (const s of candidateSecrets) {
      const expWithIp = this.computeRollingToken(s, beaconId, slotNum, localIp);
      const expStd = this.computeRollingToken(s, beaconId, slotNum);
      if (sigClean === expWithIp || sigClean === expStd) {
        isSigValid = true;
        break;
      }
    }

    if (!isSigValid) {
      return { success: false, message: 'Invalid ESP32 heartbeat HMAC signature.' };
    }

    const floorNum = Number(floor) || 1;
    const cleanWanIp = wanIp ? String(wanIp).replace(/^::ffff:/, '') : '127.0.0.1';

    const gateway = {
      beaconId: String(beaconId).trim(),
      shortName: shortName ? String(shortName).trim() : 'HG-ESP32',
      floor: floorNum,
      ssid: ssid ? String(ssid).trim() : `Hostel_Floor${floorNum}_WiFi`,
      localIp: localIp ? String(localIp).trim() : '192.168.1.1',
      wanIp: cleanWanIp,
      slot: slotNum,
      lastHeartbeat: Date.now(),
      status: 'ONLINE'
    };

    this.activeGateways.set(gateway.beaconId, gateway);
    if (cleanWanIp && cleanWanIp !== '127.0.0.1') {
      this.clusterWanIps.add(cleanWanIp);
    }

    // Persist to database site_wifi_clusters if table exists
    try {
      await runQuery(`
        INSERT INTO site_wifi_clusters (id, beacon_id, short_name, floor_number, ssid, local_ip, wan_ip, slot, last_heartbeat, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'ONLINE')
        ON CONFLICT(beacon_id) DO UPDATE SET
          short_name = excluded.short_name,
          floor_number = excluded.floor_number,
          ssid = excluded.ssid,
          local_ip = excluded.local_ip,
          wan_ip = excluded.wan_ip,
          slot = excluded.slot,
          last_heartbeat = CURRENT_TIMESTAMP,
          status = 'ONLINE'
      `, [gateway.beaconId, gateway.beaconId, gateway.shortName, gateway.floor, gateway.ssid, gateway.localIp, gateway.wanIp, gateway.slot]);
    } catch (_) {
      // Table may not have unique index on beacon_id or older schema; non-blocking
    }

    return {
      success: true,
      message: `ESP32 Floor ${gateway.floor} gateway registered successfully.`,
      gateway
    };
  }

  /**
   * Verifies a cryptographic LAN Wi-Fi ticket generated by the ESP32 /lan-handshake route.
   * Format: BEACON_ID|FLOOR_NUMBER|CLIENT_LAN_IP|SLOT|LAN_SIG
   * @param {string} ticket
   * @param {string} [clientWanIp] Optional public WAN IP of the student's request
   * @returns {Promise<{ isValid: boolean, reason?: string, message?: string, beaconId?: string, floor?: number, clientLanIp?: string }>}
   */
  async verifyLanWifiTicket(ticket, clientWanIp = null) {
    if (!ticket || typeof ticket !== 'string') {
      return { isValid: false, reason: 'MISSING_TICKET', message: 'No LAN Wi-Fi ticket provided.' };
    }

    this._cleanReplayCache();

    const parts = ticket.trim().split('|');
    if (parts.length < 5) {
      return { isValid: false, reason: 'MALFORMED_TICKET', message: 'Malformed LAN Wi-Fi ticket format (Expected 5 pipe-delimited fields).' };
    }

    const [beaconId, floorStr, clientLanIp, slotStr, lanSig] = parts;
    const floor = parseInt(floorStr, 10);
    const slot = parseInt(slotStr, 10);

    if (isNaN(slot) || !beaconId || !clientLanIp || !lanSig) {
      return { isValid: false, reason: 'INVALID_TICKET_FIELDS', message: 'LAN Wi-Fi ticket contains invalid fields.' };
    }

    // 1. Anti-Replay Check
    const replayKey = `TICKET:${beaconId}:${clientLanIp}:${slot}:${lanSig.toLowerCase()}`;
    if (this.ticketReplayCache.has(replayKey)) {
      return {
        isValid: false,
        reason: 'LAN_TICKET_ALREADY_USED',
        message: 'This floor Wi-Fi verification ticket has already been used. Please wait for the next 30-second token window.'
      };
    }

    // 2. Slot Tolerance Check (+/- 2 slots = 60-second drift absorption)
    const currentServerSlot = Math.floor(Date.now() / 30000);
    const candidateSlots = [currentServerSlot - 2, currentServerSlot - 1, currentServerSlot, currentServerSlot + 1, currentServerSlot + 2];

    if (!candidateSlots.includes(slot)) {
      return {
        isValid: false,
        reason: 'LAN_TICKET_EXPIRED',
        message: `LAN Wi-Fi ticket expired (Ticket Slot: ${slot}, Server Slot: ${currentServerSlot}).`
      };
    }

    // 3. Cryptographic HMAC Signature Verification
    const secret = await this.resolveSecret(beaconId);
    const candidateSecrets = Array.from(new Set([secret, this.DEFAULT_SHARED_SECRET].filter(Boolean)));
    const sigClean = lanSig.toLowerCase();
    let isSigValid = false;

    for (const s of candidateSecrets) {
      const expWithIp = this.computeRollingToken(s, beaconId, slot, clientLanIp);
      const expStd = this.computeRollingToken(s, beaconId, slot);
      if (sigClean === expWithIp || sigClean === expStd) {
        isSigValid = true;
        break;
      }
    }

    if (!isSigValid) {
      return {
        isValid: false,
        reason: 'INVALID_LAN_WIFI_SIGNATURE',
        message: 'Cryptographic signature mismatch on floor LAN Wi-Fi ticket.'
      };
    }

    // Mark as consumed in anti-replay cache
    this.ticketReplayCache.set(replayKey, Date.now());

    return {
      isValid: true,
      beaconId,
      floor: isNaN(floor) ? 1 : floor,
      clientLanIp,
      slot,
      message: `Verified presence on Floor ${floor} router via ${beaconId}.`
    };
  }

  /**
   * Retrieves overall Wi-Fi cluster status including active gateways, online status, and mode
   * @param {string} [currentBleMode]
   * @returns {Object}
   */
  getClusterStatus(currentBleMode = 'STANDBY_OPTIONAL') {
    const now = Date.now();
    const STALE_TIMEOUT_MS = 180000; // 3 minutes

    const gateways = [];
    let onlineCount = 0;

    for (const [id, gw] of this.activeGateways.entries()) {
      const isOnline = now - gw.lastHeartbeat < STALE_TIMEOUT_MS;
      if (isOnline) onlineCount++;
      gateways.push({
        ...gw,
        status: isOnline ? 'ONLINE' : 'OFFLINE',
        lastSeenSecondsAgo: Math.round((now - gw.lastHeartbeat) / 1000)
      });
    }

    const isStrictLock = currentBleMode === 'STRICT_REQUIRED' || currentBleMode === 'STRICT_LOCK';

    return {
      success: true,
      mode: currentBleMode,
      isStrictLock,
      totalGateways: gateways.length,
      onlineGateways: onlineCount,
      gateways,
      clusterWanIps: Array.from(this.clusterWanIps),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Retrieves active gateway endpoints for student devices on Wi-Fi to probe
   * @returns {Array<Object>}
   */
  getEndpoints() {
    const now = Date.now();
    const STALE_TIMEOUT_MS = 180000;
    const endpoints = [];

    for (const gw of this.activeGateways.values()) {
      if (now - gw.lastHeartbeat < STALE_TIMEOUT_MS) {
        endpoints.push({
          beaconId: gw.beaconId,
          floor: gw.floor,
          ssid: gw.ssid,
          handshakeUrl: `http://${gw.localIp}/lan-handshake`
        });
      }
    }

    return endpoints;
  }
}

module.exports = new WifiClusterService();
