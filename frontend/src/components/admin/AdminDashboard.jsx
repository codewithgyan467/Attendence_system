import React, { useState, useEffect } from 'react';
import { api } from '../../utils/api';
import KpiCard from '../common/KpiCard';
import { AttendanceTrendChart, StatusDistributionChart, BlockDistributionChart } from './AdminCharts';
import {
  Users,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ShieldAlert,
  RotateCw,
  MapPin,
  TrendingUp,
  FileCheck,
  Search,
  Filter,
  Download,
  X,
  Phone,
  Mail,
  ArrowRight
} from 'lucide-react';

export default function AdminDashboard({ onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Today's Roster Interactive Modal State
  const [rosterModalOpen, setRosterModalOpen] = useState(false);
  const [rosterTab, setRosterTab] = useState('PRESENT'); // 'PRESENT' | 'ABSENT'
  const [searchQuery, setSearchQuery] = useState('');
  const [blockFilter, setBlockFilter] = useState('');

  const fetchStats = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.admin.getDashboardStats();
      if (res.success) {
        setData(res);
      }
    } catch (err) {
      setError(err.message || 'Failed to load dashboard metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  if (loading && !data) {
    return (
      <div className="p-4 text-center">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
        <div className="text-muted mt-2">Loading enterprise metrics...</div>
      </div>
    );
  }

  const s = data?.summary || {};

  const handleOpenRoster = (tab) => {
    setRosterTab(tab);
    setSearchQuery('');
    setBlockFilter('');
    setRosterModalOpen(true);
  };

  const presentStudents = data?.todayPresent || [];
  const absentStudents = data?.todayAbsent || [];

  const activeList = rosterTab === 'PRESENT' ? presentStudents : absentStudents;

  const filteredList = activeList.filter((item) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesQuery =
      !q ||
      item.full_name?.toLowerCase().includes(q) ||
      item.roll_number?.toLowerCase().includes(q) ||
      item.room_number?.toLowerCase().includes(q) ||
      item.hostel_block?.toLowerCase().includes(q) ||
      item.course?.toLowerCase().includes(q);

    const matchesBlock = !blockFilter || item.hostel_block === blockFilter;

    return matchesQuery && matchesBlock;
  });

  const availableBlocks = Array.from(
    new Set(
      [...presentStudents, ...absentStudents]
        .map((st) => st.hostel_block)
        .filter(Boolean)
    )
  ).sort();

  const handleExportRosterCsv = () => {
    const isPresent = rosterTab === 'PRESENT';
    const header = isPresent
      ? 'Roll Number,Full Name,Hostel Block,Room Number,Course,Check-in Time,Status,Verified Distance,Phone,Email\n'
      : 'Roll Number,Full Name,Hostel Block,Room Number,Course,Status,Phone,Email\n';

    const rows = filteredList.map((item) => {
      if (isPresent) {
        return `"${item.roll_number || ''}","${item.full_name || ''}","${item.hostel_block || ''}","${item.room_number || ''}","${item.course || ''}","${item.time_marked_12 || item.time_marked || ''}","${item.status || 'PRESENT'}","${item.verified_distance !== null && item.verified_distance !== undefined ? item.verified_distance + 'm' : ''}","${item.phone || ''}","${item.email || ''}"`;
      } else {
        return `"${item.roll_number || ''}","${item.full_name || ''}","${item.hostel_block || ''}","${item.room_number || ''}","${item.course || ''}","${item.status || 'ABSENT'}","${item.phone || ''}","${item.email || ''}"`;
      }
    });

    const csvContent = header + rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `hostel_${isPresent ? 'present' : 'absent'}_residents_${new Date().toISOString().split('T')[0]}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const todayFormatted = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });

  return (
    <div className="container-fluid px-0">
      {/* Page Header */}
      <div className="d-flex align-items-center justify-content-between mb-4 flex-wrap gap-2">
        <div>
          <h4 className="fw-bold mb-1">Executive Attendance Dashboard</h4>
          <p className="text-muted mb-0" style={{ fontSize: '13px' }}>
            Real-time biometric and geo-fenced hostel operations overview. Click Present or Absent cards to view student rosters.
          </p>
        </div>
        <div className="d-flex align-items-center gap-2">
          <button onClick={fetchStats} className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" disabled={loading}>
            <RotateCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh Data</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger py-2 px-3 mb-4" style={{ fontSize: '13px' }}>
          <AlertTriangle size={16} className="me-2" />
          {error}
        </div>
      )}

      {/* KPI Cards Row */}
      <div className="row g-3 mb-4">
        <div className="col-12 col-sm-6 col-xl-3">
          <KpiCard
            title="Total Registered Students"
            value={s.totalRegistered || 0}
            subtitle={`${s.totalAllotted || 0} pre-allotted in roster`}
            icon={Users}
            color="primary"
          />
        </div>
        <div className="col-12 col-sm-6 col-xl-3">
          <KpiCard
            title="Present Today"
            value={s.presentToday || 0}
            subtitle={`${s.attendancePercentage || 0}% overall attendance`}
            icon={CheckCircle2}
            color="success"
            badgeText={s.lateToday > 0 ? `+${s.lateToday} Late` : undefined}
            onClick={() => handleOpenRoster('PRESENT')}
            actionText="View Present Students"
          />
        </div>
        <div className="col-12 col-sm-6 col-xl-3">
          <KpiCard
            title="Absent / Unmarked"
            value={s.absentToday || 0}
            subtitle="Residents pending check-in"
            icon={Clock}
            color="warning"
            onClick={() => handleOpenRoster('ABSENT')}
            actionText="View Absent Students"
          />
        </div>
        <div className="col-12 col-sm-6 col-xl-3">
          <KpiCard
            title="Forge Location Alerts"
            value={s.flaggedForgeCount || 0}
            subtitle="Hit 3-strike location limit"
            icon={ShieldAlert}
            color={s.flaggedForgeCount > 0 ? 'danger' : 'primary'}
            badgeText={s.pendingCorrections > 0 ? `${s.pendingCorrections} Corrections Pending` : undefined}
          />
        </div>
      </div>

      {/* Charts Row */}
      <div className="row g-3 mb-4">
        <div className="col-12 col-lg-8">
          <div className="hg-card">
            <div className="hg-card-header">
              <div className="d-flex align-items-center gap-2">
                <TrendingUp size={18} className="text-primary" />
                <span className="fw-bold" style={{ fontSize: '14px' }}>7-Day Attendance Trend</span>
              </div>
              <span className="badge bg-light text-dark">Live Database Records</span>
            </div>
            <div className="hg-card-body">
              <AttendanceTrendChart trendData={data?.charts?.weeklyTrend} />
            </div>
          </div>
        </div>

        <div className="col-12 col-lg-4">
          <div className="hg-card">
            <div className="hg-card-header">
              <span className="fw-bold" style={{ fontSize: '14px' }}>Today's Check-In Status</span>
              <span className="badge badge-soft-primary">Today</span>
            </div>
            <div className="hg-card-body">
              <StatusDistributionChart distribution={data?.charts?.statusDistribution} />
            </div>
          </div>
        </div>
      </div>

      {/* Block Distribution & Recent Activity Row */}
      <div className="row g-3">
        <div className="col-12 col-lg-5">
          <div className="hg-card">
            <div className="hg-card-header">
              <div className="d-flex align-items-center gap-2">
                <MapPin size={18} className="text-primary" />
                <span className="fw-bold" style={{ fontSize: '14px' }}>Attendance by Hostel Block</span>
              </div>
              <span className="badge badge-soft-success">Radius: {s.geofenceRadius || 20}m</span>
            </div>
            <div className="hg-card-body">
              <BlockDistributionChart blockData={data?.charts?.blockDistribution} />
            </div>
          </div>
        </div>

        <div className="col-12 col-lg-7">
          <div className="hg-card">
            <div className="hg-card-header">
              <div className="d-flex align-items-center gap-2">
                <FileCheck size={18} className="text-success" />
                <span className="fw-bold" style={{ fontSize: '14px' }}>Recent Verified Attendances</span>
              </div>
              <button
                className="btn btn-sm btn-link text-decoration-none p-0"
                onClick={() => onNavigate && onNavigate('admin_attendance')}
                style={{ fontSize: '12px' }}
              >
                View Full Logs &rarr;
              </button>
            </div>
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Roll Number</th>
                    <th>Student Name</th>
                    <th>Time Marked</th>
                    <th>Status</th>
                    <th>Distance</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.recentActivity && data.recentActivity.length > 0 ? (
                    data.recentActivity.slice(0, 5).map((act, idx) => (
                      <tr key={idx}>
                        <td className="font-mono fw-semibold text-primary">{act.roll_number}</td>
                        <td className="fw-medium">{act.full_name}</td>
                        <td className="font-mono text-muted" style={{ fontSize: '12px' }}>{act.time_marked}</td>
                        <td>
                          <span className={act.status === 'PRESENT' ? 'badge-soft-success' : 'badge-soft-warning'}>
                            {act.status}
                          </span>
                        </td>
                        <td className="font-mono text-muted" style={{ fontSize: '12px' }}>
                          {act.verified_distance !== null ? `${act.verified_distance}m` : 'N/A'}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="5" className="text-center py-3 text-muted" style={{ fontSize: '13px' }}>
                        No check-ins recorded yet today.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Today's Attendance Roster Modal (Present & Absent View) */}
      {rosterModalOpen && (
        <div
          className="modal show d-block"
          tabIndex="-1"
          style={{ background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(4px)', zIndex: 1060 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setRosterModalOpen(false);
          }}
        >
          <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content border-0 shadow-lg" style={{ borderRadius: '16px', overflow: 'hidden' }}>
              {/* Modal Header */}
              <div className="modal-header border-bottom bg-light px-4 py-3 d-flex align-items-center justify-content-between">
                <div>
                  <div className="d-flex align-items-center gap-2">
                    <div
                      className={`p-2 rounded-circle ${rosterTab === 'PRESENT' ? 'bg-success bg-opacity-10 text-success' : 'bg-warning bg-opacity-10 text-warning'}`}
                    >
                      {rosterTab === 'PRESENT' ? <CheckCircle2 size={22} /> : <Clock size={22} />}
                    </div>
                    <div>
                      <h5 className="modal-title fw-bold text-dark mb-0" style={{ fontSize: '18px' }}>
                        {rosterTab === 'PRESENT' ? "Today's Present Residents" : "Today's Absent & Unmarked Residents"}
                      </h5>
                      <span className="text-muted small">
                        {todayFormatted} &bull; Authoritative Real-Time Hostel Records
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close"
                  onClick={() => setRosterModalOpen(false)}
                />
              </div>

              {/* Modal Subheader with Segmented Tabs and Search */}
              <div className="modal-body px-4 py-3">
                {/* Segmented Control / Tab Switcher */}
                <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-3 pb-3 border-bottom">
                  <div className="btn-group p-1 bg-light rounded-3 border" role="group">
                    <button
                      type="button"
                      className={`btn btn-sm px-3 py-1.5 fw-semibold d-flex align-items-center gap-2 rounded-2 ${rosterTab === 'PRESENT' ? 'btn-success shadow-sm text-white' : 'btn-light text-muted'}`}
                      onClick={() => setRosterTab('PRESENT')}
                    >
                      <CheckCircle2 size={16} />
                      <span>Present Today</span>
                      <span className={`badge ms-1 ${rosterTab === 'PRESENT' ? 'bg-white text-success' : 'bg-secondary bg-opacity-25 text-dark'}`}>
                        {presentStudents.length}
                      </span>
                    </button>

                    <button
                      type="button"
                      className={`btn btn-sm px-3 py-1.5 fw-semibold d-flex align-items-center gap-2 rounded-2 ${rosterTab === 'ABSENT' ? 'btn-warning shadow-sm text-dark' : 'btn-light text-muted'}`}
                      onClick={() => setRosterTab('ABSENT')}
                    >
                      <Clock size={16} />
                      <span>Absent / Unmarked</span>
                      <span className={`badge ms-1 ${rosterTab === 'ABSENT' ? 'bg-dark text-white' : 'bg-secondary bg-opacity-25 text-dark'}`}>
                        {absentStudents.length}
                      </span>
                    </button>
                  </div>

                  <div className="d-flex align-items-center gap-2 flex-grow-1 flex-sm-grow-0">
                    {/* Search Bar */}
                    <div className="input-group input-group-sm" style={{ minWidth: '220px', maxWidth: '320px' }}>
                      <span className="input-group-text bg-white border-end-0">
                        <Search size={14} className="text-muted" />
                      </span>
                      <input
                        type="text"
                        className="form-control border-start-0 ps-0"
                        placeholder="Search name, roll no, room..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                      {searchQuery && (
                        <button
                          className="btn btn-outline-secondary border-start-0"
                          type="button"
                          onClick={() => setSearchQuery('')}
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>

                    {/* Block Filter */}
                    {availableBlocks.length > 0 && (
                      <select
                        className="form-select form-select-sm"
                        style={{ width: 'auto' }}
                        value={blockFilter}
                        onChange={(e) => setBlockFilter(e.target.value)}
                      >
                        <option value="">All Blocks</option>
                        {availableBlocks.map((blk) => (
                          <option key={blk} value={blk}>{blk}</option>
                        ))}
                      </select>
                    )}

                    {/* Export CSV Button */}
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1.5"
                      onClick={handleExportRosterCsv}
                      title="Download CSV"
                    >
                      <Download size={14} />
                      <span className="d-none d-md-inline">Export</span>
                    </button>
                  </div>
                </div>

                {/* Table Container */}
                <div className="table-responsive border rounded-3" style={{ maxHeight: '420px', minHeight: '200px' }}>
                  <table className="table table-hover align-middle mb-0" style={{ fontSize: '13px' }}>
                    <thead className="table-light sticky-top" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {rosterTab === 'PRESENT' ? (
                        <tr>
                          <th className="ps-3 py-2.5">Roll Number</th>
                          <th className="py-2.5">Student Name</th>
                          <th className="py-2.5">Room & Block</th>
                          <th className="py-2.5">Check-In Time</th>
                          <th className="py-2.5">Verification</th>
                          <th className="py-2.5">Distance</th>
                          <th className="text-end pe-3 py-2.5">Status</th>
                        </tr>
                      ) : (
                        <tr>
                          <th className="ps-3 py-2.5">Roll Number</th>
                          <th className="py-2.5">Student Name</th>
                          <th className="py-2.5">Room & Block</th>
                          <th className="py-2.5">Student Contact</th>
                          <th className="py-2.5">Course / Year</th>
                          <th className="text-end pe-3 py-2.5">Status</th>
                        </tr>
                      )}
                    </thead>
                    <tbody>
                      {filteredList.length === 0 ? (
                        <tr>
                          <td colSpan={rosterTab === 'PRESENT' ? 7 : 6} className="text-center py-5 text-muted">
                            {searchQuery || blockFilter ? (
                              <div>
                                <Search size={32} className="opacity-25 mb-2" />
                                <div className="fw-semibold">No students match your search criteria.</div>
                                <div className="small mt-1">Try clearing your search query or block filter.</div>
                              </div>
                            ) : rosterTab === 'PRESENT' ? (
                              <div>
                                <Clock size={36} className="opacity-25 mb-2 text-warning" />
                                <div className="fw-semibold">No check-ins recorded yet today.</div>
                                <div className="small mt-1">Attendance window opens during scheduled hours.</div>
                              </div>
                            ) : (
                              <div>
                                <CheckCircle2 size={36} className="text-success opacity-50 mb-2" />
                                <div className="fw-semibold text-success">100% Attendance Achieved!</div>
                                <div className="small mt-1">All registered hostel residents are marked present today.</div>
                              </div>
                            )}
                          </td>
                        </tr>
                      ) : (
                        filteredList.map((st, idx) => (
                          <tr key={st.attendance_id || st.student_id || st.roll_number || idx}>
                            <td className="ps-3 fw-bold font-monospace text-primary">
                              {st.roll_number}
                            </td>
                            <td>
                              <div className="fw-semibold text-dark">{st.full_name}</div>
                              {st.email && <div className="text-muted small" style={{ fontSize: '11px' }}>{st.email}</div>}
                            </td>
                            <td>
                              <span className="badge bg-light text-dark border me-1">
                                {st.hostel_block || 'Block A'}
                              </span>
                              <span className="text-muted small">Rm {st.room_number || 'N/A'}</span>
                            </td>

                            {rosterTab === 'PRESENT' ? (
                              <>
                                <td>
                                  <span className="badge bg-light text-dark border font-monospace d-inline-flex align-items-center gap-1">
                                    <Clock size={11} className="text-muted" />
                                    {st.time_marked_12 || st.time_marked || 'Recorded'}
                                  </span>
                                </td>
                                <td>
                                  <small className="text-muted">
                                    {st.is_override ? 'Admin Override' : (st.verification_method || 'Facial Match')}
                                  </small>
                                </td>
                                <td>
                                  {st.verified_distance !== null && st.verified_distance !== undefined ? (
                                    <span className={`badge ${Number(st.verified_distance) <= 20 ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'}`}>
                                      {Number(st.verified_distance).toFixed(1)}m
                                    </span>
                                  ) : (
                                    <span className="text-muted small">&mdash;</span>
                                  )}
                                </td>
                                <td className="text-end pe-3">
                                  <span className={`badge ${st.status === 'PRESENT' ? 'bg-success' : st.status === 'LATE' ? 'bg-warning text-dark' : 'bg-primary'}`}>
                                    {st.status || 'PRESENT'}
                                  </span>
                                </td>
                              </>
                            ) : (
                              <>
                                <td>
                                  {st.phone ? (
                                    <a
                                      href={`tel:${st.phone}`}
                                      className="text-decoration-none fw-semibold small text-primary d-inline-flex align-items-center gap-1"
                                    >
                                      <Phone size={12} />
                                      {st.phone}
                                    </a>
                                  ) : (
                                    <span className="text-muted small">No phone on file</span>
                                  )}
                                </td>
                                <td>
                                  <small className="text-muted">{st.course || 'Undergraduate'}</small>
                                </td>
                                <td className="text-end pe-3">
                                  <span className="badge bg-warning-subtle text-warning border border-warning-subtle">
                                    Pending Check-in
                                  </span>
                                </td>
                              </>
                            )}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="modal-footer border-top bg-light px-4 py-2.5 d-flex align-items-center justify-content-between">
                <div className="text-muted small">
                  Showing <strong>{filteredList.length}</strong> of <strong>{activeList.length}</strong> {rosterTab === 'PRESENT' ? 'present' : 'absent'} residents
                </div>
                <div className="d-flex align-items-center gap-2">
                  {onNavigate && (
                    <button
                      type="button"
                      className="btn btn-outline-primary btn-sm d-flex align-items-center gap-1"
                      onClick={() => {
                        setRosterModalOpen(false);
                        onNavigate('admin_attendance');
                      }}
                    >
                      <span>Open in Attendance Records</span>
                      <ArrowRight size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setRosterModalOpen(false)}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
