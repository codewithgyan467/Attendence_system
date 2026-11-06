const { runQuery, getQuery, allQuery } = require('../src/db/database');

async function main() {
  const geo = await getQuery('SELECT id FROM geofence_configs WHERE is_active = 1 LIMIT 1');
  const geoId = geo ? geo.id : 'default_geofence';

  // 1. Insert or update site_wifi_access_points with AEC_Student_5.0
  await runQuery(`
    INSERT OR REPLACE INTO site_wifi_access_points (id, geofence_id, bssid, ssid_label, block_name, min_rssi, is_active)
    VALUES ('aec-wifi-01', ?, '8c:3b:ad:8b:d3:72', 'AEC_Student_5.0', 'AEC Hostel 1st Floor', -85, 1)
  `, [geoId]);

  // 2. Also register secondary BSSID / standard 2.4G variants if any
  await runQuery(`
    INSERT OR REPLACE INTO site_wifi_access_points (id, geofence_id, bssid, ssid_label, block_name, min_rssi, is_active)
    VALUES ('aec-wifi-02', ?, '8c:3b:ad:8b:d3:71', 'AEC_Student', 'AEC Hostel 2.4G', -85, 1)
  `, [geoId]);

  // 3. Insert or update site_wifi_clusters for multi-router gateway
  await runQuery(`
    INSERT OR REPLACE INTO site_wifi_clusters (id, beacon_id, short_name, floor_number, ssid, local_ip, wan_ip, slot, last_heartbeat, status)
    VALUES ('HG-BEACON-BLKA-01', 'HG-BEACON-BLKA-01', 'HG-A01', 1, 'AEC_Student_5.0', '192.168.64.1', '127.0.0.1', 0, CURRENT_TIMESTAMP, 'ONLINE')
  `);

  console.log('✅ Wi-Fi configuration seeded successfully:');
  const aps = await allQuery('SELECT * FROM site_wifi_access_points WHERE is_active = 1');
  console.log('Active APs:', aps);
}

main().catch(err => {
  console.error('Error seeding Wi-Fi:', err);
  process.exit(1);
});
