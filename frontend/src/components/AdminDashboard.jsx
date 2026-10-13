import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import {
  Upload,
  MapPin,
  AlertTriangle,
  Users,
  CheckCircle,
  FileSpreadsheet,
  Download,
  Crosshair,
  ShieldAlert,
  RotateCcw
} from 'lucide-react';

export default function AdminDashboard() {
  const [activeSubTab, setActiveSubTab] = useState('allotments');
  const [stats, setStats] = useState(null);
  const [allotments, setAllotments] = useState([]);
  const [geofence, setGeofence] = useState({
    hostel_name: 'Main Hostel Campus',
    latitude: 28.5450,
    longitude: 77.1926,
    radius_meters: 20.0
  });
  const [alerts, setAlerts] = useState({ flaggedCount: 0, flaggedStudents: [], recentAuditLogs: [] });
  const [reports, setReports] = useState({ summary: {}, records: [] });
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState({ text: '', type: '' });

  // Load dashboard data
  const loadData = async () => {
    try {
      setLoading(true);
      const [statsData, allotData, geoData, alertsData, reportsData] = await Promise.all([
        api.getStats().catch(() => null),
        api.getAllotments().catch(() => []),
        api.getGeofenceConfig().catch(() => null),
        api.getSecurityAlerts().catch(() => ({ flaggedCount: 0, flaggedStudents: [], recentAuditLogs: [] })),
        api.getReports().catch(() => ({ summary: {}, records: [] }))
      ]);

      if (statsData) setStats(statsData);
      if (allotData) setAllotments(allotData);
      if (geoData) setGeofence(geoData);
      if (alertsData) setAlerts(alertsData);
      if (reportsData) setReports(reportsData);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const showFeedback = (text, type = 'success') => {
    setFeedback({ text, type });
    setTimeout(() => setFeedback({ text: '', type: '' }), 5000);
  };

  // CSV Upload handler
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      setLoading(true);
      const res = await api.uploadAllotmentCsv(file);
      showFeedback(res.message, 'success');
      loadData();
    } catch (err) {
      showFeedback(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Quick Seed Sample Allotments
  const handleSeedSamples = async () => {
    const sampleStudents = [
      { roll_number: '2023CS101', full_name: 'Ishaan Verma', room_number: 'C-301', hostel_block: 'Block C' },
      { roll_number: '2023CS102', full_name: 'Pooja Gupta', room_number: 'C-302', hostel_block: 'Block C' },
      { roll_number: '2023EC105', full_name: 'Vikram Joshi', room_number: 'C-303', hostel_block: 'Block C' },
      { roll_number: '2023ME108', full_name: 'Sneha Reddy', room_number: 'D-101', hostel_block: 'Block D' }
    ];

    try {
      setLoading(true);
      const res = await api.uploadAllotmentJson(sampleStudents);
      showFeedback(res.message, 'success');
      loadData();
    } catch (err) {
      showFeedback(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Update Geofence
  const handleSaveGeofence = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      await api.updateGeofenceConfig(geofence);
      showFeedback('Geofence coordinates and boundary saved!', 'success');
      loadData();
    } catch (err) {
      showFeedback(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Use current browser GPS location for Geofence
  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      showFeedback('Geolocation is not supported by your browser.', 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeofence((prev) => ({
          ...prev,
          latitude: parseFloat(pos.coords.latitude.toFixed(6)),
          longitude: parseFloat(pos.coords.longitude.toFixed(6))
        }));
        showFeedback(`Captured current GPS: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`, 'success');
      },
      (err) => {
        showFeedback(`GPS Error: ${err.message}`, 'error');
      },
      { enableHighAccuracy: true }
    );
  };

  // Clear Forge Flag
  const handleClearFlag = async (rollNumber) => {
    try {
      await api.clearForgeFlag(rollNumber);
      showFeedback(`Cleared strike count and alert for ${rollNumber}`, 'success');
      loadData();
    } catch (err) {
      showFeedback(err.message, 'error');
    }
  };

  // Export Attendance CSV
  const handleExportCsv = () => {
    if (!reports.records.length) {
      showFeedback('No attendance records to export for today.', 'error');
      return;
    }

    const headers = ['Roll Number', 'Full Name', 'Date', 'Time Marked', 'Status', 'Distance (m)', 'Match Similarity', 'Liveness Score'];
    const rows = reports.records.map((r) => [
      r.roll_number,
      `"${r.full_name}"`,
      r.date,
      r.time_marked,
      r.status,
      r.verified_distance || 0,
      r.similarity_score || 0,
      r.liveness_score || 0
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Hostel_Attendance_${reports.date || 'today'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 20px 40px' }}>
      {/* Feedback Banner */}
      {feedback.text && (
        <div style={{
          padding: '12px 18px',
          borderRadius: '10px',
          marginBottom: '20px',
          background: feedback.type === 'error' ? 'rgba(244, 63, 94, 0.2)' : 'rgba(16, 185, 129, 0.2)',
          border: feedback.type === 'error' ? '1px solid #f43f5e' : '1px solid #10b981',
          color: '#ffffff',
          fontWeight: '600',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          {feedback.type === 'error' ? <AlertTriangle size={18} color="#f43f5e" /> : <CheckCircle size={18} color="#10b981" />}
          {feedback.text}
        </div>
      )}

      {/* Stats Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>TOTAL ALLOTTED</span>
            <Users size={18} color="#6366f1" />
          </div>
          <div style={{ fontSize: '28px', fontWeight: '800', marginTop: '10px', color: '#ffffff' }}>
            {stats?.totalAllotted || allotments.length}
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>Officially pre-assigned list</span>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>ONBOARDED STUDENTS</span>
            <CheckCircle size={18} color="#10b981" />
          </div>
          <div style={{ fontSize: '28px', fontWeight: '800', marginTop: '10px', color: '#34d399' }}>
            {stats?.totalRegistered || 0}
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>Face vectors generated</span>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>PRESENT TODAY</span>
            <MapPin size={18} color="#38bdf8" />
          </div>
          <div style={{ fontSize: '28px', fontWeight: '800', marginTop: '10px', color: '#38bdf8' }}>
            {stats?.presentToday || reports.records.length}
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>Verified in 10-20m geofence</span>
        </div>

        <div className="glass-panel" style={{ padding: '20px', borderColor: alerts.flaggedCount > 0 ? 'rgba(244, 63, 94, 0.4)' : 'var(--border-card)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>FORGE LOCATION ALERTS</span>
            <ShieldAlert size={18} color="#f43f5e" />
          </div>
          <div style={{ fontSize: '28px', fontWeight: '800', marginTop: '10px', color: alerts.flaggedCount > 0 ? '#fb7185' : '#ffffff' }}>
            {alerts.flaggedCount}
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>Hit 3 consecutive failed strikes</span>
        </div>
      </div>

      {/* Admin Subtabs */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '1px solid var(--border-card)', paddingBottom: '12px' }}>
        <button
          onClick={() => setActiveSubTab('allotments')}
          className={activeSubTab === 'allotments' ? 'btn-primary' : 'btn-secondary'}
          style={{ fontSize: '13px', padding: '8px 16px' }}
        >
          <FileSpreadsheet size={16} /> Hostel Allotment List
        </button>
        <button
          onClick={() => setActiveSubTab('geofence')}
          className={activeSubTab === 'geofence' ? 'btn-primary' : 'btn-secondary'}
          style={{ fontSize: '13px', padding: '8px 16px' }}
        >
          <MapPin size={16} /> Geofence Configuration
        </button>
        <button
          onClick={() => setActiveSubTab('alerts')}
          className={activeSubTab === 'alerts' ? 'btn-primary' : 'btn-secondary'}
          style={{ fontSize: '13px', padding: '8px 16px', position: 'relative' }}
        >
          <AlertTriangle size={16} /> Security Alerts
          {alerts.flaggedCount > 0 && (
            <span style={{
              background: '#f43f5e',
              color: '#fff',
              fontSize: '10px',
              padding: '2px 6px',
              borderRadius: '999px',
              marginLeft: '4px'
            }}>
              {alerts.flaggedCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveSubTab('reports')}
          className={activeSubTab === 'reports' ? 'btn-primary' : 'btn-secondary'}
          style={{ fontSize: '13px', padding: '8px 16px' }}
        >
          <CheckCircle size={16} /> Attendance Reports
        </button>
      </div>

      {/* SUBTAB 1: Allotments */}
      {activeSubTab === 'allotments' && (
        <div className="glass-panel" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#ffffff' }}>Hostel Allotment Pre-Registration</h2>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                Upload official allotment CSV/JSON. Students choose from this list and cannot manually type their name.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <label className="btn-primary" style={{ cursor: 'pointer', margin: 0 }}>
                <Upload size={16} /> Upload CSV
                <input type="file" accept=".csv" onChange={handleFileUpload} style={{ display: 'none' }} />
              </label>
              <button onClick={handleSeedSamples} className="btn-secondary">
                + Add 4 Demo Students
              </button>
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: 'rgba(255, 255, 255, 0.03)', borderBottom: '1px solid var(--border-card)', color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '12px 16px' }}>ROLL NUMBER</th>
                  <th style={{ padding: '12px 16px' }}>STUDENT NAME</th>
                  <th style={{ padding: '12px 16px' }}>ROOM NO</th>
                  <th style={{ padding: '12px 16px' }}>BLOCK</th>
                  <th style={{ padding: '12px 16px' }}>ONBOARDING STATUS</th>
                </tr>
              </thead>
              <tbody>
                {allotments.map((a) => (
                  <tr key={a.id || a.roll_number} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                    <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontWeight: '600', color: '#818cf8' }}>
                      {a.roll_number}
                    </td>
                    <td style={{ padding: '12px 16px', fontWeight: '600', color: '#ffffff' }}>
                      {a.full_name}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>
                      {a.room_number}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>
                      {a.hostel_block}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {a.is_registered ? (
                        <span className="badge badge-emerald">Onboarded</span>
                      ) : (
                        <span className="badge badge-amber">Pending Registration</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUBTAB 2: Geofence Config */}
      {activeSubTab === 'geofence' && (
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#ffffff', marginBottom: '6px' }}>
            Hostel Geofence Configuration
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '24px' }}>
            Sets the central coordinates of the hostel and permitted boundary (10-20 meters). Uses pure Haversine formula math (Zero API costs).
          </p>

          <form onSubmit={handleSaveGeofence} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
            <div>
              <label className="form-label">Hostel Facility Name</label>
              <input
                className="form-input"
                type="text"
                value={geofence.hostel_name || ''}
                onChange={(e) => setGeofence({ ...geofence, hostel_name: e.target.value })}
                required
              />
            </div>

            <div>
              <label className="form-label">Hostel Center Latitude</label>
              <input
                className="form-input"
                type="number"
                step="0.000001"
                value={geofence.latitude}
                onChange={(e) => setGeofence({ ...geofence, latitude: parseFloat(e.target.value) })}
                required
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>

            <div>
              <label className="form-label">Hostel Center Longitude</label>
              <input
                className="form-input"
                type="number"
                step="0.000001"
                value={geofence.longitude}
                onChange={(e) => setGeofence({ ...geofence, longitude: parseFloat(e.target.value) })}
                required
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>

            <div>
              <label className="form-label">
                Permitted Radius: <strong style={{ color: '#10b981' }}>{geofence.radius_meters} meters</strong> (Spec: 10 - 20m)
              </label>
              <input
                type="range"
                min="10"
                max="50"
                step="1"
                value={geofence.radius_meters}
                onChange={(e) => setGeofence({ ...geofence, radius_meters: parseFloat(e.target.value) })}
                style={{ width: '100%', accentColor: '#10b981', marginTop: '10px' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' }}>
                <span>10m (Ultra-strict)</span>
                <span>20m (Recommended)</span>
                <span>50m (Extended)</span>
              </div>
            </div>

            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '12px', marginTop: '10px' }}>
              <button type="submit" className="btn-emerald" disabled={loading}>
                <CheckCircle size={18} /> Save Geofence Settings
              </button>
              <button type="button" onClick={handleUseCurrentLocation} className="btn-secondary">
                <Crosshair size={18} /> Use My Current GPS Coordinates
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SUBTAB 3: Security & Forge Alerts */}
      {activeSubTab === 'alerts' && (
        <div className="glass-panel" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#ffffff' }}>
                Forge Location & Anti-Spoofing Alerts
              </h2>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                Students who hit 3 consecutive failed location checks or attempt GPS spoofing are automatically flagged.
              </p>
            </div>
            <button onClick={loadData} className="btn-secondary" style={{ padding: '8px 14px' }}>
              <RotateCcw size={16} /> Refresh
            </button>
          </div>

          {/* Flagged Students Box */}
          {alerts.flaggedStudents.length > 0 ? (
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#fb7185', marginBottom: '12px' }}>
                🚨 Flagged Students (Action Required)
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px' }}>
                {alerts.flaggedStudents.map((s) => (
                  <div key={s.id} style={{
                    padding: '16px',
                    borderRadius: '12px',
                    background: 'rgba(244, 63, 94, 0.1)',
                    border: '1px solid rgba(244, 63, 94, 0.3)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <div>
                      <div style={{ fontWeight: '700', color: '#ffffff' }}>{s.full_name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        Roll No: {s.roll_number} | {s.course} (Sem {s.semester})
                      </div>
                      <div style={{ fontSize: '12px', color: '#fb7185', fontWeight: '600', marginTop: '4px' }}>
                        Failed Strikes: {s.failed_attempts} / 3 (Forge Location Flagged)
                      </div>
                    </div>
                    <button
                      onClick={() => handleClearFlag(s.roll_number)}
                      className="btn-rose"
                      style={{ fontSize: '12px', padding: '6px 12px' }}
                    >
                      Clear Flag
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{
              padding: '16px',
              borderRadius: '12px',
              background: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.2)',
              color: '#34d399',
              fontSize: '13px',
              marginBottom: '20px'
            }}>
              ✅ All clear! No students currently flagged for location forgery or mock GPS.
            </div>
          )}

          {/* Audit Logs Table */}
          <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#ffffff', marginBottom: '12px' }}>
            Recent Security Incidents
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: 'rgba(255, 255, 255, 0.03)', borderBottom: '1px solid var(--border-card)', color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '10px 14px' }}>TIMESTAMP</th>
                  <th style={{ padding: '10px 14px' }}>ROLL NUMBER</th>
                  <th style={{ padding: '10px 14px' }}>STUDENT NAME</th>
                  <th style={{ padding: '10px 14px' }}>INCIDENT TYPE</th>
                  <th style={{ padding: '10px 14px' }}>RECORDED DISTANCE</th>
                  <th style={{ padding: '10px 14px' }}>DETAILS</th>
                </tr>
              </thead>
              <tbody>
                {alerts.recentAuditLogs.map((log) => (
                  <tr key={log.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                    <td style={{ padding: '10px 14px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                      {log.created_at}
                    </td>
                    <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontWeight: '600', color: '#818cf8' }}>
                      {log.roll_number || 'N/A'}
                    </td>
                    <td style={{ padding: '10px 14px', color: '#ffffff' }}>
                      {log.full_name || 'Unregistered'}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span className={log.incident_type.includes('FORGE') ? 'badge badge-rose' : 'badge badge-amber'}>
                        {log.incident_type}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)' }}>
                      {log.calculated_distance ? `${log.calculated_distance}m` : 'N/A'}
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--text-muted)' }}>
                      {log.details}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUBTAB 4: Reports */}
      {activeSubTab === 'reports' && (
        <div className="glass-panel" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#ffffff' }}>Daily Attendance Logs</h2>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                Date: <strong style={{ color: '#10b981' }}>{reports.date || 'Today'}</strong> | Present: {reports.summary.present || 0} | Absent: {reports.summary.absent || 0}
              </p>
            </div>
            <button onClick={handleExportCsv} className="btn-emerald" style={{ fontSize: '13px', padding: '8px 16px' }}>
              <Download size={16} /> Export to CSV
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: 'rgba(255, 255, 255, 0.03)', borderBottom: '1px solid var(--border-card)', color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '12px 16px' }}>ROLL NO</th>
                  <th style={{ padding: '12px 16px' }}>FULL NAME</th>
                  <th style={{ padding: '12px 16px' }}>TIME MARKED</th>
                  <th style={{ padding: '12px 16px' }}>STATUS</th>
                  <th style={{ padding: '12px 16px' }}>DISTANCE</th>
                  <th style={{ padding: '12px 16px' }}>FACE SIMILARITY</th>
                  <th style={{ padding: '12px 16px' }}>LIVENESS</th>
                </tr>
              </thead>
              <tbody>
                {reports.records.length > 0 ? (
                  reports.records.map((r) => (
                    <tr key={r.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                      <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontWeight: '600', color: '#818cf8' }}>
                        {r.roll_number}
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: '600', color: '#ffffff' }}>
                        {r.full_name}
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {r.time_marked}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span className="badge badge-emerald">PRESENT</span>
                      </td>
                      <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', color: '#34d399' }}>
                        {r.verified_distance}m
                      </td>
                      <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)' }}>
                        {Math.round((r.similarity_score || 0) * 100)}%
                      </td>
                      <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)' }}>
                        {Math.round((r.liveness_score || 1) * 100)}%
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-dim)' }}>
                      No attendance marked yet for today. Use the "Phase 3: Daily Attendance" tab to test marking attendance.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
