import React, { useState, useEffect } from 'react';
import { api } from '../../utils/api';
import {
  History,
  Search,
  Filter,
  RefreshCw,
  ShieldCheck,
  User,
  Clock,
  Code,
  Trash2,
  CheckCircle2
} from 'lucide-react';

export default function AuditLogViewer() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);

  useEffect(() => {
    fetchLogs();
  }, [actionFilter]);

  const fetchLogs = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const params = {};
      if (actionFilter) params.action = actionFilter;
      if (search) params.search = search;
      const data = await api.admin.getAuditLogs(params);
      setLogs(data.logs || []);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to retrieve administrative audit trail');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    fetchLogs();
  };

  const handleDeleteSingleLog = async (id) => {
    if (!window.confirm('Delete this audit trail entry? This cannot be undone.')) {
      return;
    }
    setDeletingId(id);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.admin.deleteAuditLog(id);
      setStatusMsg(res.message || 'Audit log entry deleted.');
      setLogs((prev) => prev.filter((l) => l.id !== id));
    } catch (err) {
      setErrorMsg(err.message || 'Failed to delete audit log entry');
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAllLogs = async () => {
    setClearingAll(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.admin.clearAllAuditLogs();
      setStatusMsg(res.message || 'All historical audit logs cleared.');
      setShowClearModal(false);
      fetchLogs();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to clear audit logs');
    } finally {
      setClearingAll(false);
    }
  };

  const getActionBadge = (action) => {
    if (action.includes('OVERRIDE')) {
      return <span className="badge bg-warning-subtle text-warning border border-warning-subtle">{action}</span>;
    }
    if (action.includes('RESET') || action.includes('DELETE')) {
      return <span className="badge bg-danger-subtle text-danger border border-danger-subtle">{action}</span>;
    }
    if (action.includes('COMMIT') || action.includes('CREATE') || action.includes('APPROVED')) {
      return <span className="badge bg-success-subtle text-success border border-success-subtle">{action}</span>;
    }
    return <span className="badge bg-primary-subtle text-primary border border-primary-subtle">{action}</span>;
  };

  return (
    <div className="container-fluid px-0">
      {/* Page Title */}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-2">
        <div>
          <h4 className="fw-bold mb-1 d-flex align-items-center gap-2">
            <History className="text-primary" size={24} />
            Immutable Administrative Audit Trail
          </h4>
          <p className="text-muted small mb-0">
            Cryptographically tracked audit logs for administrative interventions, roster commits, policy changes, and overrides.
          </p>
        </div>
        <div className="d-flex gap-2">
          <button
            className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
            onClick={fetchLogs}
            disabled={loading}
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            className="btn btn-outline-danger btn-sm d-flex align-items-center gap-1"
            onClick={() => setShowClearModal(true)}
            disabled={loading || logs.length === 0}
          >
            <Trash2 size={14} /> Clear All Logs
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="alert alert-success d-flex align-items-center justify-content-between py-2 px-3 mb-3">
          <div className="d-flex align-items-center gap-2">
            <CheckCircle2 size={16} />
            <span className="small fw-semibold">{statusMsg}</span>
          </div>
          <button type="button" className="btn-close btn-close-sm" onClick={() => setStatusMsg(null)} />
        </div>
      )}

      {errorMsg && (
        <div className="alert alert-danger alert-dismissible fade show mb-4" role="alert">
          <div>{errorMsg}</div>
          <button type="button" className="btn-close" onClick={() => setErrorMsg(null)}></button>
        </div>
      )}

      {/* Filter Card */}
      <div className="card shadow-sm border-0 rounded-3 mb-4">
        <div className="card-body p-3">
          <form onSubmit={handleSearch} className="row g-2 align-items-center">
            <div className="col-md-4">
              <label className="form-label small text-muted mb-1">Filter by Action</label>
              <select
                className="form-select form-select-sm"
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
              >
                <option value="">All Administrative Actions</option>
                <option value="ATTENDANCE_OVERRIDE">Attendance Overrides</option>
                <option value="STRIKE_COUNTER_RESET">Strike Resets</option>
                <option value="ROSTER_CSV_COMMIT">Roster Commits</option>
                <option value="GEOFENCE_CONFIG_UPDATE">Geofence Policy Updates</option>
                <option value="CORRECTION_REVIEWED">Correction Decisions</option>
                <option value="FEEDBACK_RESOLVED">Feedback Resolutions</option>
                <option value="STUDENT_UPDATED">Student Profile Edits</option>
              </select>
            </div>

            <div className="col-md-6">
              <label className="form-label small text-muted mb-1">Search Keywords</label>
              <div className="input-group input-group-sm">
                <input
                  type="text"
                  className="form-control"
                  placeholder="Admin username, roll number, or reason notes..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button type="submit" className="btn btn-outline-primary">
                  <Search size={14} />
                </button>
              </div>
            </div>

            <div className="col-md-2 d-flex align-items-end">
              <button
                type="button"
                className="btn btn-sm btn-light w-100 mt-md-4"
                onClick={() => {
                  setActionFilter('');
                  setSearch('');
                }}
              >
                Clear
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Logs Table */}
      <div className="card shadow-sm border-0 rounded-3">
        <div className="card-header bg-white border-bottom py-3">
          <h6 className="card-title mb-0 fw-semibold">Audit Events Log ({logs.length})</h6>
        </div>
        <div className="card-body p-0">
          {loading ? (
            <div className="text-center p-5">
              <div className="spinner-border text-primary mb-2" role="status"></div>
              <p className="text-muted small mb-0">Querying database audit logs...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center p-5 text-muted">
              <History size={40} className="mb-2 text-muted opacity-50" />
              <p className="mb-0">No audit records found matching the filter criteria.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead className="table-light">
                  <tr className="small text-muted">
                    <th className="ps-3">Timestamp</th>
                    <th>Administrator</th>
                    <th>Action</th>
                    <th>Target / Roll No</th>
                    <th>Details / Justification</th>
                    <th className="pe-3">IP Address</th>
                    <th className="text-end pe-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td className="ps-3 small text-muted" style={{ whiteSpace: 'nowrap' }}>
                        <Clock size={12} className="me-1 inline" />
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td>
                        <span className="fw-semibold text-dark small d-flex align-items-center gap-1">
                          <User size={13} className="text-primary" />
                          {log.username || 'System Admin'}
                        </span>
                      </td>
                      <td>{getActionBadge(log.action)}</td>
                      <td>
                        {log.target_student ? (
                          <code>{log.target_student}</code>
                        ) : (
                          <span className="small text-muted">&mdash;</span>
                        )}
                      </td>
                      <td style={{ maxWidth: '350px' }}>
                        <div className="small text-dark text-truncate" title={log.details}>
                          {log.details || 'System operation executed.'}
                        </div>
                      </td>
                      <td className="pe-3 small text-muted">
                        <code>{log.ip_address || '127.0.0.1'}</code>
                      </td>
                      <td className="text-end pe-3">
                        <button
                          className="btn btn-outline-danger btn-sm p-1"
                          title="Delete this audit record"
                          disabled={deletingId === log.id}
                          onClick={() => handleDeleteSingleLog(log.id)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Clear All Audit Logs Confirmation Modal */}
      {showClearModal && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content rounded-3 border-0 shadow">
              <div className="modal-header border-bottom bg-danger-subtle text-danger">
                <h6 className="modal-title fw-bold d-flex align-items-center gap-2">
                  <Trash2 size={18} />
                  Purge Historical Audit Trail
                </h6>
                <button type="button" className="btn-close" onClick={() => setShowClearModal(false)}></button>
              </div>
              <div className="modal-body p-4">
                <p className="mb-2">
                  Are you sure you want to delete all historical administrative audit logs?
                </p>
                <div className="text-muted small">
                  This will purge {logs.length} logged administrative events from the database. A single fresh marker log will be written recording this purge operation.
                </div>
              </div>
              <div className="modal-footer border-top bg-light py-2">
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => setShowClearModal(false)}
                  disabled={clearingAll}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger d-flex align-items-center gap-1"
                  onClick={handleClearAllLogs}
                  disabled={clearingAll}
                >
                  <Trash2 size={14} />
                  {clearingAll ? 'Clearing Logs...' : 'Yes, Delete All Logs'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
