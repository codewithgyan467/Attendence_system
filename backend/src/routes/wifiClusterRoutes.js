const express = require('express');
const router = express.Router();
const wifiClusterService = require('../services/wifiClusterService');
const { getQuery } = require('../db/database');

/**
 * POST /api/admin/wifi-cluster/esp32-heartbeat
 * High-speed hardware heartbeat endpoint called by floor ESP32 multitasking anchors.
 * Authenticated cryptographically via HMAC-SHA256 signature over (beaconId:slot:localIp).
 */
router.post('/esp32-heartbeat', async (req, res) => {
  try {
    const wanIp = req.headers['x-forwarded-for']
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : req.socket?.remoteAddress || req.ip;

    const result = await wifiClusterService.recordHeartbeat({
      ...req.body,
      wanIp
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/admin/wifi-cluster/status
 * Public / Admin monitoring endpoint returning the live health of all floor router gateways.
 */
router.get('/status', async (req, res) => {
  try {
    const geo = await getQuery(`SELECT ble_mode FROM geofence_configs WHERE is_active = 1 LIMIT 1`);
    const bleMode = geo?.ble_mode || 'STANDBY_OPTIONAL';
    const status = wifiClusterService.getClusterStatus(bleMode);
    return res.status(200).json(status);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/admin/wifi-cluster/endpoints
 * Returns the list of active floor gateway LAN URLs for student devices on Wi-Fi to probe.
 */
router.get('/endpoints', (req, res) => {
  try {
    const endpoints = wifiClusterService.getEndpoints();
    return res.status(200).json({ success: true, count: endpoints.length, endpoints });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
