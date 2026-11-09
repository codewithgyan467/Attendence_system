const os = require('os');

/**
 * Discovers the Warden Laptop's primary Wi-Fi / LAN IPv4 address.
 * Prioritizes private Class C (192.168.x.x), Class A (10.x.x.x), and Class B (172.16-31.x.x).
 */
function getPrimaryLanIp() {
  const interfaces = os.networkInterfaces();
  let candidate = null;

  for (const name of Object.keys(interfaces)) {
    const isWifiOrEth = /wi-fi|wireless|wlan|ethernet|eth|en0|wlp|wls/i.test(name);
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        const isPrivate = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(net.address);
        if (isWifiOrEth && isPrivate) {
          return net.address;
        }
        if (!candidate && isPrivate) {
          candidate = net.address;
        } else if (!candidate) {
          candidate = net.address;
        }
      }
    }
  }

  return candidate || '127.0.0.1';
}

/**
 * Publishes the Warden Laptop LAN IP to global state, system_settings table, and geofence config.
 */
async function publishWardenLanIp(port = process.env.PORT || 5000, db = null) {
  const ip = getPrimaryLanIp();
  const wardenLanApiUrl = `http://${ip}:${port}/api/v1`;
  global.wardenLanApiUrl = wardenLanApiUrl;

  if (db && typeof db.runQuery === 'function') {
    try {
      await db.runQuery(`
        INSERT INTO system_settings (setting_key, setting_value, updated_at)
        VALUES ('warden_lan_api_url', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
      `, [wardenLanApiUrl]);
    } catch (_) {}

    try {
      await db.runQuery(`
        UPDATE geofence_configs SET local_warden_url = ? WHERE is_active = 1
      `, [wardenLanApiUrl]);
    } catch (_) {}
  }

  return wardenLanApiUrl;
}

module.exports = {
  getPrimaryLanIp,
  publishWardenLanIp
};

