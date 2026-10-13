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
  BedDouble
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

  useEffect(() => {
    loadAllData();
  }, []);

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
      if (corrRes.status === 'fulfilled' && corrRes.value.success) setCorrections(corrRes.value.requests || []);
      if (feedRes.status === 'fulfilled' && feedRes.value.success) setTickets(feedRes.value.tickets || []);
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
      if (corrRes?.success) setCorrections(corrRes.requests || []);
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
      if (feedRes?.success) setTickets(feedRes.tickets || []);
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

      {/* KPI Cards */}
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
            subtitle="Biometrically verified"
            icon={CheckCircle2}
            color="success"
          />
        </div>
        <div className="col-12 col-sm-6 col-xl-3">
          <KpiCard
            title="Absent Today"
            value={s.absentToday || 0}
            subtitle="Pending roll call check"
            icon={XCircle}
            color="danger"
          />
        </div>
        <div className="col-12 col-sm-6 col-xl-3">
          <KpiCard
            title="Pending Requests"
            value={s.pendingCorrections || 0}
            subtitle={`${s.openTickets || 0} open tickets`}
            icon={FileCheck2}
            color="warning"
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
                <div className="card-header bg-white border-bottom py-3">
                  <h6 className="card-title mb-0 fw-semibold d-flex align-items-center gap-2">
                    <BedDouble size={18} className="text-primary" />
                    Block Attendance & Occupancy Status
                  </h6>
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
                              <span className="badge bg-primary px-2 py-1">{pct}% Present</span>
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
        /* Exceptions & Absent Table */
        <div className="card shadow-sm border-0 rounded-3 mb-4">
          <div className="card-header bg-white border-bottom py-3 d-flex justify-content-between align-items-center">
            <h6 className="card-title mb-0 fw-semibold d-flex align-items-center gap-2">
              <ShieldAlert size={18} className="text-danger" />
              Unverified / Absent Students Today ({exceptions?.absentStudents?.length || 0})
            </h6>
          </div>
          <div className="card-body p-0">
            {!exceptions || exceptions.absentStudents.length === 0 ? (
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
                    {exceptions.absentStudents.slice(0, 10).map((st) => (
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
