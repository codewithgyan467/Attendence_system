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
  Clock
} from 'lucide-react';

export default function SecurityIncidentDesk() {
  const [alerts, setAlerts] = useState({ flagged_students: [], recent_logs: [] });
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

  // Reset Strike Modal state
  const [showResetModal, setShowResetModal] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [resetReason, setResetReason] = useState('');
  const [submittingReset, setSubmittingReset] = useState(false);

  useEffect(() => {
    fetchAlerts();
  }, []);

  const fetchAlerts = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.admin.getSecurityAlerts();
      setAlerts(data || { flagged_students: [], recent_logs: [] });
    } catch (err) {
      setErrorMsg(err.message || 'Failed to fetch security alerts and strike logs');
    } finally {
      setLoading(false);
    }
  };

  const openResetModal = (student) => {
    setSelectedStudent(student);
    setResetReason('');
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
        reason: resetReason
      });
      setStatusMsg(res.message || `Strike counter reset successfully for ${selectedStudent.full_name}.`);
      setShowResetModal(false);
      fetchAlerts();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to reset strike counter');
    } finally {
      setSubmittingReset(false);
    }
  };

  const flaggedStudents = alerts.flagged_students || [];
  const recentLogs = alerts.recent_logs || [];

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
        <button
          className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
          onClick={fetchAlerts}
          disabled={loading}
        >
          <RefreshCw size={14} /> Refresh Alerts
        </button>
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
                  {flaggedStudents.filter(s => (s.strike_count || 0) >= 3 || s.is_flagged).length}
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
                  {flaggedStudents.filter(s => (s.strike_count || 0) > 0 && (s.strike_count || 0) < 3).length}
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
                        const strikes = s.strike_count || 0;
                        const isLocked = strikes >= 3 || s.is_flagged;
                        return (
                          <tr key={s.student_id || s.id || idx}>
                            <td className="ps-3 fw-medium text-dark">{s.full_name}</td>
                            <td><code>{s.roll_no}</code></td>
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
                                className="btn btn-sm btn-outline-danger py-0 px-2"
                                style={{ fontSize: '12px' }}
                                onClick={() => openResetModal(s)}
                                title="Reset Strike Counter"
                              >
                                <RotateCcw size={12} className="me-1 inline" /> Reset
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
            <div className="card-header bg-white border-bottom py-3">
              <h6 className="card-title mb-0 fw-semibold d-flex align-items-center gap-2">
                <Clock size={16} className="text-muted" />
                Recent Forge / Out-of-Range Incidents
              </h6>
            </div>
            <div className="card-body p-0">
              {recentLogs.length === 0 ? (
                <div className="text-center p-4 text-muted small">
                  No recent security incident logs found.
                </div>
              ) : (
                <div className="list-group list-group-flush small" style={{ maxHeight: '420px', overflowY: 'auto' }}>
                  {recentLogs.slice(0, 15).map((log, idx) => (
                    <div key={log.id || idx} className="list-group-item p-3">
                      <div className="d-flex justify-content-between align-items-center mb-1">
                        <span className="badge bg-danger-subtle text-danger">
                          {log.event_type || 'FORGE_LOCATION_DETECTED'}
                        </span>
                        <span className="text-muted" style={{ fontSize: '11px' }}>
                          {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : 'Recent'}
                        </span>
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
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
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
                    <div className="fw-semibold text-dark">{selectedStudent.full_name} ({selectedStudent.roll_no})</div>
                    <div className="small text-danger">Current Strike Count: {selectedStudent.strike_count || 0} / 3</div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small fw-medium">
                      Mandatory Justification Reason <span className="text-danger">*</span>
                    </label>
                    <textarea
                      className="form-control"
                      rows="3"
                      placeholder="e.g., Student demonstrated valid GPS sensor hardware failure; verified with campus network router logs."
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
                    className="btn btn-sm btn-danger"
                    disabled={submittingReset}
                  >
                    {submittingReset ? 'Resetting Strikes...' : 'Confirm Reset & Unlock'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
