import React, { useState, useEffect } from 'react';
import { api, authStorage } from '../../utils/api';
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
  Trash2,
  Calendar,
  Users,
  Building,
  FileSpreadsheet
} from 'lucide-react';
import { exportToExcel, exportToCsv } from '../../utils/exportUtils';
import { formatTime12h, getTodayDateIST } from '../../utils/timeUtils';

// Format time to 12-hour format with AM/PM (IST)
const formatDisplayTime12h = (timeVal) => {
  return formatTime12h(timeVal);
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function AttendanceManager() {
  // Navigation View Toggle: 'daily' (Daily Roll Call Logs) | 'ledger' (Monthly & Annual Ledger)
  const [activeView, setActiveView] = useState('daily');

  // Daily Records State
  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState({ totalRegistered: 0, present: 0, absent: 0 });
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearScope, setClearScope] = useState('date'); // 'date' | 'all'
  const [clearingRecords, setClearingRecords] = useState(false);

  // Daily Filters
  const todayStr = getTodayDateIST();
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

  // Monthly & Annual Ledger State
  const currentNow = new Date();
  const [ledgerYear, setLedgerYear] = useState(currentNow.getFullYear());
  const [ledgerMonth, setLedgerMonth] = useState(currentNow.getMonth() + 1);
  const [ledgerData, setLedgerData] = useState(null);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [ledgerBlock, setLedgerBlock] = useState('');

  useEffect(() => {
    fetchBlocks();
  }, []);

  useEffect(() => {
    if (activeView === 'daily') {
      fetchAttendance();
    } else {
      fetchLedger();
    }
  }, [activeView, selectedDate, selectedStatus, selectedBlock, ledgerYear, ledgerMonth]);

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
      if (data.summary) {
        setSummary(data.summary);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to fetch attendance records');
    } finally {
      setLoading(false);
    }
  };

  const fetchLedger = async () => {
    setLoadingLedger(true);
    setErrorMsg(null);
    try {
      const user = authStorage.getUser();
      const isWarden = user?.role === 'WARDEN';
      const apiFn = isWarden ? api.warden.getAttendanceLedger : api.admin.getAttendanceLedger;
      const res = await apiFn({ year: ledgerYear, month: ledgerMonth });
      if (res && res.ledger) {
        setLedgerData(res.ledger);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to load attendance ledger');
    } finally {
      setLoadingLedger(false);
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

  const getAttendanceExportData = () => {
    const headers = [
      { key: 'roll_no', label: 'Roll No' },
      { key: 'full_name', label: 'Full Name' },
      { key: 'block_name', label: 'Hostel Block' },
      { key: 'room_number', label: 'Room' },
      { key: 'date', label: 'Date' },
      { key: 'check_in_time', label: 'Check-in Time (IST)' },
      { key: 'status', label: 'Status' },
      { key: 'verification_method', label: 'Verification Method' },
      { key: 'distance', label: 'Distance (m)' }
    ];
    const data = (records || []).map((r) => ({
      roll_no: r.roll_no || r.roll_number || '',
      full_name: r.full_name || '',
      block_name: r.block_name || r.hostel_block || '',
      room_number: r.room_number || '',
      date: r.date || selectedDate,
      check_in_time: r.check_in_time || r.time_marked ? formatTime12h(r.check_in_time || r.time_marked) : 'N/A',
      status: r.status || 'ABSENT',
      verification_method: r.verification_method || 'N/A',
      distance: r.distance_meters !== null && r.distance_meters !== undefined ? Number(r.distance_meters).toFixed(1) : (r.verified_distance !== null && r.verified_distance !== undefined ? Number(r.verified_distance).toFixed(1) : 'N/A')
    }));
    return { headers, data };
  };

  const handleExportCSV = () => {
    const { headers, data } = getAttendanceExportData();
    exportToCsv({
      filename: `Hostel_Attendance_${selectedDate || 'Export'}`,
      headers,
      data
    });
  };

  const handleExportExcel = () => {
    const { headers, data } = getAttendanceExportData();
    exportToExcel({
      filename: `Hostel_Attendance_${selectedDate || 'Export'}`,
      sheetName: 'Daily Attendance',
      headers,
      data
    });
  };

  const getLedgerExportData = () => {
    if (!ledgerData || !ledgerData.students || ledgerData.students.length === 0) {
      return { headers: [], data: [] };
    }
    const filteredStudents = (ledgerData.students || []).filter((st) => {
      const matchSearch = !ledgerSearch ||
        (st.full_name && st.full_name.toLowerCase().includes(ledgerSearch.toLowerCase())) ||
        (st.roll_number && st.roll_number.toLowerCase().includes(ledgerSearch.toLowerCase()));
      const matchBlock = !ledgerBlock || st.hostel_block === ledgerBlock;
      return matchSearch && matchBlock;
    });

    const headers = [
      { key: 'roll_number', label: 'Roll Number' },
      { key: 'full_name', label: 'Full Name' },
      { key: 'hostel_block', label: 'Hostel Block' },
      { key: 'room_number', label: 'Room Number' },
      { key: 'course', label: 'Course' },
      { key: 'phone', label: 'Phone' },
      { key: 'monthly_present', label: `Month Present (${ledgerData.monthName})` },
      { key: 'monthly_leave', label: `Month Approved Leave (${ledgerData.monthName})` },
      { key: 'monthly_absent', label: `Month Unauthorized Missed (${ledgerData.monthName})` },
      { key: 'consecutive_absent_nights', label: 'Consecutive Nights Missed' },
      { key: 'safety_status', label: 'Safety Alert Status' },
      { key: 'monthly_active_days', label: 'Month Net Active Days' },
      { key: 'yearly_present', label: `Session Present (${ledgerData.year})` },
      { key: 'yearly_leave', label: `Session Approved Leave (${ledgerData.year})` },
      { key: 'yearly_absent', label: `Session Unauthorized Missed (${ledgerData.year})` },
      { key: 'yearly_active_days', label: 'Session Net Active Days' }
    ];

    const data = filteredStudents.map((s) => ({
      roll_number: s.roll_number || '',
      full_name: s.full_name || '',
      hostel_block: s.hostel_block || '',
      room_number: s.room_number || '',
      course: s.course || '',
      phone: s.phone || '',
      monthly_present: s.monthly_present || 0,
      monthly_leave: s.monthly_leave || 0,
      monthly_absent: s.monthly_absent || 0,
      consecutive_absent_nights: s.consecutive_absent_nights || 0,
      safety_status: s.is_safety_alert ? 'CRITICAL_SAFETY_ALERT' : 'NORMAL',
      monthly_active_days: ledgerData.monthlyActiveDays || 30,
      yearly_present: s.yearly_present || 0,
      yearly_leave: s.yearly_leave || 0,
      yearly_absent: s.yearly_absent || 0,
      yearly_active_days: ledgerData.yearlyActiveDays || 365
    }));

    return { headers, data };
  };

  const handleExportLedgerCSV = () => {
    const { headers, data } = getLedgerExportData();
    exportToCsv({
      filename: `Hostel_Roll_Call_Ledger_${ledgerData.year}_${String(ledgerData.month).padStart(2, '0')}`,
      headers,
      data
    });
  };

  const handleExportLedgerExcel = () => {
    const { headers, data } = getLedgerExportData();
    exportToExcel({
      filename: `Hostel_Roll_Call_Ledger_${ledgerData.year}_${String(ledgerData.month).padStart(2, '0')}`,
      sheetName: 'Roll Call Ledger',
      headers,
      data
    });
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

  // Filtered ledger students
  const filteredLedgerStudents = (ledgerData?.students || []).filter((st) => {
    const matchSearch = !ledgerSearch ||
      (st.full_name && st.full_name.toLowerCase().includes(ledgerSearch.toLowerCase())) ||
      (st.roll_number && st.roll_number.toLowerCase().includes(ledgerSearch.toLowerCase()));
    const matchBlock = !ledgerBlock || st.hostel_block === ledgerBlock;
    return matchSearch && matchBlock;
  });

  return (
    <div className="container-fluid px-0">
      {/* Page Title & Main View Switcher */}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-3">
        <div>
          <h4 className="fw-bold mb-1 d-flex align-items-center gap-2">
            <CalendarCheck className="text-primary" size={24} />
            Hostel Roll Call & Attendance Manager
          </h4>
          <p className="text-muted small mb-0">
            Authoritative hostel residence logs, facial verification audits, and month-by-month & annual day-count ledgers (strictly pure day counts; no academic course percentages).
          </p>
        </div>

        {/* View Switcher Pills */}
        <div className="btn-group bg-light p-1 rounded-3 border shadow-sm">
          <button
            type="button"
            className={`btn btn-sm ${activeView === 'daily' ? 'btn-primary shadow-sm fw-semibold' : 'btn-light text-dark'}`}
            onClick={() => setActiveView('daily')}
          >
            <CalendarCheck size={14} className="me-1 inline" />
            Daily Roll Call Records
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeView === 'ledger' ? 'btn-primary shadow-sm fw-semibold' : 'btn-light text-dark'}`}
            onClick={() => setActiveView('ledger')}
          >
            <Calendar size={14} className="me-1 inline" />
            Monthly & Annual Ledger
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

      {/* VIEW 1: DAILY ATTENDANCE RECORDS */}
      {activeView === 'daily' && (
        <>
          <div className="d-flex justify-content-end gap-2 mb-3">
            <button
              className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
              onClick={fetchAttendance}
              disabled={loading}
            >
              <RefreshCw size={14} /> Refresh
            </button>
            <button
              className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
              onClick={handleExportCSV}
              disabled={records.length === 0}
              title="Export Daily Attendance as CSV"
            >
              <Download size={14} /> Export CSV
            </button>
            <button
              className="btn btn-success btn-sm d-flex align-items-center gap-1 shadow-sm"
              onClick={handleExportExcel}
              disabled={records.length === 0}
              title="Export Daily Attendance as Excel (.xlsx)"
            >
              <FileSpreadsheet size={14} /> Export Excel (.xlsx)
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
            <div className="card-header bg-white border-bottom py-3 d-flex flex-wrap justify-content-between align-items-center gap-2">
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <h6 className="card-title mb-0 fw-semibold">
                  Attendance Log for <span className="text-primary">{selectedDate}</span> ({records.length} records)
                </h6>
                <div className="d-flex align-items-center gap-1 ms-md-2">
                  <span
                    className={`badge ${!selectedStatus ? 'bg-primary text-white' : 'bg-light text-dark border'}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedStatus('')}
                    title="View All Students"
                  >
                    All: <strong>{summary.totalRegistered || records.length}</strong>
                  </span>
                  <span
                    className={`badge ${selectedStatus === 'PRESENT' ? 'bg-success text-white' : 'bg-success-subtle text-success border border-success-subtle'}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedStatus(selectedStatus === 'PRESENT' ? '' : 'PRESENT')}
                    title="Filter Present Students"
                  >
                    <CheckCircle2 size={11} className="me-1 inline" /> Present: <strong>{summary.present}</strong>
                  </span>
                  <span
                    className={`badge ${selectedStatus === 'ABSENT' ? 'bg-danger text-white' : 'bg-danger-subtle text-danger border border-danger-subtle'}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedStatus(selectedStatus === 'ABSENT' ? '' : 'ABSENT')}
                    title="Filter Absent Students"
                  >
                    <XCircle size={11} className="me-1 inline" /> Absent: <strong>{summary.absent}</strong>
                  </span>
                </div>
              </div>
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
                      {records.map((r) => (
                        <tr key={r.attendance_id || r.id || `${r.student_id}_${r.date}`}>
                          <td className="ps-3">
                            <div className="fw-semibold text-dark">{r.full_name || 'Resident Student'}</div>
                            <small className="text-muted">{r.email || r.phone || '—'}</small>
                          </td>
                          <td>
                            <span className="badge bg-light text-dark border font-monospace">
                              {r.roll_no || r.roll_number || 'N/A'}
                            </span>
                          </td>
                          <td>
                            <div className="small fw-medium text-dark">{r.block_name || r.hostel_block || '—'}</div>
                            <small className="text-muted">Room: {r.room_number || '—'}</small>
                          </td>
                          <td>
                            <div className="small text-dark d-flex align-items-center gap-1">
                              <Clock size={12} className="text-muted" />
                              {formatDisplayTime12h(r.check_in_time || r.time_marked)}
                            </div>
                          </td>
                          <td>
                            <span className="small text-muted">{r.verification_method || 'Facial Match'}</span>
                          </td>
                          <td>
                            <span className="small text-muted">
                              {r.distance_meters !== null && r.distance_meters !== undefined
                                ? `${Number(r.distance_meters).toFixed(1)}m`
                                : r.verified_distance !== null && r.verified_distance !== undefined
                                ? `${Number(r.verified_distance).toFixed(1)}m`
                                : '—'}
                            </span>
                          </td>
                          <td>{getStatusBadge(r.status)}</td>
                          <td className="text-end pe-3">
                            <div className="btn-group btn-group-sm">
                              <button
                                type="button"
                                className="btn btn-outline-primary btn-sm py-1 px-2"
                                onClick={() => openOverride(r)}
                                title="Administrative Override"
                              >
                                <Edit3 size={13} className="me-1 inline" /> Override
                              </button>
                              {(r.attendance_id || r.id) && (
                                <button
                                  type="button"
                                  className="btn btn-outline-danger btn-sm py-1 px-2"
                                  onClick={() => handleDeleteSingleRecord(r.attendance_id || r.id, r.roll_no || r.roll_number)}
                                  disabled={deletingId === (r.attendance_id || r.id)}
                                  title="Delete Record"
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
        </>
      )}

      {/* VIEW 2: MONTHLY & ANNUAL ROLL CALL LEDGER */}
      {activeView === 'ledger' && (
        <div className="d-flex flex-column gap-4">
          {/* Action Toolbar */}
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
            <div className="d-flex align-items-center gap-2 flex-wrap">
              {/* Year Selector */}
              <div className="d-flex align-items-center gap-1">
                <span className="small text-muted fw-semibold">Session Year:</span>
                <select
                  className="form-select form-select-sm"
                  style={{ width: '110px' }}
                  value={ledgerYear}
                  onChange={(e) => setLedgerYear(parseInt(e.target.value, 10))}
                >
                  {[currentNow.getFullYear(), currentNow.getFullYear() - 1, currentNow.getFullYear() - 2].map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>

              {/* Month Selector */}
              <div className="d-flex align-items-center gap-1">
                <span className="small text-muted fw-semibold">Month:</span>
                <select
                  className="form-select form-select-sm"
                  style={{ width: '140px' }}
                  value={ledgerMonth}
                  onChange={(e) => setLedgerMonth(parseInt(e.target.value, 10))}
                >
                  {MONTH_NAMES.map((mName, idx) => (
                    <option key={idx + 1} value={idx + 1}>
                      {mName}
                    </option>
                  ))}
                </select>
              </div>

              {/* Block Filter */}
              <div className="d-flex align-items-center gap-1">
                <span className="small text-muted fw-semibold">Block:</span>
                <select
                  className="form-select form-select-sm"
                  style={{ width: '130px' }}
                  value={ledgerBlock}
                  onChange={(e) => setLedgerBlock(e.target.value)}
                >
                  <option value="">All Blocks</option>
                  {blocks.map((b) => (
                    <option key={b.id || b.block_name} value={b.block_name}>
                      {b.block_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Search Resident */}
              <div className="input-group input-group-sm" style={{ width: '220px' }}>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Filter name or roll..."
                  value={ledgerSearch}
                  onChange={(e) => setLedgerSearch(e.target.value)}
                />
                {ledgerSearch && (
                  <button className="btn btn-outline-secondary" onClick={() => setLedgerSearch('')}>
                    &times;
                  </button>
                )}
              </div>
            </div>

            <div className="d-flex gap-2">
              <button
                className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
                onClick={fetchLedger}
                disabled={loadingLedger}
              >
                <RefreshCw size={14} /> Refresh Ledger
              </button>
              <button
                className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
                onClick={handleExportLedgerCSV}
                disabled={!ledgerData || !ledgerData.students || ledgerData.students.length === 0}
                title="Export Roll Call Ledger as CSV"
              >
                <Download size={14} /> Export CSV
              </button>
              <button
                className="btn btn-success btn-sm d-flex align-items-center gap-1 shadow-sm"
                onClick={handleExportLedgerExcel}
                disabled={!ledgerData || !ledgerData.students || ledgerData.students.length === 0}
                title="Export Roll Call Ledger as Excel (.xlsx)"
              >
                <FileSpreadsheet size={14} /> Export Excel (.xlsx)
              </button>
            </div>
          </div>

          {/* Critical Safety Alert Banner if any resident missed >= 2 consecutive nights */}
          {ledgerData && ledgerData.safetyAlertCount > 0 && (
            <div className="alert alert-danger d-flex align-items-center justify-content-between p-2.5 rounded-2 border-danger border-opacity-50 mb-3">
              <div className="d-flex align-items-center gap-2">
                <AlertTriangle size={20} className="text-danger flex-shrink-0" />
                <div>
                  <strong className="text-danger">Critical Defaulter Safety Alert:</strong>
                  <div className="hg-text-xs text-danger opacity-90">
                    <strong>{ledgerData.safetyAlertCount} resident student{ledgerData.safetyAlertCount > 1 ? 's' : ''}</strong> have missed <strong>2 or more consecutive roll calls</strong> without an approved gate pass or excused leave.
                  </div>
                </div>
              </div>
              <span className="badge bg-danger text-white px-2.5 py-1 fw-bold hg-badge">
                {ledgerData.safetyAlertCount} At-Risk
              </span>
            </div>
          )}

          {/* KPI Summary Banner (Month-to-Date & 3-Tier State) */}
          {ledgerData && (
            <div className="row g-2 mb-3">
              <div className="col-12 col-sm-6 col-lg-3">
                <div className="card hg-card p-2.5 bg-white h-100">
                  <div className="text-muted hg-text-xs fw-medium">Active Ledger Period</div>
                  <div className="fw-bold fs-6 text-primary mt-1">{ledgerData.monthName}</div>
                  <div className="text-muted hg-text-xs hg-tabular">
                    {ledgerData.daysElapsed || ledgerData.daysInMonth} of {ledgerData.daysInMonth} days passed ({ledgerData.daysRemaining || 0} left)
                  </div>
                </div>
              </div>
              <div className="col-12 col-sm-6 col-lg-3">
                <div className="card hg-card p-2.5 bg-white h-100">
                  <div className="text-muted hg-text-xs fw-medium">Official Holidays Excluded</div>
                  <div className="fw-bold fs-6 text-secondary mt-1 hg-tabular">{ledgerData.monthlyHolidays} Days</div>
                  <div className="text-muted hg-text-xs hg-tabular">
                    Session {ledgerData.year}: {ledgerData.yearlyHolidays} holidays excluded
                  </div>
                </div>
              </div>
              <div className="col-12 col-sm-6 col-lg-3">
                <div className="card hg-card p-2.5 bg-white h-100">
                  <div className="text-muted hg-text-xs fw-medium">Net Active Days (Month)</div>
                  <div className="fw-bold fs-6 text-success mt-1 hg-tabular">{ledgerData.monthlyActiveDays} Active Days</div>
                  <div className="text-muted hg-text-xs hg-tabular">
                    Session Net Active Days: {ledgerData.yearlyActiveDays}
                  </div>
                </div>
              </div>
              <div className="col-12 col-sm-6 col-lg-3">
                <div className="card hg-card p-2.5 bg-white h-100">
                  <div className="text-muted hg-text-xs fw-medium">Safety Defaulters (&ge;2 Nights)</div>
                  <div className={`fw-bold fs-6 mt-1 hg-tabular ${(ledgerData.safetyAlertCount || 0) > 0 ? 'text-danger' : 'text-success'}`}>
                    {ledgerData.safetyAlertCount || 0} Residents
                  </div>
                  <div className="text-muted hg-text-xs">
                    {(ledgerData.safetyAlertCount || 0) === 0 ? 'All residents verified safely' : 'Requires immediate welfare check'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Ledger Table Card */}
          <div className="card hg-card mb-3 overflow-hidden">
            <div className="card-header bg-white border-bottom py-3 d-flex justify-content-between align-items-center flex-wrap gap-2">
              <div className="d-flex align-items-center gap-2">
                <Calendar size={18} className="text-primary" />
                <h6 className="card-title mb-0 fw-semibold">
                  Official Roll Call Ledger: {ledgerData?.monthName || 'Current Month'} &bull; Session {ledgerYear}
                </h6>
              </div>
              <span className="badge bg-light text-dark border">
                Pure Day Counts &bull; Holidays Excluded &bull; No Course %
              </span>
            </div>

            <div className="card-body p-0">
              {loadingLedger ? (
                <div className="text-center p-5">
                  <div className="spinner-border text-primary mb-2" role="status"></div>
                  <p className="text-muted small mb-0">Calculating hostel presence days across residents...</p>
                </div>
              ) : filteredLedgerStudents.length === 0 ? (
                <div className="text-center p-5 text-muted">
                  <Users size={40} className="mb-2 text-muted opacity-50" />
                  <p className="mb-0">No resident student records found for the selected month/block filter.</p>
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead className="table-light">
                      <tr className="small text-muted">
                        <th className="ps-3">Resident Student</th>
                        <th>Roll Number</th>
                        <th>Block & Room</th>
                        <th>Present (In Hostel)</th>
                        <th>Approved Leave (Pass)</th>
                        <th>Unauthorized Missed</th>
                        <th>Session {ledgerYear} Presence</th>
                        <th className="pe-3">Safety Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLedgerStudents.map((st) => (
                        <tr key={st.id || st.roll_number}>
                          <td className="ps-3">
                            <div className="fw-semibold text-dark">{st.full_name}</div>
                            <small className="text-muted">{st.phone || st.course || '—'}</small>
                          </td>
                          <td>
                            <span className="badge bg-light text-dark border font-monospace">
                              {st.roll_number}
                            </span>
                          </td>
                          <td>
                            <div className="small fw-medium text-dark">{st.hostel_block || '—'}</div>
                            <small className="text-muted">Room: {st.room_number || '—'}</small>
                          </td>
                          <td>
                            <span className="badge bg-success bg-opacity-10 text-success fw-bold px-2 py-1">
                              ✓ {st.monthly_present} Present
                            </span>
                            <div className="text-muted small mt-1" style={{ fontSize: '11px' }}>
                              out of {ledgerData?.daysInMonth || 30} days
                            </div>
                          </td>
                          <td>
                            <span className="badge bg-warning bg-opacity-15 text-warning-emphasis fw-semibold px-2 py-1">
                              🏖️ {st.monthly_leave || 0} Leave
                            </span>
                            <div className="text-muted small mt-1" style={{ fontSize: '11px' }}>
                              Approved gate/night passes
                            </div>
                          </td>
                          <td>
                            <span className={`badge ${st.monthly_absent > 0 ? 'bg-danger bg-opacity-10 text-danger' : 'bg-light text-muted'} fw-semibold px-2 py-1`}>
                              {st.monthly_absent > 0 ? `${st.monthly_absent} Days Missed` : '0 Absent'}
                            </span>
                          </td>
                          <td>
                            <span className="fw-bold text-success">
                              {st.yearly_present} / {ledgerData?.yearlyActiveDays || 365} Active Days
                            </span>
                            <div className="text-muted small" style={{ fontSize: '11px' }}>
                              ({ledgerData?.yearlyHolidays || 0} holidays excl.)
                            </div>
                          </td>
                          <td className="pe-3">
                            {st.is_safety_alert ? (
                              <span className="badge bg-danger text-white fw-bold px-2 py-1 shadow-sm">
                                🚨 {st.consecutive_absent_nights} Nights Missing
                              </span>
                            ) : (
                              <span className="badge bg-success-subtle text-success border border-success-subtle px-2 py-1">
                                ✓ Normal
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Override Attendance Modal */}
      {showOverrideModal && selectedRecord && (
        <div className="modal show d-block hg-modal-backdrop" tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content hg-card shadow rounded-2 border-0">
              <div className="modal-header border-bottom py-2.5 px-3">
                <h6 className="modal-title fw-bold mb-0">
                  Administrative Override &bull; {selectedRecord.full_name} ({selectedRecord.roll_no || selectedRecord.roll_number})
                </h6>
                <button type="button" className="btn-close" onClick={() => setShowOverrideModal(false)}></button>
              </div>
              <form onSubmit={handleSaveOverride}>
                <div className="modal-body p-3">
                  <div className="mb-3">
                    <label className="form-label hg-text-xs fw-medium">Record Date</label>
                    <input type="text" className="form-control form-control-sm" value={selectedDate || todayStr} disabled />
                  </div>
                  <div className="mb-3">
                    <label className="form-label hg-text-xs fw-medium">Override Decision Status</label>
                    <select
                      className="form-select form-select-sm"
                      value={overrideStatus}
                      onChange={(e) => setOverrideStatus(e.target.value)}
                    >
                      <option value="PRESENT">Mark PRESENT (Overridden)</option>
                      <option value="ABSENT">Mark ABSENT</option>
                      <option value="EXCUSED">Mark EXCUSED</option>
                    </select>
                  </div>
                  <div className="mb-3">
                    <label className="form-label hg-text-xs fw-medium">Administrative Justification / Reason *</label>
                    <textarea
                      className="form-control"
                      rows="3"
                      placeholder="e.g. Approved medical certificate verified by Warden, or authorized sports competition leave."
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      required
                    ></textarea>
                    <div className="form-text hg-text-xs">This reason will be immutably recorded in the system audit log.</div>
                  </div>
                </div>
                <div className="modal-footer border-top bg-light py-2 px-3">
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => setShowOverrideModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-sm btn-primary" disabled={submittingOverride}>
                    {submittingOverride ? 'Saving...' : 'Confirm Override'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Clear Attendance Modal */}
      {showClearModal && (
        <div className="modal show d-block hg-modal-backdrop" tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content hg-card shadow rounded-2 border-0">
              <div className="modal-header border-bottom py-2.5 px-3 bg-danger text-white">
                <h6 className="modal-title fw-bold d-flex align-items-center gap-2 mb-0">
                  <AlertTriangle size={16} />
                  Purge Attendance Records
                </h6>
                <button type="button" className="btn-close btn-close-white" onClick={() => setShowClearModal(false)}></button>
              </div>
              <div className="modal-body p-4">
                <p className="small text-muted mb-3">
                  Select the scope of attendance records to permanently remove from the database:
                </p>

                <div className="mb-3">
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
