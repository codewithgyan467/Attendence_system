import React, { useState, useEffect } from 'react';
import { api } from '../../utils/api';
import {
  LifeBuoy,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RefreshCw,
  MessageSquare,
  Send
} from 'lucide-react';

export default function FeedbackTicketDesk() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState('OPEN');
  const [errorMsg, setErrorMsg] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketStatus, setTicketStatus] = useState('RESOLVED');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchFeedback();
  }, [selectedStatus]);

  const fetchFeedback = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.admin.getFeedback(selectedStatus || undefined);
      setTickets(data.feedback || data.tickets || []);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to fetch student feedback tickets');
    } finally {
      setLoading(false);
    }
  };

  const openModal = (t) => {
    setSelectedTicket(t);
    setTicketStatus('RESOLVED');
    setResolutionNotes('');
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!resolutionNotes.trim()) {
      setErrorMsg('Resolution note / response to student is required.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    setStatusMsg(null);

    try {
      const res = await api.admin.resolveFeedback(selectedTicket.id, {
        status: ticketStatus,
        resolution_note: resolutionNotes,
        resolution_notes: resolutionNotes
      });
      setStatusMsg(res.message || 'Feedback ticket successfully updated.');
      setShowModal(false);
      fetchFeedback();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to update feedback ticket');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container-fluid px-0">
      {/* Page Title */}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-2">
        <div>
          <h4 className="fw-bold mb-1 d-flex align-items-center gap-2">
            <LifeBuoy className="text-primary" size={24} />
            Student Support & Grievance Desk
          </h4>
          <p className="text-muted small mb-0">
            Address student queries regarding hostel facilities, Wi-Fi connectivity, app troubleshooting, and room amenities.
          </p>
        </div>
        <button
          className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
          onClick={fetchFeedback}
          disabled={loading}
        >
          <RefreshCw size={14} /> Refresh
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

      {/* Filter Tabs */}
      <div className="card shadow-sm border-0 rounded-3 mb-4">
        <div className="card-body p-2">
          <div className="d-flex gap-2">
            <button
              className={`btn btn-sm ${selectedStatus === 'OPEN' ? 'btn-primary' : 'btn-light'}`}
              onClick={() => setSelectedStatus('OPEN')}
            >
              Open Issues
            </button>
            <button
              className={`btn btn-sm ${selectedStatus === 'RESOLVED' ? 'btn-primary' : 'btn-light'}`}
              onClick={() => setSelectedStatus('RESOLVED')}
            >
              Resolved Tickets
            </button>
            <button
              className={`btn btn-sm ${selectedStatus === '' ? 'btn-primary' : 'btn-light'}`}
              onClick={() => setSelectedStatus('')}
            >
              All Tickets
            </button>
          </div>
        </div>
      </div>

      {/* Tickets List */}
      <div className="card shadow-sm border-0 rounded-3">
        <div className="card-header bg-white border-bottom py-3">
          <h6 className="card-title mb-0 fw-semibold">Tickets ({tickets.length})</h6>
        </div>
        <div className="card-body p-0">
          {loading ? (
            <div className="text-center p-5">
              <div className="spinner-border text-primary mb-2" role="status"></div>
              <p className="text-muted small mb-0">Loading feedback stream...</p>
            </div>
          ) : tickets.length === 0 ? (
            <div className="text-center p-5 text-muted">
              <CheckCircle2 size={40} className="mb-2 text-success opacity-50" />
              <p className="mb-0">No support tickets found under this filter.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead className="table-light">
                  <tr className="small text-muted">
                    <th className="ps-3">Student</th>
                    <th>Category</th>
                    <th>Subject & Message</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th className="text-end pe-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t) => (
                    <tr key={t.id}>
                      <td className="ps-3">
                        <div className="fw-medium text-dark">{t.full_name}</div>
                        <code className="small">{t.roll_no || t.roll_number}</code>
                      </td>
                      <td>
                        <span className="badge bg-light text-dark">{t.category || 'General'}</span>
                      </td>
                      <td style={{ maxWidth: '350px' }}>
                        <div className="fw-semibold text-dark small">{t.subject}</div>
                        <div className="text-muted small text-truncate" title={t.message}>
                          {t.message}
                        </div>
                        {(t.admin_response || t.resolution_note) && (
                          <div className="text-success small mt-1">
                            Resolution: {t.admin_response || t.resolution_note}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${t.status === 'RESOLVED' ? 'bg-success-subtle text-success border border-success-subtle' : 'bg-warning-subtle text-warning border border-warning-subtle'}`}>
                          {t.status}
                        </span>
                      </td>
                      <td>
                        <small className="text-muted">
                          {t.created_at ? new Date(t.created_at).toLocaleDateString() : 'N/A'}
                        </small>
                      </td>
                      <td className="text-end pe-3">
                        <button
                          className="btn btn-sm btn-outline-primary py-0 px-2"
                          style={{ fontSize: '12px' }}
                          onClick={() => openModal(t)}
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

      {/* Response Modal */}
      {showModal && selectedTicket && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content rounded-3 border-0 shadow">
              <div className="modal-header border-bottom">
                <h6 className="modal-title fw-bold d-flex align-items-center gap-2">
                  <LifeBuoy size={18} className="text-primary" />
                  Respond to Support Ticket
                </h6>
                <button type="button" className="btn-close" onClick={() => setShowModal(false)}></button>
              </div>
              <form onSubmit={handleSubmit}>
                <div className="modal-body p-4">
                  <div className="mb-3">
                    <label className="form-label small text-muted mb-0">Student</label>
                    <div className="fw-semibold text-dark">{selectedTicket.full_name} ({selectedTicket.roll_no})</div>
                    <div className="small text-primary">{selectedTicket.subject}</div>
                  </div>

                  <div className="mb-3 p-3 bg-light rounded-3">
                    <div className="small text-dark">{selectedTicket.message}</div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small fw-medium">Update Status</label>
                    <select
                      className="form-select form-select-sm"
                      value={ticketStatus}
                      onChange={(e) => setTicketStatus(e.target.value)}
                    >
                      <option value="RESOLVED">Resolved / Closed</option>
                      <option value="IN_PROGRESS">In Progress / Investigating</option>
                      <option value="OPEN">Keep Open</option>
                    </select>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small fw-medium">
                      Official Admin Response / Notes <span className="text-danger">*</span>
                    </label>
                    <textarea
                      className="form-control"
                      rows="3"
                      placeholder="e.g., Facility technician dispatched to Room 102; Wi-Fi router rebooted."
                      value={resolutionNotes}
                      onChange={(e) => setResolutionNotes(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="modal-footer border-top">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => setShowModal(false)}
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-sm btn-primary"
                    disabled={submitting}
                  >
                    {submitting ? 'Saving...' : 'Send Resolution'}
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
