import React, { useState, useEffect } from 'react';
import { api } from '../../utils/api';
import {
  ShieldAlert,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  RefreshCw,
  Search,
  UserX,
  Compass,
  Clock,
  Unlock,
  Trash2
} from 'lucide-react';

export default function SecurityIncidentDesk() {
  const [alerts, setAlerts] = useState({ flagged_students: [], recent_logs: [] });
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);
  const [deletingLogId, setDeletingLogId] = useState(null);
  const [showClearLogsModal, setShowClearLogsModal] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);

  // Reset Strike Modal state
  const [showResetModal, setShowResetModal] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [resetReason, setResetReason] = useState('');
  const [submittingReset, setSubmittingReset] = useState(false);
  const [submittingResetAll, setSubmittingResetAll] = useState(false);

  useEffect(() => {
    fetchAlerts();
  }, []);

  const fetchAlerts = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.admin.getSecurityAlerts();
      const rawStudents = data?.flagged_students || data?.flaggedStudents || [];
      const rawLogs = data?.recent_logs || data?.recentAuditLogs || [];

      // Normalize fields so the component works universally
      const normalizedStudents = rawStudents.map(s => ({
        id: s.id || s.student_id,
        student_id: s.student_id || s.id,
        roll_no: s.roll_no || s.roll_number,
        roll_number: s.roll_number || s.roll_no,
        full_name: s.full_name || 'Student',
        block_name: s.block_name || s.hostel_block || 'Hostel Block',
        course: s.course || '',
        strike_count: typeof s.strike_count === 'number' ? s.strike_count : (s.failed_attempts || 0),
        failed_attempts: typeof s.failed_attempts === 'number' ? s.failed_attempts : (s.strike_count || 0),
        is_flagged: Boolean(s.is_flagged || s.is_flagged_forge === 1 || (s.failed_attempts || 0) >= 3),
        is_flagged_forge: s.is_flagged_forge || (s.is_flagged ? 1 : 0)
      }));

      const normalizedLogs = rawLogs.map(l => ({
        id: l.id,
        event_type: l.event_type || l.incident_type || 'SECURITY_EVENT',
        incident_type: l.incident_type || l.event_type || 'SECURITY_EVENT',
        timestamp: l.timestamp || l.created_at || new Date().toISOString(),
        created_at: l.created_at || l.timestamp,
        student_name: l.student_name || l.full_name || (l.roll_number ? `Student ${l.roll_number}` : `Student ID: ${l.student_id}`),
        roll_number: l.roll_number,
        details: l.details || (l.distance_meters ? `Recorded distance: ${Math.round(l.distance_meters)}m` : 'Location check failed'),
        distance_meters: l.distance_meters || l.calculated_distance || 0
      }));

      setAlerts({
        flagged_students: normalizedStudents,
        flaggedStudents: normalizedStudents,
        recent_logs: normalizedLogs,
        recentAuditLogs: normalizedLogs
      });
    } catch (err) {
      setErrorMsg(err.message || 'Failed to fetch security alerts and strike logs');
    } finally {
      setLoading(false);
    }
  };

  const openResetModal = (student) => {
    setSelectedStudent(student);
    setResetReason('Verified legitimate attendance attempt / GPS signal variance cleared.');
    setShowResetModal(true);
  };

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    if (!resetReason.trim()) {
      setErrorMsg('A detailed reason is mandatory for resetting student security strikes.');
      return;
    }

    setSubmittingReset(true);
    setErrorMsg(null);
    setStatusMsg(null);

    try {
      const res = await api.admin.resetStrike({
        student_id: selectedStudent.student_id || selectedStudent.id,
        rollNumber: selectedStudent.roll_number || selectedStudent.roll_no,
        reason: resetReason
      });
      setStatusMsg(res.message || `Strike counter reset successfully for ${selectedStudent.full_name}. Account unlocked!`);
      setShowResetModal(false);
      fetchAlerts();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to reset strike counter');
    } finally {
      setSubmittingReset(false);
    }
  };

  const handleResetAllStrikes = async () => {
    if (!window.confirm('Are you sure you want to reset all strikes and unlock all flagged student accounts?')) {
      return;
    }

    setSubmittingResetAll(true);
    setErrorMsg(null);
    setStatusMsg(null);

    try {
      const res = await api.admin.resetAllStrikes({
        reason: 'Administrative mass clearance of GPS/forge strikes'
      });
      setStatusMsg(res.message || 'All student strikes have been cleared successfully!');
      fetchAlerts();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to clear all strikes');
    } finally {
      setSubmittingResetAll(false);
    }
  };

  const handleDeleteSingleLog = async (id) => {
    if (!window.confirm('Delete this security incident alert log? This cannot be undone.')) {
      return;
    }
    setDeletingLogId(id);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.admin.deleteSecurityAlert(id);
      setStatusMsg(res.message || 'Security alert deleted.');
      setAlerts((prev) => ({
        ...prev,
        recent_logs: (prev.recent_logs || []).filter((l) => l.id !== id),
        recentAuditLogs: (prev.recentAuditLogs || []).filter((l) => l.id !== id)
      }));
    } catch (err) {
      setErrorMsg(err.message || 'Failed to delete security alert');
    } finally {
      setDeletingLogId(null);
    }
  };

  const handleClearAllLogs = async () => {
    setClearingLogs(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.admin.clearAllSecurityAlerts();
      setStatusMsg(res.message || 'All security incident alerts cleared.');
      setShowClearLogsModal(false);
      fetchAlerts();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to clear security alerts');
    } finally {
      setClearingLogs(false);
    }
  };

  const flaggedStudents = alerts.flagged_students || alerts.flaggedStudents || [];
  const recentLogs = alerts.recent_logs || alerts.recentAuditLogs || [];

  return (
    <div className="container-fluid px-0">
      {/* Page Title */}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-2">
        <div>
          <h4 className="fw-bold mb-1 d-flex align-items-center gap-2">
            <ShieldAlert className="text-danger" size={24} />
            Security & Forge Location Incident Desk
          </h4>
          <p className="text-muted small mb-0">
            Monitoring the 3-strike Forge Location rule, out-of-boundary check-in attempts, and suspicious device signatures.
          </p>
        </div>
        <div className="d-flex gap-2">
          {flaggedStudents.length > 0 && (
            <button
              className="btn btn-danger btn-sm d-flex align-items-center gap-1 fw-semibold shadow-sm"
              onClick={handleResetAllStrikes}
              disabled={submittingResetAll}
            >
              {submittingResetAll ? (
                <span className="spinner-border spinner-border-sm" role="status" />
              ) : (
                <Unlock size={14} />
              )}
              Unlock All Flagged Students
            </button>
          )}
          <button
            className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
            onClick={fetchAlerts}
            disabled={loading}
          >
            <RefreshCw size={14} /> Refresh Alerts
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="alert alert-success d-flex align-items-center gap-2 alert-dismissible fade show mb-4" role="alert">
          <CheckCircle2 size={18} />
          <div>{statusMsg}</div>
          <button type="button" className="btn-close" onClick={() => setStatusMsg(null)}></button>
        </div>
      )}

      {errorMsg && (
        <div className="alert alert-danger d-flex align-items-center gap-2 alert-dismissible fade show mb-4" role="alert">
          <AlertTriangle size={18} />
          <div>{errorMsg}</div>
          <button type="button" className="btn-close" onClick={() => setErrorMsg(null)}></button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="row g-3 mb-4">
        <div className="col-md-4">
          <div className="card shadow-sm border-0 border-start border-danger border-4 rounded-3 p-3 bg-white">
            <div className="d-flex justify-content-between align-items-center">
              <div>
                <div className="text-muted small fw-medium">Flagged Student Accounts</div>
                <h3 className="fw-bold text-danger mb-0 mt-1">
                  {flaggedStudents.filter(s => (s.strike_count || s.failed_attempts || 0) >= 3 || s.is_flagged).length}
                </h3>
              </div>
              <div className="p-2 bg-danger-subtle rounded-3 text-danger">
                <UserX size={24} />
              </div>
            </div>
            <div className="small text-muted mt-2">Locked out by 3-strike rule</div>
          </div>
        </div>

        <div className="col-md-4">
          <div className="card shadow-sm border-0 border-start border-warning border-4 rounded-3 p-3 bg-white">
            <div className="d-flex justify-content-between align-items-center">
              <div>
                <div className="text-muted small fw-medium">At-Risk Students (1-2 Strikes)</div>
                <h3 className="fw-bold text-warning mb-0 mt-1">
                  {flaggedStudents.filter(s => {
                    const c = s.strike_count || s.failed_attempts || 0;
                    return c > 0 && c < 3;
                  }).length}
                </h3>
              </div>
              <div className="p-2 bg-warning-subtle rounded-3 text-warning">
                <AlertTriangle size={24} />
              </div>
            </div>
            <div className="small text-muted mt-2">Nearing threshold penalty</div>
          </div>
        </div>

        <div className="col-md-4">
          <div className="card shadow-sm border-0 border-start border-primary border-4 rounded-3 p-3 bg-white">
            <div className="d-flex justify-content-between align-items-center">
              <div>
                <div className="text-muted small fw-medium">Security Incident Logs Recorded</div>
                <h3 className="fw-bold text-primary mb-0 mt-1">{recentLogs.length}</h3>
              </div>
              <div className="p-2 bg-primary-subtle rounded-3 text-primary">
                <Compass size={24} />
              </div>
            </div>
            <div className="small text-muted mt-2">Audited out-of-boundary events</div>
          </div>
        </div>
      </div>

      <div className="row g-4">
        {/* Flagged Students Table */}
        <div className="col-lg-7">
          <div className="card shadow-sm border-0 rounded-3 h-100">
            <div className="card-header bg-white border-bottom py-3 d-flex justify-content-between align-items-center">
              <h6 className="card-title mb-0 fw-semibold">
                Students with Active Strikes / Flags ({flaggedStudents.length})
              </h6>
            </div>
            <div className="card-body p-0">
              {loading ? (
                <div className="text-center p-5">
                  <div className="spinner-border text-danger mb-2" role="status"></div>
                  <p className="text-muted small mb-0">Inspecting security strike registers...</p>
                </div>
              ) : flaggedStudents.length === 0 ? (
                <div className="text-center p-5 text-muted">
                  <CheckCircle2 size={40} className="mb-2 text-success opacity-50" />
                  <p className="mb-0">Zero students currently flagged. All attendance submissions within perimeter.</p>
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead className="table-light">
                      <tr className="small text-muted">
                        <th className="ps-3">Student</th>
                        <th>Roll No</th>
                        <th>Block</th>
                        <th>Strikes</th>
                        <th>Account Status</th>
                        <th className="text-end pe-3">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flaggedStudents.map((s, idx) => {
                        const strikes = s.strike_count || s.failed_attempts || 0;
                        const isLocked = strikes >= 3 || s.is_flagged;
                        return (
                          <tr key={s.student_id || s.id || idx}>
                            <td className="ps-3 fw-medium text-dark">{s.full_name}</td>
                            <td><code>{s.roll_no || s.roll_number}</code></td>
                            <td><span className="badge bg-light text-dark">{s.block_name || 'Block A'}</span></td>
                            <td>
                              <span className={`badge ${strikes >= 3 ? 'bg-danger' : strikes > 0 ? 'bg-warning text-dark' : 'bg-success'}`}>
                                {strikes} / 3 Strikes
                              </span>
                            </td>
                            <td>
                              {isLocked ? (
                                <span className="badge bg-danger-subtle text-danger border border-danger-subtle">
                                  LOCKED / FLAGGED
                                </span>
                              ) : (
                                <span className="badge bg-success-subtle text-success border border-success-subtle">
                                  ACTIVE
                                </span>
                              )}
                            </td>
                            <td className="text-end pe-3">
                              <button
                                className="btn btn-sm btn-outline-danger py-1 px-2 fw-semibold d-inline-flex align-items-center gap-1"
                                style={{ fontSize: '12px' }}
                                onClick={() => openResetModal(s)}
                                title="Reset Strike Counter & Unlock"
                              >
                                <RotateCcw size={12} /> Reset & Unlock
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Security Audit Log Stream */}
        <div className="col-lg-5">
          <div className="card shadow-sm border-0 rounded-3 h-100">
            <div className="card-header bg-white border-bottom py-3 d-flex justify-content-between align-items-center">
              <h6 className="card-title mb-0 fw-semibold d-flex align-items-center gap-2">
                <Clock size={16} className="text-muted" />
                Recent Forge / Out-of-Range Incidents
              </h6>
              {recentLogs.length > 0 && (
                <button
                  className="btn btn-outline-danger btn-sm py-0 px-2 d-flex align-items-center gap-1"
                  style={{ fontSize: '11px' }}
                  onClick={() => setShowClearLogsModal(true)}
                >
                  <Trash2 size={12} /> Clear All
                </button>
              )}
            </div>
            <div className="card-body p-0">
              {recentLogs.length === 0 ? (
                <div className="text-center p-4 text-muted small">
                  No recent security incident logs found.
                </div>
              ) : (
                <div className="list-group list-group-flush small" style={{ maxHeight: '420px', overflowY: 'auto' }}>
                  {recentLogs.slice(0, 30).map((log, idx) => (
                    <div key={log.id || idx} className="list-group-item p-3">
                      <div className="d-flex justify-content-between align-items-center mb-1">
                        <span className="badge bg-danger-subtle text-danger">
                          {log.event_type || log.incident_type || 'FORGE_LOCATION_DETECTED'}
                        </span>
                        <div className="d-flex align-items-center gap-2">
                          <span className="text-muted" style={{ fontSize: '11px' }}>
                            {log.timestamp ? new Date(log.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }) : 'Recent'}
                          </span>
                          {log.id && (
                            <button
                              className="btn btn-sm btn-outline-danger p-0 px-1 border-0"
                              title="Delete this incident log"
                              disabled={deletingLogId === log.id}
                              onClick={() => handleDeleteSingleLog(log.id)}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="fw-medium text-dark">{log.student_name || `Student ID: ${log.student_id}`}</div>
                      <div className="text-muted mt-1" style={{ fontSize: '12px' }}>
                        {log.details || `Distance detected: ${log.distance_meters ? log.distance_meters.toFixed(1) + 'm' : 'Out of range'}`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Reset Strike Modal */}
      {showResetModal && selectedStudent && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1055 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content rounded-3 border-0 shadow">
              <div className="modal-header border-bottom">
                <h6 className="modal-title fw-bold d-flex align-items-center gap-2">
                  <RotateCcw size={18} className="text-danger" />
                  Reset Security Strike Counter
                </h6>
                <button type="button" className="btn-close" onClick={() => setShowResetModal(false)}></button>
              </div>
              <form onSubmit={handleResetSubmit}>
                <div className="modal-body p-4">
                  <div className="alert alert-info small mb-3">
                    <strong>Administrative Action:</strong> Resetting strikes will clear the student's strike count back to 0, unlock their account, and record an audit log entry with your mandatory justification.
                  </div>

                  <div className="mb-3">
                    <label className="form-label small text-muted mb-0">Target Student</label>
                    <div className="fw-semibold text-dark">{selectedStudent.full_name} ({selectedStudent.roll_no || selectedStudent.roll_number})</div>
                    <div className="small text-danger fw-medium">
                      Current Strikes: {selectedStudent.strike_count || selectedStudent.failed_attempts || 0} / 3 Strikes (LOCKED)
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small fw-medium">
                      Mandatory Justification Reason <span className="text-danger">*</span>
                    </label>
                    <textarea
                      className="form-control"
                      rows="3"
                      placeholder="e.g., Student demonstrated valid GPS sensor hardware variance; verified legitimate hostel presence."
                      value={resetReason}
                      onChange={(e) => setResetReason(e.target.value)}
                      required
                    />
                    <div className="form-text small">This entry is immutable and permanently logged.</div>
                  </div>
                </div>
                <div className="modal-footer border-top">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => setShowResetModal(false)}
                    disabled={submittingReset}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-sm btn-danger fw-semibold px-3"
                    disabled={submittingReset}
                  >
                    {submittingReset ? 'Resetting Strikes...' : 'Confirm Reset & Unlock Account'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Clear Incident Logs Confirmation Modal */}
      {showClearLogsModal && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content rounded-3 border-0 shadow">
              <div className="modal-header border-bottom bg-danger-subtle text-danger">
                <h6 className="modal-title fw-bold d-flex align-items-center gap-2">
                  <Trash2 size={18} />
                  Clear All Security & Forge Incident Logs
                </h6>
                <button type="button" className="btn-close" onClick={() => setShowClearLogsModal(false)}></button>
              </div>
              <div className="modal-body p-4">
                <p className="mb-2">
                  Are you sure you want to delete all historical security incident and forge alert logs?
                </p>
                <div className="text-muted small">
                  This will purge {recentLogs.length} logged incidents from the security database. Student account strike counts will remain unaffected. This action cannot be undone.
                </div>
              </div>
              <div className="modal-footer border-top bg-light py-2">
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => setShowClearLogsModal(false)}
                  disabled={clearingLogs}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger d-flex align-items-center gap-1"
                  onClick={handleClearAllLogs}
                  disabled={clearingLogs}
                >
                  <Trash2 size={14} />
                  {clearingLogs ? 'Purging Logs...' : 'Yes, Delete All Alerts'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
