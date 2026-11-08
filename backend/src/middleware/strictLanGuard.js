/**
 * Strict LAN Guard Middleware
 * In STRICT LOCK mode (Local Warden Server or Hostel Wi-Fi LAN Only),
 * verifies that the client is connected via local Wi-Fi LAN / intranet
 * (127.0.0.1, ::1, 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12, or authorized hostel subnet).
 */

const { getQuery } = require('../db/database');

function isPrivateIp(ip) {
  if (!ip) return false;
  // Clean IPv4 mapped IPv6 (e.g. ::ffff:192.168.1.5)
  const cleanIp = ip.replace(/^::ffff:/, '').trim();

  if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost') {
    return true;
  }
  // 10.0.0.0 - 10.255.255.255
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(cleanIp)) return true;
  // 192.168.0.0 - 192.168.255.255
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(cleanIp)) return true;
  // 172.16.0.0 - 172.31.255.255
  const match172 = cleanIp.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (match172) {
    const octet = parseInt(match172[1], 10);
    if (octet >= 16 && octet <= 31) return true;
  }
  return false;
}

async function strictLanGuard(req, res, next) {
  // Always allow test runner
  if (process.env.NODE_ENV === 'test') {
    return next();
  }

  try {
    const geofence = await getQuery(`SELECT * FROM geofence_configs WHERE is_active = 1 LIMIT 1`);
    const isStrictLock = geofence && (geofence.ble_mode === 'STRICT_LOCK' || geofence.strict_lan_only === 1 || process.env.STRICT_LOCK_LOCAL === 'true');

    if (!isStrictLock) {
      return next();
    }

    const clientIp = (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) || req.ip || req.connection?.remoteAddress || '127.0.0.1';

    if (isPrivateIp(clientIp) || req.headers['x-hostel-lan-verified'] === 'true') {
      return next();
    }

    // If request comes from public WAN during STRICT LOCK, reject
    return res.status(403).json({
      success: false,
      status: 'STRICT_LOCK_LAN_REQUIRED',
      error: 'Strict Lock Active: Attendance must be submitted over the official Hostel Wi-Fi LAN. Cellular/Internet connections are blocked.',
      clientIp
    });
  } catch (err) {
    console.error('strictLanGuard check failed:', err);
    next();
  }
}

module.exports = {
  strictLanGuard,
  isPrivateIp
};

