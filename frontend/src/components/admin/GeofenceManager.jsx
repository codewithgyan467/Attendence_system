import React, { useState, useEffect } from 'react';
import { api } from '../../utils/api';
import { MapPin, Navigation, Save, CheckCircle2, AlertTriangle, RefreshCw, Compass } from 'lucide-react';

export default function GeofenceManager() {
  const [config, setConfig] = useState({
    facility_name: 'Main Hostel Campus',
    latitude: 28.5355,
    longitude: 77.3910,
    radius_meters: 20,
    is_active: 1
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.admin.getGeofence();
      if (data && data.latitude !== undefined) {
        setConfig(data);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to load geofence perimeter');
    } finally {
      setLoading(false);
    }
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
    if (isNaN(rad) || rad < 5 || rad > 500) {
      setErrorMsg('Radius must be between 5 and 500 meters (Policy standard is 10-20 meters).');
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
      setStatusMsg(res.message || 'Geofence perimeter successfully updated and enforced.');
    } catch (err) {
      setErrorMsg(err.message || 'Failed to update geofence configuration');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="card shadow-sm border-0 p-5 text-center bg-white rounded-3">
        <div className="spinner-border text-primary mx-auto mb-3" role="status"></div>
        <p className="text-muted mb-0">Retrieving authoritative hostel geofence parameters...</p>
      </div>
    );
  }

  return (
    <div className="container-fluid px-0">
      {/* Header */}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-2">
        <div>
          <h4 className="fw-bold mb-1 d-flex align-items-center gap-2">
            <MapPin className="text-primary" size={24} />
            Geofence Perimeter Configuration
          </h4>
          <p className="text-muted small mb-0">
            Configure authoritative central GPS coordinates and acceptable attendance radius (Server enforced via Haversine algorithm).
          </p>
        </div>
        <button
          className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
          onClick={fetchConfig}
          disabled={loading}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {statusMsg && (
        <div className="alert alert-success d-flex align-items-center gap-2 alert-dismissible fade show mb-4" role="alert">
          <CheckCircle2 size={18} className="flex-shrink-0" />
          <div>{statusMsg}</div>
          <button type="button" className="btn-close" onClick={() => setStatusMsg(null)}></button>
        </div>
      )}

      {errorMsg && (
        <div className="alert alert-danger d-flex align-items-center gap-2 alert-dismissible fade show mb-4" role="alert">
          <AlertTriangle size={18} className="flex-shrink-0" />
          <div>{errorMsg}</div>
          <button type="button" className="btn-close" onClick={() => setErrorMsg(null)}></button>
        </div>
      )}

      <div className="row g-4">
        {/* Form Column */}
        <div className="col-lg-7">
          <div className="card shadow-sm border-0 rounded-3 h-100">
            <div className="card-header bg-white border-bottom py-3">
              <h6 className="card-title mb-0 fw-semibold">GPS Anchor Parameters</h6>
            </div>
            <div className="card-body p-4">
              <form onSubmit={handleSave}>
                <div className="mb-3">
                  <label className="form-label fw-medium small">Facility / Hostel Campus Name</label>
                  <input
                    type="text"
                    className="form-control"
                    value={config.facility_name || ''}
                    onChange={(e) => setConfig({ ...config, facility_name: e.target.value })}
                    required
                  />
                  <div className="form-text">e.g., Campus Alpha Hostel Block, Boys Hostel Complex</div>
                </div>

                <div className="row g-3 mb-3">
                  <div className="col-md-6">
                    <label className="form-label fw-medium small">Center Latitude (°N/S)</label>
                    <input
                      type="number"
                      step="0.000001"
                      className="form-control"
                      value={config.latitude}
                      onChange={(e) => setConfig({ ...config, latitude: e.target.value })}
                      required
                    />
                    <div className="form-text">e.g., 28.535512</div>
                  </div>

                  <div className="col-md-6">
                    <label className="form-label fw-medium small">Center Longitude (°E/W)</label>
                    <input
                      type="number"
                      step="0.000001"
                      className="form-control"
                      value={config.longitude}
                      onChange={(e) => setConfig({ ...config, longitude: e.target.value })}
                      required
                    />
                    <div className="form-text">e.g., 77.391028</div>
                  </div>
                </div>

                <div className="mb-3">
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm d-flex align-items-center gap-2"
                    onClick={handleDetectGPS}
                    disabled={detecting}
                  >
                    {detecting ? (
                      <>
                        <span className="spinner-border spinner-border-sm" role="status"></span>
                        Detecting Location...
                      </>
                    ) : (
                      <>
                        <Navigation size={15} />
                        Detect Current Device Coordinates
                      </>
                    )}
                  </button>
                  <span className="form-text ms-2 small">Uses device GPS to auto-populate center anchor.</span>
                </div>

                <hr className="my-4 text-muted opacity-25" />

                <div className="mb-4">
                  <div className="d-flex justify-content-between align-items-center mb-1">
                    <label className="form-label fw-medium small mb-0">Permitted Geofence Radius</label>
                    <span className="badge bg-primary fs-6">{config.radius_meters} Meters</span>
                  </div>
                  <input
                    type="range"
                    className="form-range"
                    min="10"
                    max="100"
                    step="1"
                    value={config.radius_meters}
                    onChange={(e) => setConfig({ ...config, radius_meters: parseInt(e.target.value) })}
                  />
                  <div className="d-flex justify-content-between text-muted small">
                    <span>Strict (10m)</span>
                    <span className="fw-semibold text-primary">Standard Directive (15m - 20m)</span>
                    <span>Relaxed (100m)</span>
                  </div>
                </div>

                <div className="mb-4 form-check form-switch">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="geofenceActiveSwitch"
                    checked={Boolean(config.is_active)}
                    onChange={(e) => setConfig({ ...config, is_active: e.target.checked ? 1 : 0 })}
                  />
                  <label className="form-check-label fw-medium" htmlFor="geofenceActiveSwitch">
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

        {/* Info & Perimeter Inspector Column */}
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
                  <span className="text-muted">Verification Algorithm:</span>
                  <span className="text-dark">Haversine (Great-Circle Distance)</span>
                </li>
                <li className="list-group-item d-flex justify-content-between px-0">
                  <span className="text-muted">Strike Threshold:</span>
                  <span className="text-danger fw-semibold">3 Out-of-Range Attempts</span>
                </li>
              </ul>
            </div>
          </div>

          <div className="card shadow-sm border-0 rounded-3 bg-light p-3">
            <h6 className="fw-semibold text-dark mb-2 small d-flex align-items-center gap-2">
              <AlertTriangle size={16} className="text-warning" />
              Security Architectural Note
            </h6>
            <p className="text-muted small mb-0" style={{ lineHeight: '1.5' }}>
              Client coordinates are treated as untrusted input. The server independently calculates the great-circle distance using 64-bit floating point Haversine math. Mock GPS detection and timestamp freshness checks are layered on top to prevent replay spoofing.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
