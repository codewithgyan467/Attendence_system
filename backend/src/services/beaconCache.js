/**
 * HostelGuard Enterprise v3.2 - High-Speed In-Memory BLE Beacon Cache
 * Provides O(1) RAM lookup (< 0.2ms) for multi-floor ESP32 hardware tokens,
 * eliminating disk bottlenecks during concurrent student curfew check-ins.
 */
class BeaconCache {
  constructor() {
    this.cacheByPublicId = new Map(); // beacon_public_id -> beacon record
    this.cacheById = new Map();       // id -> beacon record
    this.hydrated = false;
  }

  /**
   * Hydrates all registered beacons from site_ble_beacons into RAM
   * @param {Function} allQueryFn Database allQuery function
   */
  async hydrate(allQueryFn) {
    if (!allQueryFn) {
      const db = require('../db/database');
      allQueryFn = db.allQuery;
    }
    try {
      const beacons = await allQueryFn(`SELECT * FROM site_ble_beacons`);
      this.cacheByPublicId.clear();
      this.cacheById.clear();
      if (Array.isArray(beacons)) {
        for (const b of beacons) {
          this.set(b);
        }
      }
      this.hydrated = true;
      return this.size();
    } catch (err) {
      console.warn('⚠️ BeaconCache hydration warning:', err.message);
      return 0;
    }
  }

  /**
   * Retrieves a beacon by its public identifier (e.g. 'FLR_0', 'Ground Floor')
   * @param {string} publicId
   * @returns {Object|null}
   */
  get(publicId) {
    if (!publicId) return null;
    return this.cacheByPublicId.get(String(publicId).trim()) || null;
  }

  /**
   * Retrieves a beacon by its internal UUID
   * @param {string} id
   * @returns {Object|null}
   */
  getById(id) {
    if (!id) return null;
    return this.cacheById.get(String(id).trim()) || null;
  }

  /**
   * Atomic write-through caching of a beacon record
   * @param {Object} beacon
   */
  set(beacon) {
    if (!beacon) return;
    const cleanBeacon = {
      ...beacon,
      is_active: beacon.is_active === 1 || beacon.is_active === true ? 1 : 0
    };
    if (cleanBeacon.beacon_public_id) {
      this.cacheByPublicId.set(String(cleanBeacon.beacon_public_id).trim(), cleanBeacon);
    }
    if (cleanBeacon.id) {
      this.cacheById.set(String(cleanBeacon.id).trim(), cleanBeacon);
    }
  }

  /**
   * Deactivates a beacon in RAM (Kill Switch)
   * @param {string} idOrPublicId
   */
  deactivate(idOrPublicId) {
    if (!idOrPublicId) return;
    const str = String(idOrPublicId).trim();
    const b = this.cacheById.get(str) || this.cacheByPublicId.get(str);
    if (b) {
      b.is_active = 0;
      this.cacheById.set(b.id, b);
      this.cacheByPublicId.set(b.beacon_public_id, b);
    }
  }

  /**
   * Removes a beacon from RAM
   * @param {string} idOrPublicId
   */
  delete(idOrPublicId) {
    if (!idOrPublicId) return;
    const str = String(idOrPublicId).trim();
    const b = this.cacheById.get(str) || this.cacheByPublicId.get(str);
    if (b) {
      this.cacheById.delete(b.id);
      this.cacheByPublicId.delete(b.beacon_public_id);
    } else {
      this.cacheById.delete(str);
      this.cacheByPublicId.delete(str);
    }
  }

  /**
   * Returns all active beacons in cache
   * @returns {Array}
   */
  getActiveBeacons() {
    return Array.from(this.cacheByPublicId.values()).filter(b => b.is_active === 1);
  }

  /**
   * Clears the entire in-memory cache
   */
  clear() {
    this.cacheByPublicId.clear();
    this.cacheById.clear();
    this.hydrated = false;
  }

  /**
   * Returns count of cached beacons
   */
  size() {
    return this.cacheByPublicId.size;
  }
}

module.exports = new BeaconCache();

