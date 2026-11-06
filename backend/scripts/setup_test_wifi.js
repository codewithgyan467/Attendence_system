const { runQuery, getQuery, allQuery } = require('../src/db/database');

async function main() {
  const geo = await getQuery('SELECT id FROM geofence_configs WHERE is_active = 1 LIMIT 1');
  const geoId = geo ? geo.id : 'default_geofence';

  // 1. AEC_Student_5.0 (Primary Test Router)
  await runQuery(`
    INSERT OR REPLACE INTO site_wifi_access_points (id, geofence_id, bssid, ssid_label, block_name, min_rssi, is_active)
    VALUES ('aec-wifi-01', ?, '8c:3b:ad:8b:d3:72', 'AEC_Student_5.0', 'AEC Hostel 1st Floor', -85, 1)
  `, [geoId]);

  // 2. Shashanka’s iPhone (Curly apostrophe \u2019)
  await runQuery(`
    INSERT OR REPLACE INTO site_wifi_access_points (id, geofence_id, bssid, ssid_label, block_name, min_rssi, is_active)
    VALUES ('shashanka-iphone-curly', ?, 'iphone-hotspot-01', 'Shashanka’s iPhone', 'Mobile Hotspot 1', -85, 1)
  `, [geoId]);

  // 3. Shashanka's iPhone (Straight apostrophe ')
  await runQuery(`
    INSERT OR REPLACE INTO site_wifi_access_points (id, geofence_id, bssid, ssid_label, block_name, min_rssi, is_active)
    VALUES ('shashanka-iphone-straight', ?, 'iphone-hotspot-02', "Shashanka's iPhone", 'Mobile Hotspot 1 (ASCII)', -85, 1)
  `, [geoId]);

  // 4. iphone / iPhone (Hotspot variants)
  await runQuery(`
    INSERT OR REPLACE INTO site_wifi_access_points (id, geofence_id, bssid, ssid_label, block_name, min_rssi, is_active)
    VALUES ('iphone-hotspot-generic', ?, 'iphone-hotspot-03', 'iphone', 'Mobile Hotspot 2', -85, 1)
  `, [geoId]);

  await runQuery(`
    INSERT OR REPLACE INTO site_wifi_access_points (id, geofence_id, bssid, ssid_label, block_name, min_rssi, is_active)
    VALUES ('iphone-hotspot-capital', ?, 'iphone-hotspot-04', 'iPhone', 'Mobile Hotspot 2 (TitleCase)', -85, 1)
  `, [geoId]);

  // 5. Update site_wifi_clusters
  await runQuery(`
    INSERT OR REPLACE INTO site_wifi_clusters (id, beacon_id, short_name, floor_number, ssid, local_ip, wan_ip, slot, last_heartbeat, status)
    VALUES ('HG-BEACON-BLKA-01', 'HG-BEACON-BLKA-01', 'HG-A01', 1, 'AEC_Student_5.0', '192.168.64.1', '127.0.0.1', 0, CURRENT_TIMESTAMP, 'ONLINE')
  `);

  console.log('✅ All authorized Wi-Fi networks seeded successfully:');
  const aps = await allQuery('SELECT id, ssid_label, bssid, block_name, is_active FROM site_wifi_access_points WHERE is_active = 1');
  console.table(aps);
}

main().catch(err => {
  console.error('Error seeding Wi-Fi:', err);
  process.exit(1);
});
