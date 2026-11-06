import React, { useState, useEffect } from 'react';
import { api } from '../../utils/api';
import { formatTime12h } from '../../utils/timeUtils';
import {
  MapPin,
  Navigation,
  Save,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Compass,
  Radio,
  Cpu,
  Key,
  Trash2,
  Plus,
  ShieldCheck,
  Zap,
  Clock,
  Copy,
  Download,
  Power,
  ShieldAlert
} from 'lucide-react';
import GeofenceMap from '../common/GeofenceMap';

export default function GeofenceManager() {
  const [config, setConfig] = useState({
    facility_name: 'Aec hostel',
    latitude: 26.140462,
    longitude: 91.656606,
    radius_meters: 60,
    is_active: 1
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  // ESP32 BLE Beacon Management State
  const [bleMode, setBleMode] = useState('STANDBY_OPTIONAL');
  const [beacons, setBeacons] = useState([]);
  const [bleLoading, setBleLoading] = useState(false);
  const [bleSaving, setBleSaving] = useState(false);
  const [showAddBeacon, setShowAddBeacon] = useState(false);
  const [newBeacon, setNewBeacon] = useState({
    beacon_public_id: '',
    block_name: '',
    shared_secret_ref: ''
  });
  const [copiedKey, setCopiedKey] = useState(null);

  // Real-Time ESP32 Token Test Bench State
  const [testToken, setTestToken] = useState('');
  const [testBeaconId, setTestBeaconId] = useState('HG-BEACON-BLKA-01');
  const [testResult, setTestResult] = useState(null);
  const [verifyingToken, setVerifyingToken] = useState(false);

  useEffect(() => {
    fetchConfig();
    fetchBleConfig();
  }, []);

  const handleMapLocationChange = ({ latitude, longitude }) => {
    setConfig(prev => ({
      ...prev,
      latitude,
      longitude
    }));
    setStatusMsg(`Center anchor updated to [${latitude}, ${longitude}] from map. Remember to save changes.`);
  };

  const fetchConfig = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.admin.getGeofence();
      const conf = data?.config || data;
      if (conf && conf.latitude !== undefined) {
        setConfig({
          facility_name: conf.facility_name || conf.hostel_name || 'Main Hostel Campus',
          latitude: conf.latitude,
          longitude: conf.longitude,
          radius_meters: conf.radius_meters || 20,
          is_active: conf.is_active !== undefined ? conf.is_active : 1
        });
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to load geofence perimeter');
    } finally {
      setLoading(false);
    }
  };

  const fetchBleConfig = async () => {
    setBleLoading(true);
    try {
      const data = await api.admin.getBleConfig();
      if (data?.success) {
        setBleMode(data.ble_mode || 'STANDBY_OPTIONAL');
        setBeacons(Array.isArray(data.beacons) ? data.beacons : []);
      }
    } catch (err) {
      console.warn('Non-fatal BLE fetch notice:', err.message);
    } finally {
      setBleLoading(false);
    }
  };

  const handleBleModeChange = async (newMode) => {
    setBleSaving(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await api.admin.updateBleMode(newMode);
      if (res?.success) {
        setBleMode(newMode);
        setStatusMsg(`ESP32 BLE Radio Anchor policy successfully switched to ${newMode}`);
      }
    } catch (err) {
      setErrorMsg(`Failed to update BLE mode: ${err.message}`);
    } finally {
      setBleSaving(false);
    }
  };

  const handleGenerateSecret = async () => {
    try {
      const res = await api.admin.generateBleSecret();
      if (res?.secret) {
        setNewBeacon(prev => ({ ...prev, shared_secret_ref: res.secret }));
      }
    } catch (err) {
      setErrorMsg(`Failed to generate secret: ${err.message}`);
    }
  };

  const handleToggleBeacon = async (id, name) => {
    try {
      const res = await api.admin.toggleBleBeacon(id);
      if (res?.success) {
        setStatusMsg(`Beacon "${name}" ${res.is_active ? 'activated' : 'deactivated (Kill-switch applied)'}.`);
        await fetchBleConfig();
      }
    } catch (err) {
      setErrorMsg(`Failed to toggle beacon: ${err.message}`);
    }
  };

  const handleDownloadSketch = (beacon) => {
    const url = api.admin.downloadBeaconSketchUrl(beacon.id);
    const token = localStorage.getItem('token');
    fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(res => res.blob())
      .then(blob => {
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `esp32_${(beacon.beacon_public_id || 'beacon').toLowerCase().replace(/[^a-z0-9_]/g, '_')}.ino`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(downloadUrl);
        setStatusMsg(`Pre-configured Arduino firmware (.ino) downloaded for ${beacon.block_name || beacon.beacon_public_id}! Open in Arduino IDE 2.3.10 and click Upload (Target: ESP32 Dev Module).`);
      })
      .catch(err => setErrorMsg(`Failed to download sketch: ${err.message}`));
  };

  const handleSaveBeacon = async (e) => {
    e.preventDefault();
    const floorName = newBeacon.block_name ? newBeacon.block_name.trim() : '';
    if (!floorName && !newBeacon.beacon_public_id) {
      setErrorMsg('Floor / Placement Name is required (e.g. Ground Floor, 1st Floor).');
      return;
    }
    const resolvedPublicId = newBeacon.beacon_public_id?.trim() || floorName;
    const resolvedBlockName = floorName || resolvedPublicId;

    setBleSaving(true);
    setErrorMsg(null);
    try {
      const res = await api.admin.saveBleBeacon({
        ...newBeacon,
        beacon_public_id: resolvedPublicId,
        block_name: resolvedBlockName
      });
      if (res?.success) {
        setStatusMsg(`ESP32 Beacon "${resolvedBlockName}" registered successfully!`);
        setShowAddBeacon(false);
        setNewBeacon({ beacon_public_id: '', block_name: '', shared_secret_ref: '' });
        await fetchBleConfig();
      }
    } catch (err) {
      setErrorMsg(`Failed to register beacon: ${err.message}`);
    } finally {
      setBleSaving(false);
    }
  };

  const handleVerifyLiveToken = async (e) => {
    e.preventDefault();
    if (!testToken) return;
    setVerifyingToken(true);
    setTestResult(null);
    try {
      const res = await api.admin.verifyBleToken({
        beacon_public_id: testBeaconId,
        rolling_code: testToken.trim().toUpperCase()
      });
      setTestResult(res?.verification || { isValid: false, reason: 'VERIFICATION_FAILED' });
      if (res?.verification?.isValid) {
        setStatusMsg(`Physical ESP32 token [${testToken.trim().toUpperCase()}] verified successfully against backend HMAC engine! (Time drift: ${res.verification.timeSkewSlots || 0} slots)`);
        await fetchBleConfig();
      }
    } catch (err) {
      setTestResult({ isValid: false, reason: err.message });
    } finally {
      setVerifyingToken(false);
    }
  };

  const handleDeleteBeacon = async (id, name) => {
    if (!window.confirm(`Are you sure you want to remove beacon "${name}"?`)) return;
    setBleSaving(true);
    try {
      const res = await api.admin.deleteBleBeacon(id);
      if (res?.success) {
        setStatusMsg(`Beacon removed successfully.`);
        await fetchBleConfig();
      }
    } catch (err) {
      setErrorMsg(`Failed to delete beacon: ${err.message}`);
    } finally {
      setBleSaving(false);
    }
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleDetectGPS = () => {
    if (!navigator.geolocation) {
      setErrorMsg('Browser Geolocation API is not supported on this device.');
      return;
    }
    setDetecting(true);
    setErrorMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = parseFloat(pos.coords.latitude.toFixed(6));
        const lng = parseFloat(pos.coords.longitude.toFixed(6));
        setConfig(prev => ({
          ...prev,
          latitude: lat,
          longitude: lng
        }));
        setStatusMsg(`Current coordinates detected: ${lat}, ${lng} (Accuracy: ±${Math.round(pos.coords.accuracy)}m)`);
        setDetecting(false);
      },
      (err) => {
        setErrorMsg(`GPS detection error: ${err.message}`);
        setDetecting(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    setStatusMsg(null);

    const lat = parseFloat(config.latitude);
    const lng = parseFloat(config.longitude);
    const rad = parseFloat(config.radius_meters);

    if (isNaN(lat) || lat < -90 || lat > 90) {
      setErrorMsg('Latitude must be a valid coordinate between -90 and 90');
      setSaving(false);
      return;
    }
    if (isNaN(lng) || lng < -180 || lng > 180) {
      setErrorMsg('Longitude must be a valid coordinate between -180 and 180');
      setSaving(false);
      return;
    }
    if (isNaN(rad) || rad < 10 || rad > 150) {
      setErrorMsg('Permitted radius must be between 10.0m and 150.0m to maintain anti-spoof perimeter integrity');
      setSaving(false);
      return;
    }

    try {
      const res = await api.admin.updateGeofence({
        facility_name: config.facility_name,
        latitude: lat,
        longitude: lng,
        radius_meters: rad,
        is_active: config.is_active ? 1 : 0
      });
      if (res?.success) {
        setStatusMsg('Geofence perimeter policy updated, calibrated, and deployed successfully.');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to update geofence');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-5">
        <div className="spinner-border text-primary" role="status"></div>
        <div className="mt-2 text-muted">Loading geofence calibration...</div>
      </div>
    );
  }

  return (
    <div className="geofence-manager">
      <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2">
        <div>
          <h5 className="fw-bold text-dark mb-1 d-flex align-items-center gap-2">
            <MapPin size={22} className="text-primary" />
            Hostel Geofence & BLE Radio Anchor Calibration
          </h5>
          <p className="text-muted small mb-0">
            Define high-precision facility boundary coordinates, permitted check-in radius, and hot-swappable ESP32 BLE anchors.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { fetchConfig(); fetchBleConfig(); }}
          className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1"
        >
          <RefreshCw size={14} /> Refresh Status
        </button>
      </div>

      {statusMsg && (
        <div className="alert alert-success d-flex align-items-center gap-2 shadow-sm py-2">
          <CheckCircle2 size={18} className="text-success flex-shrink-0" />
          <div className="small flex-grow-1">{statusMsg}</div>
          <button type="button" className="btn-close btn-sm" onClick={() => setStatusMsg(null)}></button>
        </div>
      )}

      {errorMsg && (
        <div className="alert alert-danger d-flex align-items-center gap-2 shadow-sm py-2">
          <AlertTriangle size={18} className="text-danger flex-shrink-0" />
          <div className="small flex-grow-1">{errorMsg}</div>
          <button type="button" className="btn-close btn-sm" onClick={() => setErrorMsg(null)}></button>
        </div>
      )}

      {/* Row 1: Interactive Map & Primary GPS Coordinates */}
      <div className="row g-4 mb-4">
        <div className="col-lg-7">
          <div className="card shadow-sm border-0 rounded-3 mb-4">
            <div className="card-header bg-white border-bottom py-3 d-flex justify-content-between align-items-center">
              <h6 className="card-title mb-0 fw-semibold d-flex align-items-center gap-2">
                <Navigation size={18} className="text-primary" />
                Hostel Center Anchor Calibration
              </h6>
              <button
                type="button"
                onClick={handleDetectGPS}
                disabled={detecting}
                className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1"
              >
                {detecting ? (
                  <>
                    <span className="spinner-border spinner-border-sm" role="status"></span>
                    Detecting GPS...
                  </>
                ) : (
                  <>
                    <Navigation size={14} /> Use Current Device GPS
                  </>
                )}
              </button>
            </div>
            <div className="card-body p-4">
              {/* Add Beacon Form Modal/Card */}
              {showAddBeacon && (
                <div id="beaconRegistrationCard" className="card border border-primary shadow-sm rounded-3 p-3 mb-4 bg-light">
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <h6 className="fw-bold text-primary mb-0 d-flex align-items-center gap-2">
                      <Zap size={16} /> Register New ESP32 Physical Beacon
                    </h6>
                    <button type="button" className="btn-close btn-sm" onClick={() => setShowAddBeacon(false)}></button>
                  </div>
                  <form onSubmit={handleSaveBeacon}>
                    <div className="row g-3">
                      <div className="col-md-7">
                        <label className="form-label small fw-bold text-muted">Floor / Placement Name</label>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          placeholder="e.g. Ground Floor, 1st Floor, 2nd Floor, Mess Hall"
                          value={newBeacon.block_name}
                          onChange={(e) => {
                            const val = e.target.value;
                            setNewBeacon({
                              ...newBeacon,
                              block_name: val,
                              beacon_public_id: val.trim()
                            });
                          }}
                          autoFocus
                          required
                        />
                        <div className="form-text small" style={{ fontSize: '11px' }}>
                          Simply enter the floor name (e.g. &quot;1st Floor&quot;). This will be used in both the dashboard and the ESP32 code.
                        </div>
                      </div>
                      <div className="col-md-5">
                        <label className="form-label small fw-bold text-muted mb-1">Hardware Security Key</label>
                        <input
                          type="text"
                          className="form-control form-control-sm font-monospace text-muted"
                          value={newBeacon.shared_secret_ref ? '●●●●●●●● (Auto-Configured AES-256)' : 'Click to Auto-Generate'}
                          readOnly
                          style={{ backgroundColor: '#f8fafc', fontSize: '11px' }}
                        />
                      </div>
                    </div>
                    <div className="d-flex justify-content-end gap-2 mt-3">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => setShowAddBeacon(false)}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={bleSaving}
                        className="btn btn-sm btn-primary d-flex align-items-center gap-1 px-3"
                      >
                        <Save size={14} /> {bleSaving ? 'Saving...' : 'Save & Register Beacon'}
                      </button>
                    </div>
                  </form>
                </div>
              )}
              <form onSubmit={handleSave}>
                <div className="mb-3">
                  <label className="form-label small fw-bold text-muted">Facility / Hostel Block Name</label>
                  <input
                    type="text"
                    className="form-control"
                    value={config.facility_name}
                    onChange={(e) => setConfig({ ...config, facility_name: e.target.value })}
                    required
                  />
                </div>

                <div className="row g-3 mb-3">
                  <div className="col-md-6">
                    <label className="form-label small fw-bold text-muted">Center Latitude (°N)</label>
                    <input
                      type="number"
                      step="0.000001"
                      className="form-control font-monospace"
                      value={config.latitude}
                      onChange={(e) => setConfig({ ...config, latitude: e.target.value })}
                      required
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-bold text-muted">Center Longitude (°E)</label>
                    <input
                      type="number"
                      step="0.000001"
                      className="form-control font-monospace"
                      value={config.longitude}
                      onChange={(e) => setConfig({ ...config, longitude: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="mb-4">
                  <div className="d-flex justify-content-between align-items-center mb-1">
                    <label className="form-label small fw-bold text-muted mb-0">
                      Permitted Attendance Radius (Haversine Boundary)
                    </label>
                    <span className="badge bg-primary fs-6 px-3 py-1">
                      {config.radius_meters} meters
                    </span>
                  </div>
                  <input
                    type="range"
                    className="form-range"
                    min="10"
                    max="150"
                    step="5"
                    value={config.radius_meters}
                    onChange={(e) => setConfig({ ...config, radius_meters: parseInt(e.target.value, 10) })}
                  />
                  <div className="d-flex justify-content-between text-muted small">
                    <span>10m (High Security)</span>
                    <span>20m (Default Standard)</span>
                    <span>50m (Multi-Wing)</span>
                    <span>150m (Full Campus)</span>
                  </div>
                </div>

                <div className="mb-4">
                  <label className="form-label small fw-bold text-muted mb-2">Interactive Satellite & Hybrid Calibration Map</label>
                  <GeofenceMap
                    centerLat={parseFloat(config.latitude) || 26.140462}
                    centerLng={parseFloat(config.longitude) || 91.656606}
                    latitude={parseFloat(config.latitude) || 26.140462}
                    longitude={parseFloat(config.longitude) || 91.656606}
                    radius={parseFloat(config.radius_meters) || 60}
                    facilityName={config.facility_name}
                    locationName={config.facility_name}
                    interactive={true}
                    onLocationChange={handleMapLocationChange}
                    height="380px"
                    beacons={beacons || []}
                    bleMode={bleMode || 'STANDBY_OPTIONAL'}
                  />
                  <div className="form-text small mt-1">
                    Click anywhere on the map or drag the boundary marker to update the center anchor coordinates.
                  </div>
                </div>

                <div className="form-check form-switch mb-4">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="enforceGeofence"
                    checked={config.is_active === 1}
                    onChange={(e) => setConfig({ ...config, is_active: e.target.checked ? 1 : 0 })}
                  />
                  <label className="form-check-label small fw-semibold" htmlFor="enforceGeofence">
                    Enforce Server-Side Geofence Validation
                  </label>
                  <div className="form-text">
                    When active, check-in requests outside {config.radius_meters}m trigger automatic forge-location strikes.
                  </div>
                </div>

                <div className="d-flex gap-2">
                  <button
                    type="submit"
                    className="btn btn-primary d-flex align-items-center gap-2 px-4"
                    disabled={saving}
                  >
                    {saving ? (
                      <>
                        <span className="spinner-border spinner-border-sm" role="status"></span>
                        Saving Policy...
                      </>
                    ) : (
                      <>
                        <Save size={16} /> Save & Apply Policy
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>

        {/* Info Column */}
        <div className="col-lg-5">
          <div className="card shadow-sm border-0 rounded-3 mb-4">
            <div className="card-header bg-white border-bottom py-3">
              <h6 className="card-title mb-0 fw-semibold d-flex align-items-center gap-2">
                <Compass size={18} className="text-primary" />
                Perimeter Policy Summary
              </h6>
            </div>
            <div className="card-body p-4">
              <ul className="list-group list-group-flush small">
                <li className="list-group-item d-flex justify-content-between px-0">
                  <span className="text-muted">Enforcement Status:</span>
                  <span className={`badge ${config.is_active ? 'bg-success' : 'bg-secondary'}`}>
                    {config.is_active ? 'Active & Enforced' : 'Disabled (Bypass)'}
                  </span>
                </li>
                <li className="list-group-item d-flex justify-content-between px-0">
                  <span className="text-muted">Target Facility:</span>
                  <span className="fw-medium text-dark">{config.facility_name}</span>
                </li>
                <li className="list-group-item d-flex justify-content-between px-0">
                  <span className="text-muted">Center Latitude:</span>
                  <code className="text-primary fw-bold">{Number(config.latitude).toFixed(6)}°</code>
                </li>
                <li className="list-group-item d-flex justify-content-between px-0">
                  <span className="text-muted">Center Longitude:</span>
                  <code className="text-primary fw-bold">{Number(config.longitude).toFixed(6)}°</code>
                </li>
                <li className="list-group-item d-flex justify-content-between px-0">
                  <span className="text-muted">Permitted Radius:</span>
                  <span className="fw-bold text-success">{config.radius_meters} meters</span>
                </li>
                <li className="list-group-item d-flex justify-content-between px-0">
                  <span className="text-muted">Active BLE Anchor Policy:</span>
                  <span className={`badge ${bleMode === 'STANDBY_OPTIONAL' ? 'bg-info text-dark' : (bleMode === 'SOFT_ANCHOR' ? 'bg-warning text-dark' : 'bg-danger')}`}>
                    {bleMode}
                  </span>
                </li>
                <li className="list-group-item d-flex justify-content-between px-0">
                  <span className="text-muted">Registered ESP32 Beacons:</span>
                  <span className="fw-bold text-dark">{beacons.length} units</span>
                </li>
                <li className="list-group-item d-flex justify-content-between px-0">
                  <span className="text-muted">Strike Threshold:</span>
                  <span className="text-danger fw-semibold">3 Out-of-Range Attempts</span>
                </li>
              </ul>
            </div>
          </div>

          <div className="card shadow-sm border-0 rounded-3 bg-white p-3 border-start border-4 border-primary">
            <h6 className="fw-bold text-dark mb-2 small d-flex align-items-center gap-2">
              <Radio size={16} className="text-primary" />
              ESP32 Bluetooth Setup Guide
            </h6>
            <div className="text-muted" style={{ fontSize: '11px', lineHeight: '1.6' }}>
              <div className="mb-1"><strong>1. Power On:</strong> Plug ESP32 into any standard 5V USB wall adapter (phone charger) in the hallway.</div>
              <div className="mb-1"><strong>2. Multi-Floor Setup:</strong> 1 ESP32 covers ~15–20 meters. Install one ESP32 on each floor or wing (Ground, 1st, 2nd) for complete hostel coverage.</div>
              <div className="mb-1"><strong>3. Automatic:</strong> Students' phones connect automatically to the nearest floor beacon when opening the attendance screen.</div>
              <div><strong>4. Maintenance Free:</strong> Runs 24/7 automatically without needing a computer.</div>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: ESP32 Hardware Beacon Manager (Plug-and-Play) */}
      <div className="row g-4">
        <div className="col-12">
          <div className="card shadow-sm border-0 rounded-3">
            <div className="card-header bg-white border-bottom py-3 d-flex justify-content-between align-items-center flex-wrap gap-2">
              <div className="d-flex align-items-center gap-2">
                <Cpu size={20} className="text-primary" />
                <h6 className="card-title mb-0 fw-bold">
                  Hostel Bluetooth Radio Anchors (ESP32 Setup & Management)
                </h6>
                <span className={`badge ${bleMode === 'STANDBY_OPTIONAL' ? 'bg-info text-dark' : (bleMode === 'SOFT_ANCHOR' ? 'bg-warning text-dark' : 'bg-danger')}`}>
                  {bleMode === 'STANDBY_OPTIONAL' && 'Standby: GPS & Face Mode'}
                  {bleMode === 'SOFT_ANCHOR' && 'Soft Anchor: Smart Proximity'}
                  {bleMode === 'STRICT_REQUIRED' && 'Strict Lock: Hardware Enforced'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowAddBeacon(prev => !prev);
                  handleGenerateSecret();
                  setTimeout(() => {
                    document.getElementById('beaconRegistrationCard')?.scrollIntoView({ behavior: 'smooth' });
                  }, 50);
                }}
                className="btn btn-sm btn-primary d-flex align-items-center gap-1 shadow-sm"
              >
                <Plus size={14} /> Register New ESP32 Beacon
              </button>
            </div>

            <div className="card-body p-4">
              {/* ESP32 Hardware Status & Simple Admin Quick Guide */}
              <div className={`card border-0 rounded-3 p-3 mb-4 shadow-sm bg-light border-start border-4 ${bleMode === 'STRICT_REQUIRED' ? 'border-danger' : (bleMode === 'SOFT_ANCHOR' ? 'border-warning' : 'border-primary')}`}>
                <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
                  <div className="d-flex align-items-center gap-2">
                    <Radio size={16} className={bleMode === 'STRICT_REQUIRED' ? 'text-danger' : 'text-primary'} />
                    <h6 className="fw-bold mb-0 text-dark d-flex align-items-center gap-2" style={{ fontSize: '14px' }}>
                      Hostel Bluetooth Radio Anchors (ESP32)
                    </h6>
                  </div>
                  <span className={`badge ${bleMode === 'STRICT_REQUIRED' ? 'bg-danger text-white' : (bleMode === 'SOFT_ANCHOR' ? 'bg-warning text-dark' : 'bg-info text-dark')} px-2 py-1`} style={{ fontSize: '11px' }}>
                    {bleMode === 'STRICT_REQUIRED' ? 'Strict Lock: Hardware Mandatory' : (bleMode === 'SOFT_ANCHOR' ? 'Soft Anchor: Smart Proximity' : 'Standby Mode: GPS & Face')}
                  </span>
                </div>
                <p className="text-muted small mb-2" style={{ fontSize: '12px' }}>
                  <strong>Standalone Offline Hardware:</strong> ESP32 boards broadcast offline 2.4 GHz Bluetooth radio signals locally (~15m corridor range). They do not connect to Wi-Fi or the cloud. A board&apos;s physical presence and power are verified in real time when a student&apos;s phone Bluetooth antenna scans during check-in.
                </p>
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <form onSubmit={handleVerifyLiveToken} className="d-flex gap-2 align-items-center">
                    <input
                      type="text"
                      className="form-control form-control-sm font-monospace text-uppercase"
                      placeholder="Optional: Test Token (e.g. 7B3A91FC)"
                      maxLength={8}
                      value={testToken}
                      onChange={(e) => setTestToken(e.target.value)}
                      style={{ maxWidth: '240px', fontSize: '11px' }}
                    />
                    <button
                      type="submit"
                      disabled={verifyingToken || !testToken}
                      className="btn btn-sm btn-outline-primary py-1 px-2"
                      style={{ fontSize: '11px' }}
                    >
                      {verifyingToken ? 'Checking...' : 'Test Signal'}
                    </button>
                  </form>
                  {testResult && (
                    <span className={`badge ${testResult.isValid ? 'bg-success' : 'bg-danger'} py-1 px-2`} style={{ fontSize: '11px' }}>
                      {testResult.isValid ? '✓ Signal Verified' : '✕ Code Mismatch'}
                    </span>
                  )}
                </div>
              </div>

              {/* 3-Mode Policy Switcher */}
              <div className="mb-4">
                <label className="form-label small fw-bold text-muted mb-2">
                  Select Attendance Bluetooth Enforcement Mode
                </label>
                <div className="row g-3">
                  <div className="col-md-4">
                    <div
                      className={`card h-100 p-3 border-2 cursor-pointer transition-all ${bleMode === 'STANDBY_OPTIONAL' ? 'border-primary bg-primary bg-opacity-10' : 'border-light bg-light'}`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => handleBleModeChange('STANDBY_OPTIONAL')}
                    >
                      <div className="d-flex align-items-center justify-content-between mb-2">
                        <span className="badge bg-info text-dark fw-bold">1. STANDBY</span>
                        {bleMode === 'STANDBY_OPTIONAL' && <ShieldCheck size={18} className="text-primary" />}
                      </div>
                      <h6 className="fw-bold mb-1">GPS & Face Mode</h6>
                      <p className="text-muted small mb-0" style={{ fontSize: '12px' }}>
                        Attendance is verified by GPS boundary and facial recognition. Bluetooth presence is optional.
                      </p>
                    </div>
                  </div>

                  <div className="col-md-4">
                    <div
                      className={`card h-100 p-3 border-2 cursor-pointer transition-all ${bleMode === 'SOFT_ANCHOR' ? 'border-warning bg-warning bg-opacity-10' : 'border-light bg-light'}`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => handleBleModeChange('SOFT_ANCHOR')}
                    >
                      <div className="d-flex align-items-center justify-content-between mb-2">
                        <span className="badge bg-warning text-dark fw-bold">2. SOFT ANCHOR (Recommended)</span>
                        {bleMode === 'SOFT_ANCHOR' && <ShieldCheck size={18} className="text-warning" />}
                      </div>
                      <h6 className="fw-bold mb-1">Smart Proximity Verification</h6>
                      <p className="text-muted small mb-0" style={{ fontSize: '12px' }}>
                        Detecting the ESP32 grants instant attendance. If signal is weak or blocked by thick walls, students do a quick screen-flash face check with 0 strikes.
                      </p>
                    </div>
                  </div>

                  <div className="col-md-4">
                    <div
                      className={`card h-100 p-3 border-2 cursor-pointer transition-all ${bleMode === 'STRICT_REQUIRED' ? 'border-danger bg-danger bg-opacity-10' : 'border-light bg-light'}`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => handleBleModeChange('STRICT_REQUIRED')}
                    >
                      <div className="d-flex align-items-center justify-content-between mb-2">
                        <span className="badge bg-danger text-white fw-bold">3. STRICT LOCK</span>
                        {bleMode === 'STRICT_REQUIRED' && <ShieldCheck size={18} className="text-danger" />}
                      </div>
                      <h6 className="fw-bold mb-1">Physical Presence Lock</h6>
                      <p className="text-muted small mb-0" style={{ fontSize: '12px' }}>
                        Students must be physically in range of an authorized hostel ESP32. Completely stops fake GPS apps and remote proxy check-ins.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Table of Registered Beacons */}
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead className="table-light small">
                    <tr>
                      <th>Beacon ID</th>
                      <th>Floor / Wing Location</th>
                      <th>Security Link</th>
                      <th>Last Student Check-in Scan</th>
                      <th>Policy Status</th>
                      <th className="text-end">Action</th>
                    </tr>
                  </thead>
                  <tbody className="small">
                    {beacons.length === 0 ? (
                      <tr>
                        <td colSpan="6" className="text-center py-4 text-muted">
                          No physical beacons registered yet. Click &quot;Register New ESP32 Beacon&quot; to add floor anchors.
                        </td>
                      </tr>
                    ) : (
                      beacons.map((b) => (
                        <tr key={b.id}>
                          <td>
                            <code className="fw-bold text-primary">{b.beacon_public_id}</code>
                          </td>
                          <td className="fw-medium text-dark">{b.block_name || 'Ground Floor'}</td>
                          <td>
                            <span className="badge bg-light text-dark border font-monospace" style={{ fontSize: '11px' }}>
                              Hardware Linked (AES-256)
                            </span>
                          </td>
                          <td>
                            <span className="text-muted">
                              <Clock size={12} className="me-1 inline" />
                              {b.last_seen_at ? formatTime12h(b.last_seen_at) : 'Awaiting Student Scan'}
                            </span>
                          </td>
                          <td>
                            <span className={`badge ${b.is_active ? 'bg-success' : 'bg-secondary'}`}>
                              {b.is_active ? 'Enabled' : 'Disabled'}
                            </span>
                          </td>
                          <td className="text-end">
                            <div className="d-flex justify-content-end gap-1">
                              <button
                                type="button"
                                onClick={() => handleDownloadSketch(b)}
                                className="btn btn-sm btn-outline-primary p-1"
                                title="Download Ready-to-Flash .ino Firmware Sketch for Arduino IDE (ESP32 Dev Module)"
                              >
                                <Download size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleBeacon(b.id, b.beacon_public_id)}
                                className={`btn btn-sm p-1 ${b.is_active ? 'btn-outline-warning' : 'btn-outline-success'}`}
                                title={b.is_active ? "Kill Switch: Immediately Deactivate Stolen/Compromised Beacon" : "Reactivate Beacon"}
                              >
                                <Power size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteBeacon(b.id, b.beacon_public_id)}
                                className="btn btn-sm btn-outline-danger p-1"
                                title="Delete Beacon"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Multi-Floor & RF Coverage Advice Card */}
              <div className="mt-4 p-3 bg-light rounded-3 d-flex align-items-center justify-content-between flex-wrap gap-2 border">
                <div className="d-flex align-items-center gap-2">
                  <Radio size={16} className="text-primary flex-shrink-0" />
                  <div className="small text-muted" style={{ fontSize: '12px' }}>
                    <strong>Multi-Story / Large Hostel Deployment:</strong> Thick concrete floor slabs attenuate Bluetooth radio signals (~15–20m range per floor). For complete multi-floor coverage, register 1 ESP32 board per floor (e.g. Ground Floor, 1st Floor, 2nd Floor). Students automatically check in to the nearest board.
                  </div>
                </div>
                <span className="badge bg-dark px-2 py-1" style={{ fontSize: '11px' }}>Multi-ESP Ready</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
