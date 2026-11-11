/**
 * backend/src/utils/wifiRoamingWatcher.js
 * Dynamic Wi-Fi Roaming Watcher & Real-Time Cloud LAN Re-Sync
 *
 * Continuously polls network interfaces to detect when the Warden laptop
 * switches between different hostel Wi-Fi routers (e.g. Floor 1 router -> Floor 2 router)
 * or mobile hotspots (iPhone 172.20.10.x / Android 192.168.43.x).
 * 
 * Automatically updates global state, local database records, and immediately
 * synchronizes the new IP to the Cloud Discovery Registry so student mobile apps
 * and browsers discover the new router IP seamlessly without server restart.
 */

const os = require('os');
const { EventEmitter } = require('events');

const VIRTUAL_ADAPTER_REGEX = /docker|veth|wsl|vmware|vbox|virtual|tun|tap|hyper-v|loopback|npcap|bluetooth/i;
const WIFI_OR_ETH_REGEX = /wi-fi|wireless|wlan|airport|en0|eth|ethernet|local area connection/i;

class WifiRoamingWatcher extends EventEmitter {
  constructor() {
    super();
    this.currentIp = null;
    this.currentInterface = null;
    this.pollIntervalMs = 5000;
    this.timer = null;
    this.port = process.env.PORT || 5000;
    this.db = null;
    this.cloudEndpoint = process.env.CLOUD_DISCOVERY_URL || 'https://hostelguard-backend-oimp.onrender.com/api/v1/lan-discovery';
    this.isCloudInstance = Boolean(process.env.RENDER || process.env.RENDER_EXTERNAL_URL);
  }

