/**
 * backend/src/utils/lanDiscovery.js
 * Bridges LAN Discovery with the dynamic WifiRoamingWatcher
 */

const wifiRoamingWatcher = require('./wifiRoamingWatcher');

function getPrimaryLanIp() {
  return wifiRoamingWatcher.getPrimaryLanIp();
}

async function publishWardenLanIp(port = process.env.PORT || 5000, db = null) {
  return wifiRoamingWatcher.startRoamingWatcher(port, db);
}

module.exports = {
  getPrimaryLanIp,
  publishWardenLanIp,
  wifiRoamingWatcher
};
