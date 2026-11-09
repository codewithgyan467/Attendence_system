/**
 * authorizedWifiService.js
 * Multi-Wi-Fi & Changing Broadband Resilience Service
 * Manages authorized hostel Wi-Fi routers and subnets in memory and DB,
 * enabling multi-floor routers and auto-learning on cryptographic BLE match.
 */

const { isPrivateIp } = require('../middleware/strictLanGuard');

class AuthorizedWifiService {
  constructor() {
    this.authorizedList = []; // Array of { ip, subnet, label, addedAt, autoLearned }
    this.hydrated = false;
  }

  /**
   * Initializes authorized Wi-Fi subnets from system_settings table
   */
  async hydrate(db = null) {
    if (!db) {
      db = require('../db/database');
    }
    try {
      const row = await db.getQuery(
        `SELECT setting_value FROM system_settings WHERE setting_key = 'authorized_wifi_ips'`
      );
      if (row && row.setting_value) {
        const parsed = JSON.parse(row.setting_value);
        if (Array.isArray(parsed)) {
          this.authorizedList = parsed;
        }
      }
      this.hydrated = true;
      return this.authorizedList.length;
    } catch (err) {
      console.warn('⚠️ AuthorizedWifiService hydration notice:', err.message);
      this.authorizedList = [];
      return 0;
    }
  }

  /**
   * Helper to derive a subnet prefix from an IPv4 address.
   * e.g., "192.168.1.45" -> "192.168.1.0/24" (prefix "192.168.1.")
   * "103.21.54.88" -> "103.21.54.0/24" (prefix "103.21.54.")
   */
  deriveSubnet(ip) {
    if (!ip) return null;
    const clean = String(ip).replace(/^::ffff:/, '').trim();
    const parts = clean.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
    }
    return clean;
  }

  /**
   * Checks whether an IP or subnet is authorized.
   * Always authorizes local private LAN IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x, localhost).
   */
  isAuthorized(ip) {
    if (!ip) return false;
    const clean = String(ip).replace(/^::ffff:/, '').trim();

    // 1. All private LAN subnets are inherently valid intranet connections
    if (isPrivateIp(clean)) {
      return true;
    }

    const subnet = this.deriveSubnet(clean);

    // 2. Check in-memory authorized list (exact match or subnet match)
    return this.authorizedList.some((item) => {
      if (item.ip === clean) return true;
      if (item.subnet && (item.subnet === subnet || clean.startsWith(item.subnet.replace(/0\/24$/, '')))) {
        return true;
      }
      return false;
    });
  }

  /**
   * Adds an IP or subnet to the authorized list and saves to system_settings.
   */
  async authorizeIp(ip, label = 'Hostel Wi-Fi Router', autoLearned = false, db = null) {
    if (!ip) return null;
    const clean = String(ip).replace(/^::ffff:/, '').trim();
    if (clean === '127.0.0.1' || clean === '::1') return null;

    const subnet = this.deriveSubnet(clean);

    // Check if already covered
    const existing = this.authorizedList.find(
      (item) => item.ip === clean || (item.subnet && item.subnet === subnet)
    );

    if (existing) {
      return existing;
    }

    const newEntry = {
      ip: clean,
      subnet,
      label: label || 'Hostel Wi-Fi Router',
      addedAt: new Date().toISOString(),
      autoLearned: Boolean(autoLearned)
    };

    this.authorizedList.push(newEntry);
    await this.persist(db);
    return newEntry;
  }

  /**
   * Removes an IP from the authorized list.
   */
  async removeAuthorized(ipOrSubnet, db = null) {
    const clean = String(ipOrSubnet).replace(/^::ffff:/, '').trim();
    this.authorizedList = this.authorizedList.filter(
      (item) => item.ip !== clean && item.subnet !== clean
    );
    await this.persist(db);
    return true;
  }

  getAllAuthorized() {
    return this.authorizedList;
  }

  /**
   * Persists the in-memory authorized list to system_settings.
   */
  async persist(db = null) {
    if (!db) {
      db = require('../db/database');
    }
    try {
      await db.runQuery(
        `
        INSERT INTO system_settings (setting_key, setting_value, updated_at)
        VALUES ('authorized_wifi_ips', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
      `,
        [JSON.stringify(this.authorizedList)]
      );
    } catch (err) {
      console.warn('⚠️ Failed to persist authorized_wifi_ips to DB:', err.message);
    }
  }
}

module.exports = new AuthorizedWifiService();