  /**
   * Evaluates if an IPv4 address belongs to a private network or hotspot subnet
   */
  isPrivateIPv4(ip) {
    if (!ip || typeof ip !== 'string') return false;
    const clean = ip.trim();
    // 10.0.0.0 - 10.255.255.255
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(clean)) return true;
    // 192.168.0.0 - 192.168.255.255
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(clean)) return true;
    // 172.16.0.0 - 172.31.255.255 (includes iOS Personal Hotspot 172.20.10.x)
    const match172 = clean.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
    if (match172) {
      const octet = parseInt(match172[1], 10);
      if (octet >= 16 && octet <= 31) return true;
    }
    return false;
  }

  /**
   * Inspects all host network interfaces, discarding virtual adapters,
   * prioritizing Wi-Fi/WLAN interfaces over secondary links.
   */
  getPrimaryLanIp() {
    const interfaces = os.networkInterfaces();
    let bestWifiCandidate = null;
    let fallbackPrivateCandidate = null;
    let otherCandidate = null;

    for (const name of Object.keys(interfaces)) {
      if (VIRTUAL_ADAPTER_REGEX.test(name)) continue;

      const isWifi = /wi-fi|wireless|wlan|airport/i.test(name);
      const isEth = /eth|ethernet|en0|local area connection/i.test(name);

      for (const net of interfaces[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          const isPrivate = this.isPrivateIPv4(net.address);

          if (isWifi && isPrivate) {
            bestWifiCandidate = { ip: net.address, iface: name };
            break;
          }
          if (isEth && isPrivate && !fallbackPrivateCandidate) {
            fallbackPrivateCandidate = { ip: net.address, iface: name };
          } else if (isPrivate && !fallbackPrivateCandidate) {
            fallbackPrivateCandidate = { ip: net.address, iface: name };
          } else if (!otherCandidate) {
            otherCandidate = { ip: net.address, iface: name };
          }
        }
      }
      if (bestWifiCandidate) break;
    }

    const winner = bestWifiCandidate || fallbackPrivateCandidate || otherCandidate;
    return winner ? winner.ip : '127.0.0.1';
  }

  /**
   * Returns a list of all active real non-virtual network interfaces
   */
  getAllActiveInterfaces() {
    const interfaces = os.networkInterfaces();
    const result = [];

    for (const name of Object.keys(interfaces)) {
      if (VIRTUAL_ADAPTER_REGEX.test(name)) continue;

      for (const net of interfaces[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          result.push({
            name,
            ip: net.address,
            isPrivate: this.isPrivateIPv4(net.address),
            isWifi: /wi-fi|wireless|wlan|airport/i.test(name)
          });
        }
      }
    }
    return result;
  }

  getCurrentLanIp() {
    return this.currentIp || this.getPrimaryLanIp();
  }

  getWardenUrl(port = this.port) {
    const ip = this.getCurrentLanIp();
    return `http://${ip}:${port}/api/v1`;
  }

  /**
   * Synchronizes the active LAN IP to the Cloud Discovery Registry so
   * student mobile apps on internet/cellular find the new router IP immediately.
   */
  async pushToCloud(lanIp, port = this.port) {
    if (this.isCloudInstance) return; // Do not push if running directly in the cloud
    if (!lanIp || lanIp === '127.0.0.1' || lanIp === 'localhost') return;

    const fullUrl = `http://${lanIp}:${port}/api/v1`;
    const payload = {
      wardenIp: lanIp,
      port: Number(port),
      fullUrl,
      timestamp: Date.now(),
      hostname: os.hostname()
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(this.cloudEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'HostelGuard-Warden-Roaming-Watcher/1.0',
          'x-lan-sync-key': process.env.LAN_SYNC_KEY || 'hostelguard-internal-sync'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        console.log(`☁️ [Cloud LAN Sync] Successfully published new LAN IP (${fullUrl}) to Cloud Discovery Registry.`);
      }
    } catch (_) {
      // Offline hostel operation - silent catch when internet is unavailable
    }
  }

  /**
   * Updates local database settings with the active LAN IP
   */
  async persistToDatabase(lanIp, port = this.port) {
    if (!this.db || typeof this.db.runQuery !== 'function') return;
    const fullUrl = `http://${lanIp}:${port}/api/v1`;

    try {
      await this.db.runQuery(`
        INSERT INTO system_settings (setting_key, setting_value, updated_at)
        VALUES ('warden_lan_api_url', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
      `, [fullUrl]);
    } catch (_) {}

    try {
      await this.db.runQuery(`
        UPDATE geofence_configs SET local_warden_url = ? WHERE is_active = 1
      `, [fullUrl]);
    } catch (_) {}
  }

  /**
   * Checks the network interfaces and triggers an event if the IP changed
   */
  async pollNetworkStatus() {
    const detectedIp = this.getPrimaryLanIp();

    if (this.currentIp === null) {
      // Initial detection
      this.currentIp = detectedIp;
      global.wardenIp = detectedIp;
      global.wardenLanApiUrl = `http://${detectedIp}:${this.port}/api/v1`;
      await this.persistToDatabase(detectedIp);
      this.pushToCloud(detectedIp).catch(() => {});
      return;
    }

    if (detectedIp !== this.currentIp && detectedIp !== '127.0.0.1') {
      const oldIp = this.currentIp;
      this.currentIp = detectedIp;
      global.wardenIp = detectedIp;
      global.wardenLanApiUrl = `http://${detectedIp}:${this.port}/api/v1`;

      console.log(`\n================================================================`);
      console.log(`🔄 [Wi-Fi Roaming Detected] Warden Laptop IP Changed!`);
      console.log(`   Previous IP : ${oldIp}`);
      console.log(`   New LAN IP  : ${detectedIp}`);
      console.log(`📡 Student Check-In URL: http://${detectedIp}:${this.port}`);
      console.log(`================================================================\n`);

      await this.persistToDatabase(detectedIp);
      this.pushToCloud(detectedIp).catch(() => {});

      this.emit('ipChanged', {
        oldIp,
        newIp: detectedIp,
        port: this.port,
        fullUrl: `http://${detectedIp}:${this.port}/api/v1`
      });
    }
  }

  /**
   * Starts the 5-second polling loop
   */
  startRoamingWatcher(port = 5000, db = null) {
    this.port = port;
    this.db = db;

    // Run immediate check
    this.pollNetworkStatus();

    if (!this.timer) {
      this.timer = setInterval(() => {
        this.pollNetworkStatus().catch((err) => {
          console.warn('[WifiRoamingWatcher] Poll error:', err.message);
        });
      }, this.pollIntervalMs);
    }
    return this.getWardenUrl(port);
  }

  stopRoamingWatcher() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

const watcherInstance = new WifiRoamingWatcher();

module.exports = watcherInstance;

