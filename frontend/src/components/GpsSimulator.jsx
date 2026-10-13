import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { Navigation, AlertTriangle, CheckCircle, ShieldAlert, Sliders } from 'lucide-react';

export default function GpsSimulator({
  simulatedLocation,
  setSimulatedLocation,
  simulatedMockActive,
  setSimulatedMockActive
}) {
  const [geofence, setGeofence] = useState({ latitude: 28.5450, longitude: 77.1926, radius_meters: 20 });
  const [customLat, setCustomLat] = useState(28.5450);
  const [customLon, setCustomLon] = useState(77.1926);

  useEffect(() => {
    api.getGeofenceConfig().then((cfg) => {
      if (cfg) {
        setGeofence(cfg);
        if (!simulatedLocation) {
          setCustomLat(cfg.latitude);
          setCustomLon(cfg.longitude);
        }
      }
    }).catch(console.error);
  }, []);

  // Quick preset offsets in meters: ~0.00001 degrees lat is approx 1.1 meters
  const applyPreset = (offsetMeters, label) => {
    const latDelta = (offsetMeters / 111320); // rough conversion
    const targetLat = parseFloat((geofence.latitude + latDelta).toFixed(6));
    const targetLon = geofence.longitude;

    const loc = {
      latitude: targetLat,
      longitude: targetLon,
      accuracy: 8,
      label
    };
    setCustomLat(targetLat);
    setCustomLon(targetLon);
    setSimulatedLocation(loc);
  };

  return (
    <div style={{ maxWidth: '850px', margin: '0 auto', padding: '0 20px 40px' }}>
      <div className="glass-panel" style={{ padding: '32px' }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{
            width: '52px',
            height: '52px',
            borderRadius: '16px',
            background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '12px',
            boxShadow: '0 4px 20px rgba(245, 158, 11, 0.4)'
          }}>
            <Sliders size={28} color="#ffffff" />
          </div>
          <h2 style={{ fontSize: '24px', fontWeight: '800', color: '#ffffff' }}>GPS Hardware & Forge Location Simulator</h2>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Simulate distance variations and GPS spoofing apps without needing to physically walk outdoors.
          </p>
        </div>

        {/* Current Active Geofence Reference */}
        <div style={{
          padding: '16px 20px',
          borderRadius: '12px',
          background: 'rgba(99, 102, 241, 0.1)',
          border: '1px solid rgba(99, 102, 241, 0.3)',
          marginBottom: '24px',
          fontSize: '13px'
        }}>
          <div style={{ fontWeight: '700', color: '#ffffff', marginBottom: '4px' }}>
            Active Hostel Geofence Center:
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', color: '#818cf8' }}>
            Lat: {geofence.latitude} | Lon: {geofence.longitude} | Permitted Radius: {geofence.radius_meters} meters
          </div>
        </div>

        {/* Preset Distance Buttons */}
        <div style={{ marginBottom: '28px' }}>
          <label className="form-label">Quick Distance Simulation Presets</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            <button
              onClick={() => applyPreset(0, 'Center (0m)')}
              className="btn-secondary"
              style={{ justifyContent: 'center' }}
            >
              📍 Hostel Center (0m)
            </button>

            <button
              onClick={() => applyPreset(8, 'Inside Room (8m)')}
              className="btn-secondary"
              style={{ justifyContent: 'center' }}
            >
              🚪 Inside Room (8m)
            </button>

            <button
              onClick={() => applyPreset(18, 'Near Boundary (18m)')}
              className="btn-secondary"
              style={{ justifyContent: 'center' }}
            >
              🏃 Near Boundary (18m)
            </button>

            <button
              onClick={() => applyPreset(85, 'Outside Campus (85m)')}
              className="btn-secondary"
              style={{ justifyContent: 'center', borderColor: 'rgba(244, 63, 94, 0.4)', color: '#fb7185' }}
            >
              🚫 Outside Hostel (85m)
            </button>
          </div>
        </div>

        {/* Mock Location / Spoofer Toggle */}
        <div style={{
          padding: '18px 20px',
          borderRadius: '14px',
          background: simulatedMockActive ? 'rgba(244, 63, 94, 0.15)' : 'rgba(255, 255, 255, 0.04)',
          border: simulatedMockActive ? '1px solid #f43f5e' : '1px solid var(--border-card)',
          marginBottom: '28px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px'
        }}>
          <div>
            <div style={{ fontWeight: '700', fontSize: '15px', color: '#ffffff', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldAlert size={18} color={simulatedMockActive ? '#f43f5e' : 'var(--text-muted)'} />
              Simulate Active Mock Location App (GPS Spoofer)
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
              When enabled, device APIs report <code>isMockLocation = true</code>, triggering the 3-strike Forge Location Alert to admin.
            </p>
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', gap: '8px' }}>
            <input
              type="checkbox"
              checked={simulatedMockActive}
              onChange={(e) => setSimulatedMockActive(e.target.checked)}
              style={{ width: '20px', height: '20px', accentColor: '#f43f5e' }}
            />
            <span style={{ fontWeight: '700', fontSize: '13px', color: simulatedMockActive ? '#f43f5e' : 'var(--text-muted)' }}>
              {simulatedMockActive ? 'Spoofer Active' : 'Off'}
            </span>
          </label>
        </div>

        {/* Current Active Simulated Values */}
        {simulatedLocation && (
          <div style={{
            padding: '16px',
            borderRadius: '12px',
            background: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            color: '#ffffff',
            fontSize: '13px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div>
              <strong>Active Simulator Location:</strong>{' '}
              <span style={{ fontFamily: 'var(--font-mono)', color: '#34d399' }}>
                {simulatedLocation.latitude}, {simulatedLocation.longitude} ({simulatedLocation.label || 'Custom'})
              </span>
            </div>
            <button
              onClick={() => setSimulatedLocation(null)}
              className="btn-secondary"
              style={{ fontSize: '12px', padding: '4px 10px' }}
            >
              Reset to Hardware GPS
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
