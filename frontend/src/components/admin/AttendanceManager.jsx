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
  UserCheck
} from 'lucide-react';

export default function AttendanceManager() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

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

  const handleExportCSV = () => {
    if (!records || records.length === 0) {
      alert('No attendance records available to export.');
      return;
    }
    const headers = ['Roll No', 'Full Name', 'Block', 'Room', 'Date', 'Time', 'Status', 'Verification Method', 'Distance (m)'];
    const rows = records.map((r) => [
      `"${r.roll_no || ''}"`,
      `"${r.full_name || ''}"`,
      `"${r.block_name || ''}"`,
      `"${r.room_number || ''}"`,
      `"${r.date || selectedDate}"`,
      `"${r.check_in_time || 'N/A'}"`,
      `"${r.status || 'ABSENT'}"`,
      `"${r.verification_method || 'N/A'}"`,
      `"${r.distance_meters !== null && r.distance_meters !== undefined ? r.distance_meters.toFixed(1) : 'N/A'}"`
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
                    <tr key={r.attendance_id || r.student_id || idx}>
                      <td className="ps-3 fw-medium text-dark">{r.full_name}</td>
                      <td><code>{r.roll_no}</code></td>
                      <td>
                        <span className="badge bg-light text-dark me-1">{r.block_name || 'Block A'}</span>
                        <small className="text-muted">Rm {r.room_number || 'N/A'}</small>
                      </td>
                      <td>
                        {r.check_in_time ? (
                          <span className="small text-dark d-flex align-items-center gap-1">
                            <Clock size={12} className="text-muted" />
                            {new Date(r.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
                        {r.distance_meters !== null && r.distance_meters !== undefined ? (
                          <span className={`small ${r.distance_meters <= 20 ? 'text-success' : 'text-danger'}`}>
                            {r.distance_meters.toFixed(1)}m
                          </span>
                        ) : (
                          <span className="small text-muted">&mdash;</span>
                        )}
                      </td>
                      <td>{getStatusBadge(r.status)}</td>
                      <td className="text-end pe-3">
                        <button
                          className="btn btn-outline-secondary btn-sm py-0 px-2"
                          style={{ fontSize: '12px' }}
                          onClick={() => openOverride(r)}
                          title="Apply Administrative Override"
                        >
                          <Edit3 size={12} className="me-1 inline" /> Override
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
    </div>
  );
}
