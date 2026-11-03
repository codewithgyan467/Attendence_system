import React, { useState, useEffect } from 'react';
import { api } from '../../utils/api';
import KpiCard from '../common/KpiCard';
import {
  Building,
  Users,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  FileCheck2,
  LifeBuoy,
  RefreshCw,
  Search,
  MessageSquare,
  ShieldAlert,
  Phone,
  BedDouble,
  Calendar
} from 'lucide-react';

export default function WardenDashboard({ subTab = 'warden_overview', onSelectTab }) {
  const [overview, setOverview] = useState(null);
  const [exceptions, setExceptions] = useState(null);
  const [corrections, setCorrections] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

  // Review modal state
  const [reviewModal, setReviewModal] = useState({ open: false, req: null, decision: 'APPROVED', note: '' });
  const [submittingReview, setSubmittingReview] = useState(false);

  // Ticket response modal state
  const [ticketModal, setTicketModal] = useState({ open: false, ticket: null, status: 'RESOLVED', note: '' });
  const [submittingTicket, setSubmittingTicket] = useState(false);

  // Emergency Muster & In-Person Physical Check-in States
  const [showMusterModal, setShowMusterModal] = useState(false);
  const [musterData, setMusterData] = useState(null);
  const [musterLoading, setMusterLoading] = useState(false);
  const [musterTab, setMusterTab] = useState('missing');

  const [showPhysicalQueueModal, setShowPhysicalQueueModal] = useState(false);
  const [pendingPhysicalList, setPendingPhysicalList] = useState([]);
  const [verifyingPhysicalId, setVerifyingPhysicalId] = useState(null);

  useEffect(() => {
    loadAllData();
  }, []);

  const loadMusterData = async () => {
    setMusterLoading(true);
    try {
      const res = await api.warden.getEmergencyMuster();
      if (res?.success) setMusterData(res);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to load emergency muster roll');
    } finally {
      setMusterLoading(false);
    }
  };

  const loadPendingPhysical = async () => {
    try {
      const res = await api.warden.getPendingPhysicalVerifications();
      if (res?.success) setPendingPhysicalList(res.pending || []);
    } catch (_) {}
  };

  const handleConfirmPhysicalAttendance = async (item) => {
    try {
      setVerifyingPhysicalId(item.id);
      const res = await api.warden.verifyPhysicalAttendance({
        student_id: item.student_id,
        roll_number: item.roll_number,
        notes: 'In-person verification approved by warden during night roll-call rounds.'
      });
      setVerifyingPhysicalId(null);
      if (res?.success) {
        setStatusMsg(res.message);
        loadPendingPhysical();
        loadAllData();
      } else {
        setErrorMsg(res.error || 'Failed to confirm attendance.');
      }
    } catch (err) {
      setVerifyingPhysicalId(null);
      setErrorMsg(err.message || 'Error confirming attendance.');
    }
  };

  const loadAllData = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [ovRes, exRes, corrRes, feedRes] = await Promise.allSettled([
        api.warden.getOverview(),
        api.warden.getExceptions(),
        api.warden.getCorrections(),
        api.warden.getFeedback()
      ]);

      if (ovRes.status === 'fulfilled' && ovRes.value.success) setOverview(ovRes.value);
      if (exRes.status === 'fulfilled' && exRes.value.success) setExceptions(exRes.value);
      if (corrRes.status === 'fulfilled' && corrRes.value.success) setCorrections(corrRes.value.requests || corrRes.value.corrections || []);
      if (feedRes.status === 'fulfilled' && feedRes.value.success) setTickets(feedRes.value.tickets || feedRes.value.feedback || []);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to load warden dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const handleReviewCorrection = async (e) => {
    e.preventDefault();
    if (!reviewModal.note.trim()) {
      setErrorMsg('Review note is mandatory.');
      return;
    }
    setSubmittingReview(true);
    setErrorMsg(null);
    try {
      const res = await api.warden.reviewCorrection(reviewModal.req.id, {
        decision: reviewModal.decision,
        resolution_note: reviewModal.note
      });
      setStatusMsg(res.message || 'Correction updated.');
      setReviewModal({ open: false, req: null, decision: 'APPROVED', note: '' });
      const corrRes = await api.warden.getCorrections();
      if (corrRes?.success) setCorrections(corrRes.requests || corrRes.corrections || []);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to update correction');
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleRespondFeedback = async (e) => {
    e.preventDefault();
    if (!ticketModal.note.trim()) {
      setErrorMsg('Resolution note is required.');
      return;
    }
    setSubmittingTicket(true);
    setErrorMsg(null);
    try {
      const res = await api.warden.respondFeedback(ticketModal.ticket.id, {
        status: ticketModal.status,
        resolution_note: ticketModal.note
      });
      setStatusMsg(res.message || 'Ticket updated.');
      setTicketModal({ open: false, ticket: null, status: 'RESOLVED', note: '' });
      const feedRes = await api.warden.getFeedback();
      if (feedRes?.success) setTickets(feedRes.tickets || feedRes.feedback || []);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to update ticket');
    } finally {
      setSubmittingTicket(false);
    }
  };

  const s = overview?.summary || {};
  const blocks = overview?.blocks || [];

  return (
    <div className="container-fluid px-0">
      {/* Header */}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-2">
        <div>
          <h4 className="fw-bold mb-1 d-flex align-items-center gap-2">
            <Building className="text-primary" size={24} />
            Warden Operations Panel
          </h4>
          <p className="text-muted small mb-0">
            Hostel block supervision, daily roll call exceptions, absence verifications, and resident appeals.
          </p>
        </div>
        <button
          className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
          onClick={loadAllData}
          disabled={loading}
        >
          <RefreshCw size={14} /> Refresh Data
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

      {/* KPI Cards (3-Tier & Safety Defaulter Metrics) */}
      <div className="row g-3 mb-4">
        <div className="col-12 col-sm-6 col-xl-3">
          <KpiCard
            title="Total Residents"
            value={s.totalResidents || 0}
            subtitle="Across assigned blocks"
            icon={Users}
            color="primary"
          />
        </div>
        <div className="col-12 col-sm-6 col-xl-3">
          <KpiCard
            title="Present Today"
            value={s.presentToday || 0}
            subtitle="Biometrically verified inside hostel"
            icon={CheckCircle2}
            color="success"
          />
        </div>
        <div className="col-12 col-sm-6 col-xl-3">
          <KpiCard
            title="On Approved Leave"
            value={s.leaveToday || 0}
            subtitle="Authorized gate / night passes"
            icon={FileCheck2}
            color="warning"
          />
        </div>
        <div className="col-12 col-sm-6 col-xl-3">
          <KpiCard
            title="Defaulters (≥2 Nights)"
            value={s.consecutiveAlertCount || 0}
            subtitle={(s.consecutiveAlertCount || 0) > 0 ? "Requires welfare check" : "All residents accounted for"}
            icon={ShieldAlert}
            color={(s.consecutiveAlertCount || 0) > 0 ? "danger" : "success"}
          />
        </div>
      </div>

      {/* View Sections based on subTab */}
      {(subTab === 'warden_overview' || !subTab) && (
        <>
          {/* Hostel Blocks Overview */}
          <div className="row g-4 mb-4">
            <div className="col-lg-12">
              <div className="card shadow-sm border-0 rounded-3">
                <div className="card-header bg-white border-bottom py-3 d-flex justify-content-between align-items-center flex-wrap gap-2">
                  <h6 className="card-title mb-0 fw-semibold d-flex align-items-center gap-2">
                    <BedDouble size={18} className="text-primary" />
                    Block Attendance & Occupancy Status
                  </h6>
                  {onSelectTab && (
                    <button
                      type="button"
                      className="btn btn-outline-primary btn-sm d-flex align-items-center gap-1 shadow-sm"
                      onClick={() => onSelectTab('warden_attendance')}
                    >
                      <Calendar size={14} /> Open Roll Call Ledger
                    </button>
                  )}
                </div>
                <div className="card-body p-3">
                  <div className="row g-3">
                    {blocks.map((b) => {
                      const total = b.resident_count || 0;
                      const present = b.present_today || 0;
                      const pct = total > 0 ? Math.round((present / total) * 100) : 0;
                      return (
                        <div key={b.id || b.block_name} className="col-md-4">
                          <div className="border rounded-3 p-3 bg-light h-100">
                            <div className="d-flex justify-content-between align-items-center mb-2">
                              <h6 className="fw-bold text-dark mb-0">{b.block_name}</h6>
                              <span className="badge bg-primary px-2 py-1">{present} / {total} Present Today</span>
                            </div>
                            <div className="text-muted small mb-2">{b.gender_type || 'Co-ed'} Hostel</div>
                            <div className="progress mb-2" style={{ height: '8px' }}>
                              <div
                                className="progress-bar bg-success"
                                role="progressbar"
                                style={{ width: `${pct}%` }}
                              ></div>
                            </div>
                            <div className="d-flex justify-content-between small text-muted">
                              <span>Present: <strong className="text-success">{present}</strong></span>
                              <span>Absent: <strong className="text-danger">{Math.max(0, total - present)}</strong></span>
                              <span>Capacity: <strong>{b.capacity || total}</strong></span>
                            </div>
                          </div>
                    
      {/* ========================================================= */}
      {/* MODAL 1: Emergency Evacuation Muster Roll                  */}
      {/* ========================================================= */}
      {showMusterModal && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(3px)' }}>
          <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content border-0 shadow-lg rounded-4">
              <div className="modal-header bg-danger text-white py-3 px-4 rounded-top-4">
                <div className="d-flex align-items-center gap-2">
                  <ShieldAlert size={22} />
                  <div>
                    <h5 className="modal-title fw-bold mb-0">🚨 Emergency Evacuation Muster Desk</h5>
                    <div className="small opacity-75" style={{ fontSize: '12px' }}>
                      Official Incident Safety Ledger • Real-time Headcount for Emergency Responders
                    </div>
                  </div>
                </div>
                <button type="button" className="btn-close btn-close-white" onClick={() => setShowMusterModal(false)} />
              </div>
              <div className="modal-body p-4 bg-light">
                {musterLoading ? (
                  <div className="text-center py-5">
                    <div className="spinner-border text-danger" role="status"></div>
                    <p className="mt-2 text-muted small">Generating live hostel muster count...</p>
                  </div>
                ) : musterData ? (
                  <div>
                    {/* Top Summary Stats */}
                    <div className="row g-3 mb-4">
                      <div className="col-md-3">
                        <div className="card border-0 shadow-sm rounded-3 p-3 text-center bg-white">
                          <div className="text-muted small fw-semibold">TOTAL REGISTERED</div>
                          <h3 className="fw-bold text-dark mb-0">{musterData.summary?.total_residents || 0}</h3>
                          <div className="small text-muted">All active hostel beds</div>
                        </div>
                      </div>
                      <div className="col-md-3">
                        <div className="card border-0 shadow-sm rounded-3 p-3 text-center bg-success bg-opacity-10 border-success border-opacity-25">
                          <div className="text-success small fw-semibold">✓ VERIFIED INSIDE</div>
                          <h3 className="fw-bold text-success mb-0">{musterData.summary?.verified_inside_count || 0}</h3>
                          <div className="small text-success">Biometrically Present</div>
                        </div>
                      </div>
                      <div className="col-md-3">
                        <div className="card border-0 shadow-sm rounded-3 p-3 text-center bg-warning bg-opacity-10 border-warning border-opacity-25">
                          <div className="text-warning small fw-semibold">✈ ON APPROVED LEAVE</div>
                          <h3 className="fw-bold text-warning mb-0">{musterData.summary?.approved_leave_count || 0}</h3>
                          <div className="small text-warning">Authorized Out-pass</div>
                        </div>
                      </div>
                      <div className="col-md-3">
                        <div className="card border-0 shadow-sm rounded-3 p-3 text-center bg-danger bg-opacity-10 border-danger border-opacity-25">
                          <div className="text-danger small fw-semibold">⚠ UNACCOUNTED / MISSING</div>
                          <h3 className="fw-bold text-danger mb-0">{musterData.summary?.missing_unaccounted_count || 0}</h3>
                          <div className="small text-danger">Requires Immediate Check</div>
                        </div>
                      </div>
                    </div>

                    {/* Filter Tabs */}
                    <div className="d-flex justify-content-between align-items-center mb-3">
                      <div className="btn-group shadow-sm rounded-pill overflow-hidden bg-white p-1">
                        <button
                          type="button"
                          className={`btn btn-sm rounded-pill px-3 fw-semibold ${musterTab === 'missing' ? 'btn-danger text-white' : 'btn-light text-dark'}`}
                          onClick={() => setMusterTab('missing')}
                        >
                          Unaccounted ({musterData.missingUnaccounted?.length || 0})
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm rounded-pill px-3 fw-semibold ${musterTab === 'inside' ? 'btn-success text-white' : 'btn-light text-dark'}`}
                          onClick={() => setMusterTab('inside')}
                        >
                          Verified Inside ({musterData.verifiedInside?.length || 0})
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm rounded-pill px-3 fw-semibold ${musterTab === 'leave' ? 'btn-warning text-dark' : 'btn-light text-dark'}`}
                          onClick={() => setMusterTab('leave')}
                        >
                          On Leave ({musterData.approvedLeave?.length || 0})
                        </button>
                      </div>

                      <button
                        type="button"
                        className="btn btn-outline-dark btn-sm d-flex align-items-center gap-1 shadow-sm rounded-pill px-3"
                        onClick={() => window.print()}
                      >
                        🖨️ Print Muster Roll
                      </button>
                    </div>

                    {/* Residents Table */}
                    <div className="card border-0 shadow-sm rounded-3 overflow-hidden">
                      <div className="table-responsive">
                        <table className="table table-hover align-middle mb-0">
                          <thead className="table-light small">
                            <tr>
                              <th>Student</th>
                              <th>Roll Number</th>
                              <th>Block & Room</th>
                              <th>Phone Number</th>
                              <th>Emergency Parent Contact</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody className="small">
                            {musterTab === 'missing' && (
                              (musterData.missingUnaccounted || []).length === 0 ? (
                                <tr><td colSpan="6" className="text-center py-4 text-success fw-semibold">✓ 100% of residents are accounted for tonight!</td></tr>
                              ) : (
                                (musterData.missingUnaccounted || []).map((st) => (
                                  <tr key={st.id} className="table-danger">
                                    <td className="fw-bold">{st.full_name}</td>
                                    <td><code className="text-dark">{st.roll_number}</code></td>
                                    <td><span className="badge bg-secondary">{st.hostel_block}</span> Rm {st.room_number || 'N/A'}</td>
                                    <td><a href={`tel:${st.phone}`} className="text-decoration-none fw-semibold">{st.phone || 'N/A'}</a></td>
                                    <td><strong className="text-danger">{st.emergency_phone || 'Parent Contact Missing'}</strong></td>
                                    <td><span className="badge bg-danger">MISSING / UNCHECKED</span></td>
                                  </tr>
                                ))
                              )
                            )}

                            {musterTab === 'inside' && (
                              (musterData.verifiedInside || []).map((st) => (
                                <tr key={st.id}>
                                  <td className="fw-semibold">{st.full_name}</td>
                                  <td><code>{st.roll_number}</code></td>
                                  <td><span className="badge bg-light text-dark border">{st.hostel_block}</span> Rm {st.room_number || 'N/A'}</td>
                                  <td>{st.phone || 'N/A'}</td>
                                  <td>{st.emergency_phone || 'N/A'}</td>
                                  <td><span className="badge bg-success">✓ PRESENT ({st.time_marked || 'Verified'})</span></td>
                                </tr>
                              ))
                            )}

                            {musterTab === 'leave' && (
                              (musterData.approvedLeave || []).map((st) => (
                                <tr key={st.id}>
                                  <td className="fw-semibold">{st.full_name}</td>
                                  <td><code>{st.roll_number}</code></td>
                                  <td><span className="badge bg-light text-dark border">{st.hostel_block}</span> Rm {st.room_number || 'N/A'}</td>
                                  <td>{st.phone || 'N/A'}</td>
                                  <td>{st.emergency_phone || 'N/A'}</td>
                                  <td><span className="badge bg-warning text-dark">APPROVED LEAVE</span></td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4">No muster data loaded.</div>
                )}
              </div>
              <div className="modal-footer border-top py-2 px-4 bg-white">
                <button type="button" className="btn btn-secondary btn-sm rounded-pill px-3" onClick={() => setShowMusterModal(false)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 2: In-Person Physical Check-In Queue                */}
      {/* ========================================================= */}
      {showPhysicalQueueModal && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)' }}>
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content border-0 shadow-lg rounded-4">
              <div className="modal-header border-bottom py-3 px-4 bg-light rounded-top-4">
                <h6 className="modal-title fw-bold text-dark d-flex align-items-center gap-2">
                  <UserCheck className="text-primary" size={20} />
                  Pending In-Person Physical Verifications
                </h6>
                <button type="button" className="btn-close" onClick={() => setShowPhysicalQueueModal(false)} />
              </div>
              <div className="modal-body p-4">
                <p className="text-muted small mb-3">
                  Residents who reported medical facial injuries, bandages, or broken smartphone cameras for tonight's roll call. Wardens can verify them in person during room rounds and confirm their attendance.
                </p>

                {pendingPhysicalList.length === 0 ? (
                  <div className="alert alert-light border text-center py-4 text-muted small mb-0 rounded-3">
                    ✓ No pending physical verification requests tonight. All residents are using automated biometric check-in.
                  </div>
                ) : (
                  <div className="list-group shadow-sm rounded-3">
                    {pendingPhysicalList.map((item) => (
                      <div key={item.id} className="list-group-item p-3 border-start border-4 border-warning">
                        <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
                          <div>
                            <h6 className="fw-bold text-dark mb-0">{item.full_name} ({item.roll_number})</h6>
                            <div className="text-muted small">
                              Block {item.hostel_block} &bull; Room {item.room_number || 'N/A'} &bull; Phone: <a href={`tel:${item.phone}`}>{item.phone || 'N/A'}</a>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-success btn-sm rounded-pill px-3 fw-semibold shadow-sm"
                            disabled={verifyingPhysicalId === item.id}
                            onClick={() => handleConfirmPhysicalAttendance(item)}
                          >
                            {verifyingPhysicalId === item.id ? 'Confirming...' : '✓ Confirm Physical Presence'}
                          </button>
                        </div>
                        <div className="small bg-light p-2 rounded text-dark border">
                          <strong>Reported Note:</strong> {item.reason.replace('[PHYSICAL_VERIFICATION] ', '')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="modal-footer border-top py-2 px-4 bg-white">
                <button type="button" className="btn btn-outline-secondary btn-sm rounded-pill px-3" onClick={() => setShowPhysicalQueueModal(false)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
})}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {(subTab === 'warden_exceptions' || subTab === 'warden_overview') && (
        <>
          {/* Consecutive Night Defaulter Safety Alerts */}
          {((exceptions?.consecutiveAlerts || overview?.consecutiveAlerts || []).length > 0) && (
            <div className="card shadow-sm border-danger border-opacity-50 rounded-4 mb-4 overflow-hidden">
              <div className="card-header bg-danger bg-opacity-10 border-bottom border-danger border-opacity-25 py-3 d-flex justify-content-between align-items-center flex-wrap gap-2">
                <div className="d-flex align-items-center gap-2">
                  <ShieldAlert size={20} className="text-danger" />
                  <div>
                    <h6 className="card-title mb-0 fw-bold text-danger">
                      🚨 Consecutive Night Defaulter Alerts ({(exceptions?.consecutiveAlerts || overview?.consecutiveAlerts || []).length} Residents)
                    </h6>
                    <small className="text-danger opacity-75">
                      Residents who missed 2 or more consecutive roll calls without an approved gate pass or leave slip.
                    </small>
                  </div>
                </div>
                <span className="badge bg-danger text-white px-2 py-1">
                  High Priority Safety Desk
                </span>
              </div>
              <div className="card-body p-0">
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead className="table-danger table-opacity-10">
                      <tr className="small text-danger fw-bold">
                        <th className="ps-3">Resident Student</th>
                        <th>Roll No</th>
                        <th>Block &amp; Room</th>
                        <th>Consecutive Nights Missed</th>
                        <th>Contact Phone</th>
                        <th className="pe-3 text-end">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(exceptions?.consecutiveAlerts || overview?.consecutiveAlerts || []).map((st) => (
                        <tr key={st.student_id || st.roll_number}>
                          <td className="ps-3">
                            <div className="fw-bold text-dark">{st.full_name}</div>
                            <small className="text-muted">{st.course || 'Resident'}</small>
                          </td>
                          <td><code>{st.roll_number}</code></td>
                          <td>
                            <span className="badge bg-light text-dark border me-1">{st.hostel_block}</span>
                            <small className="text-muted">Rm {st.room_number || 'N/A'}</small>
                          </td>
                          <td>
                            <span className="badge bg-danger text-white fw-bold px-2 py-1">
                              ⚠️ {st.consecutive_nights_missed} Nights Missing
                            </span>
                            {st.last_seen_date && (
                              <div className="text-muted small mt-1" style={{ fontSize: '11px' }}>
                                Last verified: {st.last_seen_date}
                              </div>
                            )}
                          </td>
                          <td>
                            {st.phone ? (
                              <a href={'tel:' + st.phone} className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1">
                                <Phone size={12} /> {st.phone}
                              </a>
                            ) : (
                              <span className="text-muted small">No phone listed</span>
                            )}
                          </td>
                          <td className="pe-3 text-end">
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-danger"
                              onClick={() => {
                                alert('Dispatching welfare verification check for ' + st.full_name + ' (' + st.roll_number + ') missing for ' + st.consecutive_nights_missed + ' nights.');
                              }}
                            >
                              Dispatch Welfare Check
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Exceptions & Absent Table */}
          <div className="card shadow-sm border-0 rounded-3 mb-4">
          <div className="card-header bg-white border-bottom py-3 d-flex justify-content-between align-items-center">
            <h6 className="card-title mb-0 fw-semibold d-flex align-items-center gap-2">
              <ShieldAlert size={18} className="text-danger" />
              Unverified / Absent Students Today ({exceptions?.absentStudents?.length || 0})
            </h6>
          </div>
          <div className="card-body p-0">
            {!exceptions?.absentStudents || exceptions.absentStudents.length === 0 ? (
              <div className="text-center p-4 text-muted small">
                <CheckCircle2 size={32} className="text-success mb-2 opacity-50" />
                <div>All residents have verified attendance today!</div>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead className="table-light">
                    <tr className="small text-muted">
                      <th className="ps-3">Student Name</th>
                      <th>Roll No</th>
                      <th>Block & Room</th>
                      <th>Course</th>
                      <th>Contact Phone</th>
                      <th className="pe-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(subTab === 'warden_overview'
                      ? (exceptions?.absentStudents || []).slice(0, 10)
                      : (exceptions?.absentStudents || [])
                    ).map((st) => (
                      <tr key={st.id}>
                        <td className="ps-3 fw-medium text-dark">{st.full_name}</td>
                        <td><code>{st.roll_number}</code></td>
                        <td>
                          <span className="badge bg-light text-dark me-1">{st.hostel_block}</span>
                          <small className="text-muted">Rm {st.room_number || 'N/A'}</small>
                        </td>
                        <td><small className="text-muted">{st.course || 'N/A'}</small></td>
                        <td>
                          {st.phone ? (
                            <span className="small text-dark d-flex align-items-center gap-1">
                              <Phone size={12} className="text-muted" /> {st.phone}
                            </span>
                          ) : (
                            <span className="small text-muted">&mdash;</span>
                          )}
                        </td>
                        <td className="pe-3">
                          <span className="badge bg-danger-subtle text-danger border border-danger-subtle">
                            ABSENT
                          </span>
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

      {(subTab === 'warden_corrections' || subTab === 'warden_overview') && (
        /* Correction Requests Table */
        <div className="card shadow-sm border-0 rounded-3 mb-4">
          <div className="card-header bg-white border-bottom py-3 d-flex justify-content-between align-items-center">
            <h6 className="card-title mb-0 fw-semibold d-flex align-items-center gap-2">
              <FileCheck2 size={18} className="text-primary" />
              Resident Attendance Correction Appeals ({corrections.length})
            </h6>
          </div>
          <div className="card-body p-0">
            {corrections.length === 0 ? (
              <div className="text-center p-4 text-muted small">
                No attendance correction appeals pending.
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead className="table-light">
                    <tr className="small text-muted">
                      <th className="ps-3">Resident</th>
                      <th>Target Date</th>
                      <th>Block & Room</th>
                      <th>Reason</th>
                      <th>Status</th>
                      <th className="text-end pe-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {corrections.map((c) => (
                      <tr key={c.id}>
                        <td className="ps-3">
                          <div className="fw-medium text-dark">{c.full_name}</div>
                          <code className="small">{c.roll_number}</code>
                        </td>
                        <td><span className="fw-semibold text-primary">{c.date}</span></td>
                        <td>
                          <span className="badge bg-light text-dark">{c.hostel_block} - Rm {c.room_number}</span>
                        </td>
                        <td style={{ maxWidth: '300px' }}>
                          <div className="small text-dark text-truncate" title={c.reason}>{c.reason}</div>
                        </td>
                        <td>
                          <span className={`badge ${c.status === 'APPROVED' ? 'bg-success' : c.status === 'REJECTED' ? 'bg-danger' : 'bg-warning text-dark'}`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="text-end pe-3">
                          {c.status === 'PENDING' && (
                            <button
                              className="btn btn-sm btn-primary py-0 px-2"
                              style={{ fontSize: '12px' }}
                              onClick={() => setReviewModal({ open: true, req: c, decision: 'APPROVED', note: '' })}
                            >
                              Review
                            </button>
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
      )}

      {(subTab === 'warden_feedback' || subTab === 'warden_overview') && (
        /* Facility Support Tickets */
        <div className="card shadow-sm border-0 rounded-3 mb-4">
          <div className="card-header bg-white border-bottom py-3 d-flex justify-content-between align-items-center">
            <h6 className="card-title mb-0 fw-semibold d-flex align-items-center gap-2">
              <LifeBuoy size={18} className="text-primary" />
              Resident Facility Grievances ({tickets.length})
            </h6>
          </div>
          <div className="card-body p-0">
            {tickets.length === 0 ? (
              <div className="text-center p-4 text-muted small">
                No grievances registered by residents.
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead className="table-light">
                    <tr className="small text-muted">
                      <th className="ps-3">Resident</th>
                      <th>Room</th>
                      <th>Category</th>
                      <th>Issue & Details</th>
                      <th>Status</th>
                      <th className="text-end pe-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.map((t) => (
                      <tr key={t.id}>
                        <td className="ps-3">
                          <div className="fw-medium text-dark">{t.full_name}</div>
                          <code className="small">{t.roll_number}</code>
                        </td>
                        <td>{t.room_number ? `Rm ${t.room_number}` : 'N/A'}</td>
                        <td><span className="badge bg-light text-dark">{t.category || 'General'}</span></td>
                        <td style={{ maxWidth: '350px' }}>
                          <div className="fw-semibold text-dark small">{t.subject}</div>
                          <div className="small text-muted text-truncate" title={t.message}>{t.message}</div>
                        </td>
                        <td>
                          <span className={`badge ${t.status === 'RESOLVED' ? 'bg-success' : 'bg-warning text-dark'}`}>
                            {t.status}
                          </span>
                        </td>
                        <td className="text-end pe-3">
                          <button
                            className="btn btn-sm btn-outline-primary py-0 px-2"
                            style={{ fontSize: '12px' }}
                            onClick={() => setTicketModal({ open: true, ticket: t, status: 'RESOLVED', note: '' })}
                          >
                            Respond
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
      )}

      {/* Warden Review Correction Modal */}
      {reviewModal.open && reviewModal.req && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content rounded-3 border-0 shadow">
              <div className="modal-header border-bottom">
                <h6 className="modal-title fw-bold">Warden Correction Adjudication</h6>
                <button type="button" className="btn-close" onClick={() => setReviewModal({ ...reviewModal, open: false })}></button>
              </div>
              <form onSubmit={handleReviewCorrection}>
                <div className="modal-body p-4">
                  <div className="mb-2">
                    <strong>Resident:</strong> {reviewModal.req.full_name} ({reviewModal.req.roll_number})
                  </div>
                  <div className="mb-3 small text-muted">
                    Contested Date: {reviewModal.req.date} &bull; Rm {reviewModal.req.room_number}
                  </div>
                  <div className="p-3 bg-light rounded-3 mb-3 small">
                    <strong>Reason:</strong> {reviewModal.req.reason}
                  </div>
                  <div className="mb-3">
                    <label className="form-label small fw-medium">Warden Decision</label>
                    <select
                      className="form-select form-select-sm"
                      value={reviewModal.decision}
                      onChange={(e) => setReviewModal({ ...reviewModal, decision: e.target.value })}
                    >
                      <option value="APPROVED">Approve (Authorize Attendance)</option>
                      <option value="REJECTED">Reject Appeal</option>
                    </select>
                  </div>
                  <div className="mb-3">
                    <label className="form-label small fw-medium">Warden Resolution Notes <span className="text-danger">*</span></label>
                    <textarea
                      className="form-control"
                      rows="3"
                      placeholder="e.g., Verified room presence in person during floor check."
                      value={reviewModal.note}
                      onChange={(e) => setReviewModal({ ...reviewModal, note: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <div className="modal-footer border-top">
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setReviewModal({ ...reviewModal, open: false })}>Cancel</button>
                  <button type="submit" className="btn btn-sm btn-primary" disabled={submittingReview}>
                    {submittingReview ? 'Saving...' : 'Commit Decision'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Warden Ticket Respond Modal */}
      {ticketModal.open && ticketModal.ticket && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content rounded-3 border-0 shadow">
              <div className="modal-header border-bottom">
                <h6 className="modal-title fw-bold">Respond to Resident Grievance</h6>
                <button type="button" className="btn-close" onClick={() => setTicketModal({ ...ticketModal, open: false })}></button>
              </div>
              <form onSubmit={handleRespondFeedback}>
                <div className="modal-body p-4">
                  <div className="mb-2">
                    <strong>Resident:</strong> {ticketModal.ticket.full_name} ({ticketModal.ticket.roll_number})
                  </div>
                  <div className="mb-3 small text-primary fw-medium">{ticketModal.ticket.subject}</div>
                  <div className="p-3 bg-light rounded-3 mb-3 small">{ticketModal.ticket.message}</div>
                  <div className="mb-3">
                    <label className="form-label small fw-medium">Status</label>
                    <select
                      className="form-select form-select-sm"
                      value={ticketModal.status}
                      onChange={(e) => setTicketModal({ ...ticketModal, status: e.target.value })}
                    >
                      <option value="RESOLVED">Resolved / Repaired</option>
                      <option value="IN_PROGRESS">Under Inspection</option>
                    </select>
                  </div>
                  <div className="mb-3">
                    <label className="form-label small fw-medium">Warden Remarks <span className="text-danger">*</span></label>
                    <textarea
                      className="form-control"
                      rows="3"
                      placeholder="e.g., Electrician inspected switchboard on 2nd floor."
                      value={ticketModal.note}
                      onChange={(e) => setTicketModal({ ...ticketModal, note: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <div className="modal-footer border-top">
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setTicketModal({ ...ticketModal, open: false })}>Cancel</button>
                  <button type="submit" className="btn btn-sm btn-primary" disabled={submittingTicket}>
                    {submittingTicket ? 'Submitting...' : 'Save Remarks'}
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
