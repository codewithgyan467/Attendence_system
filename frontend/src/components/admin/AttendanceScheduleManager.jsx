import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../utils/api';
import {
  Clock,
  Calendar,
  CalendarCheck,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Upload,
  Plus,
  RefreshCw,
  Sparkles,
  Info,
  ShieldAlert,
  Sliders,
  FileSpreadsheet,
  PartyPopper,
  Save,
  Check
} from 'lucide-react';

// Format Date object to 12-hour clock format (e.g. "7:15:30 PM")
const formatClock12h = (date) => {
  if (!date) return '';
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const mm = minutes < 10 ? `0${minutes}` : `${minutes}`;
  const ss = seconds < 10 ? `0${seconds}` : `${seconds}`;
  return `${hours}:${mm}:${ss} ${ampm}`;
};

// Format "HH:mm" time string to 12-hour format (e.g. "19:00" -> "7:00 PM")
const formatTime12h = (timeStr) => {
  if (!timeStr) return '';
  const parts = String(timeStr).split(':');
  let h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] || '0', 10);
  if (isNaN(h)) return timeStr;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  h = h ? h : 12;
  const mm = m < 10 ? `0${m}` : `${m}`;
  return `${h}:${mm} ${ampm}`;
};

export default function AttendanceScheduleManager() {
  const [loading, setLoading] = useState(true);
  const [scheduleData, setScheduleData] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

  // Default Schedule Form State
  const [defaultStartTime, setDefaultStartTime] = useState('19:00');
  const [defaultEndTime, setDefaultEndTime] = useState('19:30');
  const [isEnabled, setIsEnabled] = useState(true);
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [savingDefault, setSavingDefault] = useState(false);

  // New Override Form State
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideDate, setOverrideDate] = useState(new Date().toISOString().split('T')[0]);
  const [overrideTitle, setOverrideTitle] = useState('');
  const [overrideStartTime, setOverrideStartTime] = useState('20:00');
  const [overrideEndTime, setOverrideEndTime] = useState('21:00');
  const [isHoliday, setIsHoliday] = useState(false);
  const [overrideNotes, setOverrideNotes] = useState('');
  const [submittingOverride, setSubmittingOverride] = useState(false);

  // Holiday Uploader State
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Live Clock
  const [currentLocalTime, setCurrentLocalTime] = useState(new Date());

  useEffect(() => {
    fetchSchedule();
    const timer = setInterval(() => {
      setCurrentLocalTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchSchedule = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.admin.getAttendanceSchedule();
      setScheduleData(data);
      if (data.config) {
        setDefaultStartTime(data.config.default_start_time || '19:00');
        setDefaultEndTime(data.config.default_end_time || '19:30');
        setIsEnabled(data.config.is_enabled === 1);
        setTimezone(data.config.timezone || 'Asia/Kolkata');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to retrieve attendance schedule settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDefaultSchedule = async (e) => {
    e.preventDefault();
    if (!defaultStartTime || !defaultEndTime) {
      setErrorMsg('Both start time and end time are required.');
      return;
    }
    setSavingDefault(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.admin.updateAttendanceSchedule({
        default_start_time: defaultStartTime,
        default_end_time: defaultEndTime,
        is_enabled: isEnabled,
        timezone
      });
      setStatusMsg(res.message || 'Default attendance window updated successfully.');
      fetchSchedule();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to update schedule settings');
    } finally {
      setSavingDefault(false);
    }
  };

  const handleCreateOverride = async (e) => {
    e.preventDefault();
    if (!overrideDate || !overrideTitle.trim()) {
      setErrorMsg('Override date and title are required.');
      return;
    }
    setSubmittingOverride(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.admin.saveScheduleOverride({
        override_date: overrideDate,
        title: overrideTitle.trim(),
        start_time: isHoliday ? null : overrideStartTime,
        end_time: isHoliday ? null : overrideEndTime,
        is_holiday: isHoliday ? 1 : 0,
        notes: overrideNotes.trim()
      });
      setStatusMsg(res.message || 'Schedule override saved successfully.');
      setShowOverrideModal(false);
      setOverrideTitle('');
      setOverrideNotes('');
      fetchSchedule();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to save schedule override');
    } finally {
      setSubmittingOverride(false);
    }
  };

  const handleDeleteOverride = async (id, title, date) => {
    if (!window.confirm(`Are you sure you want to delete the schedule override for "${title}" (${date})?`)) {
      return;
    }
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.admin.deleteScheduleOverride(id);
      setStatusMsg(res.message || 'Schedule override removed.');
      fetchSchedule();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to delete schedule override');
    }
  };

  const handleUploadHolidays = async (e) => {
    e.preventDefault();
    if (!uploadFile) {
      setErrorMsg('Please select a CSV or Excel file containing the holiday/event schedule.');
      return;
    }
    setUploading(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      const res = await api.admin.uploadHolidayList(formData);
      setStatusMsg(res.message || `Successfully imported ${res.count || 0} holiday/event schedules.`);
      setShowUploadModal(false);
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      fetchSchedule();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to upload holiday schedule');
    } finally {
      setUploading(false);
    }
  };

  const downloadSampleTemplate = () => {
    const csvContent =
      'Date,Title,Start Time,End Time,Is Holiday,Notes\n' +
      '2026-10-24,Diwali Cultural Festival Extension,20:00,21:30,false,Attendance window delayed by 1 hour for Diwali cultural celebration\n' +
      '2026-11-05,Campus Annual Feast,20:30,22:00,false,Extended hours for hostel annual feast\n' +
      '2026-12-25,Christmas University Holiday,,,true,Official holiday - Attendance exempt\n' +
      '2027-01-26,Republic Day Holiday,,,true,Campus celebration holiday\n';

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'hostel_holiday_schedule_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const live = scheduleData?.liveStatus;

  return (
    <div className="container-fluid px-0">
      {/* Header */}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-2">
        <div>
          <h4 className="fw-bold mb-1 d-flex align-items-center gap-2">
            <Clock className="text-primary" size={26} />
            Attendance Timing & Holiday Management
          </h4>
          <p className="text-muted small mb-0">
            Configure real-world daily attendance hours (default 7:00 PM – 7:30 PM), schedule event delays/extensions, and upload campus holidays.
          </p>
        </div>
        <div className="d-flex gap-2">
          <button
            className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
            onClick={fetchSchedule}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button
            className="btn btn-outline-primary btn-sm d-flex align-items-center gap-1"
            onClick={() => setShowUploadModal(true)}
          >
            <Upload size={14} /> Upload Holiday List
          </button>
          <button
            className="btn btn-primary btn-sm d-flex align-items-center gap-1"
            onClick={() => setShowOverrideModal(true)}
          >
            <Plus size={14} /> Add Event / Delay
          </button>
        </div>
      </div>

      {/* Notifications */}
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
        <div className="alert alert-danger d-flex align-items-center justify-content-between py-2 px-3 mb-3">
          <div className="d-flex align-items-center gap-2">
            <AlertTriangle size={16} />
            <span className="small">{errorMsg}</span>
          </div>
          <button type="button" className="btn-close btn-close-sm" onClick={() => setErrorMsg(null)} />
        </div>
      )}

      {/* Live Real-World Time Status Banner */}
      <div className="card shadow-sm border-0 mb-4 overflow-hidden" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', color: '#fff' }}>
        <div className="card-body p-4">
          <div className="row align-items-center g-3">
            <div className="col-lg-8">
              <div className="d-flex align-items-center gap-2 mb-2">
                <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1" style={{ fontSize: '11px', letterSpacing: '0.5px' }}>
                  REAL-WORLD ATTENDANCE WINDOW
                </span>
                {live?.enforced ? (
                  live?.isOpen ? (
                    <span className="badge bg-success text-white d-flex align-items-center gap-1.5 px-2.5 py-1">
                      <span className="spinner-grow spinner-grow-sm" style={{ width: '8px', height: '8px' }} />
                      WINDOW ACTIVE (OPEN)
                    </span>
                  ) : live?.isHoliday ? (
                    <span className="badge bg-info text-white d-flex align-items-center gap-1 px-2.5 py-1">
                      <PartyPopper size={12} /> HOLIDAY EXEMPT
                    </span>
                  ) : (
                    <span className="badge bg-secondary text-white px-2.5 py-1">
                      WINDOW CLOSED
                    </span>
                  )
                ) : (
                  <span className="badge bg-warning text-dark px-2.5 py-1">
                    ENFORCEMENT DISABLED (OPEN 24/7)
                  </span>
                )}
              </div>

              <h3 className="fw-bold mb-1 text-white">
                {live?.isHoliday ? (
                  <span className="text-info">{live?.title || 'Campus Holiday'} (Attendance Suspended)</span>
                ) : live?.isOpen ? (
                  <span className="text-success">Active Check-In: {live?.startTime12} – {live?.endTime12}</span>
                ) : (
                  <span>Scheduled Hours: {live?.startTime12 || '7:00 PM'} – {live?.endTime12 || '7:30 PM'}</span>
                )}
              </h3>

              <p className="text-light text-opacity-75 mb-0" style={{ fontSize: '13.5px' }}>
                {live?.message || 'Hostel attendance is restricted to the scheduled time window.'}
              </p>
            </div>

            <div className="col-lg-4 text-lg-end">
              <div className="p-3 rounded-3" style={{ background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
                <div className="text-muted small text-uppercase fw-semibold d-flex align-items-center justify-content-lg-end gap-1" style={{ fontSize: '11px' }}>
                  <Clock size={12} className="text-primary" />
                  Live System Clock
                </div>
                <div className="h4 fw-bold font-monospace text-white mb-0 mt-1">
                  {formatClock12h(currentLocalTime)}
                </div>
                <div className="small text-light text-opacity-75 mt-1">
                  {currentLocalTime.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="row g-4 mb-4">
        {/* Left Column: Default Schedule Settings */}
        <div className="col-lg-5">
          <div className="card shadow-sm border-0 h-100">
            <div className="card-header bg-white py-3 border-bottom">
              <h6 className="fw-bold mb-0 d-flex align-items-center gap-2">
                <Sliders size={18} className="text-primary" />
                Default Daily Attendance Hours
              </h6>
            </div>
            <div className="card-body p-4">
              <form onSubmit={handleSaveDefaultSchedule}>
                <div className="mb-3">
                  <div className="form-check form-switch p-0 d-flex align-items-center justify-content-between mb-2">
                    <label className="form-check-label fw-semibold" htmlFor="enforceSwitch">
                      Enforce Time Management
                    </label>
                    <input
                      className="form-check-input ms-0"
                      type="checkbox"
                      id="enforceSwitch"
                      checked={isEnabled}
                      onChange={(e) => setIsEnabled(e.target.checked)}
                      style={{ width: '40px', height: '20px' }}
                    />
                  </div>
                  <div className="text-muted" style={{ fontSize: '12px' }}>
                    When enabled, students can <strong>only</strong> submit GPS and biometric check-ins during the authorized window. Outside hours, check-ins are blocked.
                  </div>
                </div>

                <hr className="my-3 text-muted" />

                <div className="row g-3 mb-4">
                  <div className="col-6">
                    <label className="form-label fw-semibold small d-flex justify-content-between align-items-center">
                      <span>Start Time</span>
                      <span className="badge bg-primary-subtle text-primary">{formatTime12h(defaultStartTime)}</span>
                    </label>
                    <input
                      type="time"
                      className="form-control"
                      value={defaultStartTime}
                      onChange={(e) => setDefaultStartTime(e.target.value)}
                      required
                    />
                    <div className="text-muted small mt-1" style={{ fontSize: '11px' }}>
                      Default: 7:00 PM
                    </div>
                  </div>

                  <div className="col-6">
                    <label className="form-label fw-semibold small d-flex justify-content-between align-items-center">
                      <span>End Time</span>
                      <span className="badge bg-primary-subtle text-primary">{formatTime12h(defaultEndTime)}</span>
                    </label>
                    <input
                      type="time"
                      className="form-control"
                      value={defaultEndTime}
                      onChange={(e) => setDefaultEndTime(e.target.value)}
                      required
                    />
                    <div className="text-muted small mt-1" style={{ fontSize: '11px' }}>
                      Default: 7:30 PM
                    </div>
                  </div>
                </div>

                <div className="p-3 rounded-2 bg-light border mb-4" style={{ fontSize: '12px' }}>
                  <div className="fw-semibold text-dark mb-1 d-flex align-items-center gap-1.5">
                    <Info size={14} className="text-primary" />
                    How It Works
                  </div>
                  <div className="text-muted">
                    Students will receive an active check-in prompt during this 30-minute window. If an event or holiday falls on a specific date, you can extend the time below without changing this standard default.
                  </div>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary w-100 d-flex align-items-center justify-content-center gap-2"
                  disabled={savingDefault}
                >
                  <Save size={16} />
                  {savingDefault ? 'Saving Schedule...' : 'Save Default Hours'}
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* Right Column: Special Day Overrides & Events */}
        <div className="col-lg-7">
          <div className="card shadow-sm border-0 h-100">
            <div className="card-header bg-white py-3 border-bottom d-flex align-items-center justify-content-between">
              <div>
                <h6 className="fw-bold mb-0 d-flex align-items-center gap-2">
                  <PartyPopper size={18} className="text-warning" />
                  Scheduled Events, Feasts & Holidays
                </h6>
              </div>
              <span className="badge bg-light text-dark border">
                {scheduleData?.overrides?.length || 0} Special Dates
              </span>
            </div>

            <div className="card-body p-0">
              {loading ? (
                <div className="text-center py-5 text-muted">
                  <div className="spinner-border spinner-border-sm text-primary mb-2" />
                  <div className="small">Loading schedules and overrides...</div>
                </div>
              ) : !scheduleData?.overrides || scheduleData.overrides.length === 0 ? (
                <div className="text-center py-5 px-4 text-muted">
                  <Calendar size={36} className="text-muted opacity-50 mb-2" />
                  <div className="fw-semibold">No Specific Day Overrides Configured</div>
                  <div className="small text-muted mt-1" style={{ maxWidth: '420px', margin: '0 auto' }}>
                    All days currently use the standard default window (7:00 PM to 7:30 PM). Use the buttons above to delay attendance for a feast, cultural event, or mark an exempt holiday.
                  </div>
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0" style={{ fontSize: '13px' }}>
                    <thead className="table-light text-muted text-uppercase" style={{ fontSize: '11px' }}>
                      <tr>
                        <th>Date</th>
                        <th>Event / Reason</th>
                        <th>Attendance Hours</th>
                        <th>Type</th>
                        <th className="text-end">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scheduleData.overrides.map((ov) => (
                        <tr key={ov.id}>
                          <td className="fw-bold font-monospace text-dark">
                            {ov.override_date}
                          </td>
                          <td>
                            <div className="fw-semibold text-dark">{ov.title}</div>
                            {ov.notes && <div className="text-muted small" style={{ fontSize: '11px' }}>{ov.notes}</div>}
                          </td>
                          <td>
                            {ov.is_holiday === 1 ? (
                              <span className="badge bg-info-subtle text-info border border-info-subtle">
                                Attendance Suspended
                              </span>
                            ) : (
                              <span className="badge bg-success-subtle text-success border border-success-subtle font-monospace">
                                {(ov.startTime12 || formatTime12h(ov.start_time))} – {(ov.endTime12 || formatTime12h(ov.end_time))}
                              </span>
                            )}
                          </td>
                          <td>
                            {ov.is_holiday === 1 ? (
                              <span className="badge bg-secondary-subtle text-secondary">Holiday</span>
                            ) : (
                              <span className="badge bg-warning-subtle text-warning">Extended / Delayed</span>
                            )}
                          </td>
                          <td className="text-end">
                            <button
                              className="btn btn-outline-danger btn-sm p-1.5"
                              title="Delete override"
                              onClick={() => handleDeleteOverride(ov.id, ov.title, ov.override_date)}
                            >
                              <Trash2 size={14} />
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
        </div>
      </div>

      {/* Modal: Add Special Day Override / Event Extension */}
      {showOverrideModal && (
        <div className="modal show d-block" tabIndex="-1" style={{ background: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 shadow">
              <div className="modal-header border-bottom">
                <h5 className="modal-title fw-bold d-flex align-items-center gap-2" style={{ fontSize: '16px' }}>
                  <PartyPopper size={18} className="text-primary" />
                  Add Event Delay / Holiday Override
                </h5>
                <button type="button" className="btn-close" onClick={() => setShowOverrideModal(false)} />
              </div>
              <form onSubmit={handleCreateOverride}>
                <div className="modal-body p-4">
                  <div className="mb-3">
                    <label className="form-label fw-semibold small">Event / Feast Date</label>
                    <input
                      type="date"
                      className="form-control"
                      value={overrideDate}
                      onChange={(e) => setOverrideDate(e.target.value)}
                      required
                    />
                  </div>

                  <div className="mb-3">
                    <label className="form-label fw-semibold small">Event Name / Occasion</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="e.g. Diwali Cultural Night / Annual Sports Feast"
                      value={overrideTitle}
                      onChange={(e) => setOverrideTitle(e.target.value)}
                      required
                    />
                  </div>

                  <div className="mb-3">
                    <div className="form-check form-switch p-0 d-flex align-items-center justify-content-between">
                      <label className="form-check-label fw-semibold small" htmlFor="holidaySwitch">
                        Is Full Day Holiday (Exempt Attendance)?
                      </label>
                      <input
                        className="form-check-input ms-0"
                        type="checkbox"
                        id="holidaySwitch"
                        checked={isHoliday}
                        onChange={(e) => setIsHoliday(e.target.checked)}
                      />
                    </div>
                  </div>

                  {!isHoliday && (
                    <div className="row g-2 mb-3 p-3 bg-light rounded border">
                      <div className="col-6">
                        <label className="form-label fw-semibold small d-flex justify-content-between align-items-center">
                          <span>Extended Start Time</span>
                          <span className="badge bg-primary-subtle text-primary">{formatTime12h(overrideStartTime)}</span>
                        </label>
                        <input
                          type="time"
                          className="form-control"
                          value={overrideStartTime}
                          onChange={(e) => setOverrideStartTime(e.target.value)}
                          required={!isHoliday}
                        />
                      </div>
                      <div className="col-6">
                        <label className="form-label fw-semibold small d-flex justify-content-between align-items-center">
                          <span>Extended End Time</span>
                          <span className="badge bg-primary-subtle text-primary">{formatTime12h(overrideEndTime)}</span>
                        </label>
                        <input
                          type="time"
                          className="form-control"
                          value={overrideEndTime}
                          onChange={(e) => setOverrideEndTime(e.target.value)}
                          required={!isHoliday}
                        />
                      </div>
                      <div className="text-muted small mt-1" style={{ fontSize: '11px' }}>
                        Attendance will only be accepted during these delayed hours ({formatTime12h(overrideStartTime)} to {formatTime12h(overrideEndTime)}) on this specific date.
                      </div>
                    </div>
                  )}

                  <div className="mb-2">
                    <label className="form-label fw-semibold small">Notes / Instructions for Students</label>
                    <textarea
                      className="form-control"
                      rows="2"
                      placeholder="e.g. Delayed due to campus cultural events. Please be in rooms by 8:30 PM."
                      value={overrideNotes}
                      onChange={(e) => setOverrideNotes(e.target.value)}
                    />
                  </div>
                </div>

                <div className="modal-footer border-top bg-light py-2">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowOverrideModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary btn-sm d-flex align-items-center gap-1.5" disabled={submittingOverride}>
                    <Check size={16} />
                    {submittingOverride ? 'Saving Override...' : 'Save Schedule Override'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Bulk Holiday List Uploader */}
      {showUploadModal && (
        <div className="modal show d-block" tabIndex="-1" style={{ background: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 shadow">
              <div className="modal-header border-bottom">
                <h5 className="modal-title fw-bold d-flex align-items-center gap-2" style={{ fontSize: '16px' }}>
                  <FileSpreadsheet size={18} className="text-primary" />
                  Upload Holiday & Event Calendar (CSV / Excel)
                </h5>
                <button type="button" className="btn-close" onClick={() => setShowUploadModal(false)} />
              </div>
              <form onSubmit={handleUploadHolidays}>
                <div className="modal-body p-4">
                  <p className="text-muted small mb-3">
                    Upload your institution's annual holiday calendar or cultural feast dates. Rows with custom start/end times will automatically extend attendance, while rows marked as holidays will exempt check-ins.
                  </p>

                  <div className="mb-3">
                    <label className="form-label fw-semibold small">Select CSV or Excel File</label>
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="form-control"
                      accept=".csv, .xlsx, .xls, .json"
                      onChange={(e) => setUploadFile(e.target.files[0] || null)}
                      required
                    />
                  </div>

                  <div className="p-3 bg-light rounded border mb-3" style={{ fontSize: '12px' }}>
                    <div className="fw-semibold text-dark mb-1">Expected Columns:</div>
                    <div className="text-muted font-monospace small">
                      Date (YYYY-MM-DD), Title, Start Time, End Time, Is Holiday, Notes
                    </div>
                  </div>

                  <div className="text-end">
                    <button
                      type="button"
                      className="btn btn-link btn-sm text-decoration-none p-0"
                      onClick={downloadSampleTemplate}
                    >
                      Download Sample Template (.CSV)
                    </button>
                  </div>
                </div>

                <div className="modal-footer border-top bg-light py-2">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowUploadModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary btn-sm d-flex align-items-center gap-1.5" disabled={uploading}>
                    <Upload size={16} />
                    {uploading ? 'Processing & Importing...' : 'Upload & Commit Schedule'}
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
