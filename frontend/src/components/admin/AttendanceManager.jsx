import React, { useState, useEffect } from 'react';
import { api } from '../../utils/api';
import {
  CalendarCheck,
  Search,
  Filter,
  Download,
  Edit3,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Clock,
  UserCheck,
  Trash2
} from 'lucide-react';

// Format time to 12-hour format with AM/PM
const formatDisplayTime12h = (timeVal) => {
  if (!timeVal) return '—';
  if (typeof timeVal === 'string' && timeVal.includes('T')) {
    const d = new Date(timeVal);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    }
  }
  const parts = String(timeVal).split(':');
  if (parts.length >= 2) {
    let h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (!isNaN(h) && !isNaN(m)) {
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      const mm = m < 10 ? `0${m}` : `${m}`;
      return `${h}:${mm} ${ampm}`;
    }
  }
  return timeVal;
};

export default function AttendanceManager() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearScope, setClearScope] = useState('date'); // 'date' | 'all'
  const [clearingRecords, setClearingRecords] = useState(false);

  // Filters
  const todayStr = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [selectedStatus, setSelectedStatus] = useState('');
  const [selectedBlock, setSelectedBlock] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [blocks, setBlocks] = useState([]);

  // Override Modal state
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [overrideStatus, setOverrideStatus] = useState('PRESENT');
  const [overrideReason, setOverrideReason] = useState('');
  const [submittingOverride, setSubmittingOverride] = useState(false);

  useEffect(() => {
    fetchBlocks();
  }, []);

  useEffect(() => {
    fetchAttendance();
  }, [selectedDate, selectedStatus, selectedBlock]);

  const fetchBlocks = async () => {
    try {
      const res = await api.admin.getBlocks();
      if (res && res.blocks) {
        setBlocks(res.blocks);
      }
    } catch (_) {}
  };

  const fetchAttendance = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const params = {};
      if (selectedDate) params.date = selectedDate;
      if (selectedStatus) params.status = selectedStatus;
      if (selectedBlock) params.block = selectedBlock;
      if (searchQuery) params.search = searchQuery;

      const data = await api.admin.getReports(params);
      setRecords(data.records || []);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to fetch attendance records');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchAttendance();
  };

  const openOverride = (rec) => {
    setSelectedRecord(rec);
    setOverrideStatus('PRESENT');
    setOverrideReason('');
    setShowOverrideModal(true);
  };

  const handleSaveOverride = async (e) => {
    e.preventDefault();
    if (!overrideReason.trim()) {
      setErrorMsg('A detailed reason is mandatory for administrative attendance overrides.');
      return;
    }

    setSubmittingOverride(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await api.admin.overrideAttendance({
        student_id: selectedRecord.student_id,
        date: selectedDate || todayStr,
        status: overrideStatus,
        reason: overrideReason
      });
      setStatusMsg(`Attendance successfully overridden for ${selectedRecord.full_name} (${selectedRecord.roll_no}) to ${overrideStatus}.`);
      setShowOverrideModal(false);
      fetchAttendance();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to apply attendance override');
    } finally {
      setSubmittingOverride(false);
    }
  };

  const handleDeleteSingleRecord = async (id, rollNo) => {
    if (!window.confirm(`Delete attendance record for ${rollNo || 'student'} on ${selectedDate}? This cannot be undone.`)) {
      return;
    }
    setDeletingId(id);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.admin.deleteAttendanceRecord(id);
      setStatusMsg(res.message || 'Attendance record deleted.');
      setRecords((prev) => prev.filter((r) => (r.attendance_id || r.id) !== id));
    } catch (err) {
      setErrorMsg(err.message || 'Failed to delete attendance record');
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAttendance = async () => {
    setClearingRecords(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const dateParam = clearScope === 'date' ? selectedDate : undefined;
      const res = await api.admin.clearAttendanceRecords(dateParam);
      setStatusMsg(res.message || 'Attendance records cleared.');
      setShowClearModal(false);
      fetchAttendance();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to clear attendance records');
    } finally {
      setClearingRecords(false);
    }
  };

  const handleExportCSV = () => {
    if (!records || records.length === 0) {
      alert('No attendance records available to export.');
      return;
    }
    const headers = ['Roll No', 'Full Name', 'Block', 'Room', 'Date', 'Time', 'Status', 'Verification Method', 'Distance (m)'];
    const rows = records.map((r) => [
      `"${r.roll_no || r.roll_number || ''}"`,
      `"${r.full_name || ''}"`,
      `"${r.block_name || r.hostel_block || ''}"`,
      `"${r.room_number || ''}"`,
      `"${r.date || selectedDate}"`,
      `"${r.check_in_time || r.time_marked || 'N/A'}"`,
      `"${r.status || 'ABSENT'}"`,
      `"${r.verification_method || 'N/A'}"`,
      `"${r.distance_meters !== null && r.distance_meters !== undefined ? Number(r.distance_meters).toFixed(1) : (r.verified_distance !== null && r.verified_distance !== undefined ? Number(r.verified_distance).toFixed(1) : 'N/A')}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Hostel_Attendance_${selectedDate || 'Export'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'PRESENT':
        return <span className="badge bg-success-subtle text-success border border-success-subtle px-2 py-1"><CheckCircle2 size={12} className="me-1 inline" /> Present</span>;
      case 'ABSENT':
        return <span className="badge bg-secondary-subtle text-secondary border border-secondary-subtle px-2 py-1"><XCircle size={12} className="me-1 inline" /> Absent</span>;
      case 'FLAGGED':
        return <span className="badge bg-danger-subtle text-danger border border-danger-subtle px-2 py-1"><AlertTriangle size={12} className="me-1 inline" /> Flagged</span>;
      case 'OVERRIDDEN':
        return <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1"><Edit3 size={12} className="me-1 inline" /> Overridden</span>;
      default:
        return <span className="badge bg-light text-dark">{status || 'Unknown'}</span>;
    }
  };

  return (
    <div className="container-fluid px-0">
      {/* Page Title */}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-2">
        <div>
          <h4 className="fw-bold mb-1 d-flex align-items-center gap-2">
            <CalendarCheck className="text-primary" size={24} />
            Attendance Records & Exception Desk
          </h4>
          <p className="text-muted small mb-0">
            Real-time daily attendance database records, facial verification audits, and non-destructive administrative overrides.
          </p>
        </div>
        <div className="d-flex gap-2">
          <button
            className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
            onClick={fetchAttendance}
            disabled={loading}
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            className="btn btn-primary btn-sm d-flex align-items-center gap-1"
            onClick={handleExportCSV}
            disabled={records.length === 0}
          >
            <Download size={14} /> Export CSV
          </button>
          <button
            className="btn btn-outline-danger btn-sm d-flex align-items-center gap-1"
            onClick={() => {
              setClearScope('date');
              setShowClearModal(true);
            }}
            disabled={loading || records.length === 0}
          >
            <Trash2 size={14} /> Clear Records
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

      {/* Filter Toolbar Card */}
      <div className="card shadow-sm border-0 rounded-3 mb-4">
        <div className="card-body p-3">
          <form onSubmit={handleSearchSubmit} className="row g-2 align-items-center">
            <div className="col-md-3">
              <label className="form-label small text-muted mb-1">Target Date</label>
              <input
                type="date"
                className="form-control form-control-sm"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
              />
            </div>

            <div className="col-md-2">
              <label className="form-label small text-muted mb-1">Status</label>
              <select
                className="form-select form-select-sm"
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
              >
                <option value="">All Statuses</option>
                <option value="PRESENT">Present</option>
                <option value="ABSENT">Absent</option>
                <option value="FLAGGED">Flagged</option>
                <option value="OVERRIDDEN">Overridden</option>
              </select>
            </div>

            <div className="col-md-2">
              <label className="form-label small text-muted mb-1">Hostel Block</label>
              <select
                className="form-select form-select-sm"
                value={selectedBlock}
                onChange={(e) => setSelectedBlock(e.target.value)}
              >
                <option value="">All Blocks</option>
                {blocks.map((b) => (
                  <option key={b.id || b.block_name} value={b.block_name}>
                    {b.block_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-md-4">
              <label className="form-label small text-muted mb-1">Search Student</label>
              <div className="input-group input-group-sm">
                <input
                  type="text"
                  className="form-control"
                  placeholder="Roll No or Name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <button type="submit" className="btn btn-outline-primary">
                  <Search size={14} />
                </button>
              </div>
            </div>

            <div className="col-md-1 d-flex align-items-end">
              <button
                type="button"
                className="btn btn-sm btn-light w-100 mt-md-4"
                onClick={() => {
                  setSelectedStatus('');
                  setSelectedBlock('');
                  setSearchQuery('');
                  setSelectedDate(todayStr);
                }}
              >
                Clear
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Records Table Card */}
      <div className="card shadow-sm border-0 rounded-3">
        <div className="card-header bg-white border-bottom py-3 d-flex justify-content-between align-items-center">
          <h6 className="card-title mb-0 fw-semibold">
            Attendance Log for <span className="text-primary">{selectedDate}</span> ({records.length} records)
          </h6>
        </div>
        <div className="card-body p-0">
          {loading ? (
            <div className="text-center p-5">
              <div className="spinner-border text-primary mb-2" role="status"></div>
              <p className="text-muted small mb-0">Querying authoritative attendance log...</p>
            </div>
          ) : records.length === 0 ? (
            <div className="text-center p-5 text-muted">
              <CalendarCheck size={40} className="mb-2 text-muted opacity-50" />
              <p className="mb-0">No attendance records found matching the selected filters.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead className="table-light">
                  <tr className="small text-muted">
                    <th className="ps-3">Student</th>
                    <th>Roll Number</th>
                    <th>Block & Room</th>
                    <th>Check-in Time</th>
                    <th>Verification</th>
                    <th>Distance</th>
                    <th>Status</th>
                    <th className="text-end pe-3">Admin Action</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r, idx) => (
                    <tr key={r.attendance_id || r.id || r.student_id || idx}>
                      <td className="ps-3 fw-medium text-dark">{r.full_name}</td>
                      <td><code>{r.roll_no || r.roll_number}</code></td>
                      <td>
                        <span className="badge bg-light text-dark me-1">{r.block_name || r.hostel_block || 'Block A'}</span>
                        <small className="text-muted">Rm {r.room_number || 'N/A'}</small>
                      </td>
                      <td>
                        {(r.check_in_time || r.time_marked) ? (
                          <span className="small text-dark d-flex align-items-center gap-1">
                            <Clock size={12} className="text-muted" />
                            {formatDisplayTime12h(r.check_in_time || r.time_marked)}
                          </span>
                        ) : (
                          <span className="small text-muted">&mdash;</span>
                        )}
                      </td>
                      <td>
                        <small className="text-muted">
                          {r.verification_method || (r.status === 'PRESENT' ? 'Face Match' : 'Pending')}
                        </small>
                      </td>
                      <td>
                        {(r.distance_meters !== null && r.distance_meters !== undefined) || (r.verified_distance !== null && r.verified_distance !== undefined) ? (
                          <span className={`small ${(r.distance_meters ?? r.verified_distance) <= 20 ? 'text-success' : 'text-danger'}`}>
                            {Number(r.distance_meters ?? r.verified_distance).toFixed(1)}m
                          </span>
                        ) : (
                          <span className="small text-muted">&mdash;</span>
                        )}
                      </td>
                      <td>{getStatusBadge(r.status)}</td>
                      <td className="text-end pe-3">
                        <div className="d-flex justify-content-end align-items-center gap-1">
                          <button
                            className="btn btn-outline-secondary btn-sm py-0 px-2"
                            style={{ fontSize: '12px' }}
                            onClick={() => openOverride(r)}
                            title="Apply Administrative Override"
                          >
                            <Edit3 size={12} className="me-1 inline" /> Override
                          </button>
                          {(r.attendance_id || r.id) && (
                            <button
                              className="btn btn-sm btn-outline-danger p-1"
                              title="Delete this attendance record"
                              disabled={deletingId === (r.attendance_id || r.id)}
                              onClick={() => handleDeleteSingleRecord(r.attendance_id || r.id, r.roll_no || r.roll_number)}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Non-Destructive Override Modal */}
      {showOverrideModal && selectedRecord && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content rounded-3 border-0 shadow">
              <div className="modal-header border-bottom">
                <h6 className="modal-title fw-bold d-flex align-items-center gap-2">
                  <Edit3 size={18} className="text-primary" />
                  Administrative Attendance Override
                </h6>
                <button type="button" className="btn-close" onClick={() => setShowOverrideModal(false)}></button>
              </div>
              <form onSubmit={handleSaveOverride}>
                <div className="modal-body p-4">
                  <div className="alert alert-warning small mb-3">
                    <strong>Audit Notice:</strong> In accordance with hostel compliance policy, manual overrides are non-destructive and preserve original check-in evidence in the system audit logs.
                  </div>

                  <div className="mb-3">
                    <label className="form-label small text-muted mb-0">Student Profile</label>
                    <div className="fw-semibold text-dark">{selectedRecord.full_name} ({selectedRecord.roll_no})</div>
                    <div className="small text-muted">{selectedRecord.block_name} &bull; Room {selectedRecord.room_number}</div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small fw-medium">Override Attendance Status</label>
                    <select
                      className="form-select form-select-sm"
                      value={overrideStatus}
                      onChange={(e) => setOverrideStatus(e.target.value)}
                      required
                    >
                      <option value="PRESENT">Mark Present (Approved Exception)</option>
                      <option value="ABSENT">Mark Absent</option>
                      <option value="EXCUSED">Mark Excused / On Leave</option>
                    </select>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small fw-medium">
                      Mandatory Justification Reason <span className="text-danger">*</span>
                    </label>
                    <textarea
                      className="form-control"
                      rows="3"
                      placeholder="e.g., Medical certificate verified by warden; technical glitch with camera during evening roll call."
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      required
                    />
                    <div className="form-text small">This reason will be permanently recorded in the administrative audit log.</div>
                  </div>
                </div>
                <div className="modal-footer border-top">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => setShowOverrideModal(false)}
                    disabled={submittingOverride}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-sm btn-primary"
                    disabled={submittingOverride}
                  >
                    {submittingOverride ? 'Saving Override...' : 'Commit Override'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Clear Attendance Records Confirmation Modal */}
      {showClearModal && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content rounded-3 border-0 shadow">
              <div className="modal-header border-bottom bg-danger-subtle text-danger">
                <h6 className="modal-title fw-bold d-flex align-items-center gap-2">
                  <Trash2 size={18} />
                  Purge Attendance Records
                </h6>
                <button type="button" className="btn-close" onClick={() => setShowClearModal(false)}></button>
              </div>
              <div className="modal-body p-4">
                <div className="mb-3">
                  <label className="form-label fw-semibold small">Purge Scope</label>
                  <div className="form-check mb-2">
                    <input
                      className="form-check-input"
                      type="radio"
                      name="clearScopeRadio"
                      id="scopeDate"
                      checked={clearScope === 'date'}
                      onChange={() => setClearScope('date')}
                    />
                    <label className="form-check-label small" htmlFor="scopeDate">
                      Clear records for selected date only (<strong>{selectedDate}</strong> - {records.length} records)
                    </label>
                  </div>
                  <div className="form-check">
                    <input
                      className="form-check-input"
                      type="radio"
                      name="clearScopeRadio"
                      id="scopeAll"
                      checked={clearScope === 'all'}
                      onChange={() => setClearScope('all')}
                    />
                    <label className="form-check-label small text-danger fw-semibold" htmlFor="scopeAll">
                      Purge ALL historical attendance records across all dates
                    </label>
                  </div>
                </div>

                <div className="alert alert-warning py-2 px-3 small mb-0">
                  <AlertTriangle size={14} className="inline me-1" />
                  This operation deletes historical attendance marks permanently to clean up stale test or garbage data. This action cannot be reversed.
                </div>
              </div>
              <div className="modal-footer border-top bg-light py-2">
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => setShowClearModal(false)}
                  disabled={clearingRecords}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger d-flex align-items-center gap-1"
                  onClick={handleClearAttendance}
                  disabled={clearingRecords}
                >
                  <Trash2 size={14} />
                  {clearingRecords ? 'Purging Records...' : clearScope === 'date' ? `Delete ${selectedDate} Records` : 'Purge All Attendance Records'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
