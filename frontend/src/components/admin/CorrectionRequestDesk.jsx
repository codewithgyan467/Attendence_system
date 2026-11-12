import React, { useState, useEffect } from 'react';
import { api } from '../../utils/api';
import {
  FileCheck2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  RefreshCw,
  Search,
  MessageSquare,
  Trash2,
  Download,
  FileSpreadsheet,
  ShieldCheck
} from 'lucide-react';
import { exportToExcel, exportToCsv } from '../../utils/exportUtils';
import { formatDateTime12h, getTodayDateIST } from '../../utils/timeUtils';

export default function CorrectionRequestDesk() {
  const [corrections, setCorrections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState('PENDING');
  const [errorMsg, setErrorMsg] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);

  // Review Modal state
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [selectedReq, setSelectedReq] = useState(null);
  const [reviewDecision, setReviewDecision] = useState('APPROVED');
  const [reviewNotes, setReviewNotes] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  // Biometric Face Update Requests state
  const [activeSubTab, setActiveSubTab] = useState('corrections'); // 'corrections' | 'face_updates'
  const [faceRequests, setFaceRequests] = useState([]);
  const [faceLoading, setFaceLoading] = useState(false);
  const [faceSelectedStatus, setFaceSelectedStatus] = useState('PENDING'); // 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'

  // Face Review Modal state
  const [showFaceReviewModal, setShowFaceReviewModal] = useState(false);
  const [selectedFaceReq, setSelectedFaceReq] = useState(null);
  const [faceReviewDecision, setFaceReviewDecision] = useState('APPROVED');
  const [faceReviewNotes, setFaceReviewNotes] = useState('');
  const [submittingFaceReview, setSubmittingFaceReview] = useState(false);

  useEffect(() => {
    fetchCorrections();
    fetchFaceRequests();
  }, [selectedStatus, faceSelectedStatus]);

  const fetchFaceRequests = async () => {
    setFaceLoading(true);
    try {
      const data = await api.admin.getFaceUpdateRequests(faceSelectedStatus === 'ALL' ? undefined : faceSelectedStatus);
      setFaceRequests(data.requests || []);
    } catch (err) {
      console.warn('Failed to fetch face update requests:', err.message);
    } finally {
      setFaceLoading(false);
    }
  };

  const openFaceReviewModal = (req, defaultDecision = 'APPROVED') => {
    setSelectedFaceReq(req);
    setFaceReviewDecision(defaultDecision);
    setFaceReviewNotes('');
    setShowFaceReviewModal(true);
  };

  const handleFaceReviewSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (faceReviewDecision === 'REJECTED' && !faceReviewNotes.trim()) {
      setErrorMsg('Rejection reason is required when rejecting a face update request.');
      return;
    }

    setSubmittingFaceReview(true);
    setErrorMsg(null);
    setStatusMsg(null);

    try {
      const res = await api.admin.reviewFaceUpdateRequest(selectedFaceReq.id, {
        decision: faceReviewDecision,
        rejection_reason: faceReviewNotes.trim()
      });
      setStatusMsg(res.message || `Face update request marked as ${faceReviewDecision}.`);
      setShowFaceReviewModal(false);
      fetchFaceRequests();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to submit face request review');
    } finally {
      setSubmittingFaceReview(false);
    }
  };

  const fetchCorrections = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.admin.getCorrections(selectedStatus || undefined);
      setCorrections(data.corrections || data.requests || []);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to fetch attendance correction requests');
    } finally {
      setLoading(false);
    }
  };

  const openReviewModal = (req) => {
    setSelectedReq(req);
    setReviewDecision('APPROVED');
    setReviewNotes('');
    setShowReviewModal(true);
  };

  const handleReviewSubmit = async (e) => {
    e.preventDefault();
    if (!reviewNotes.trim()) {
      setErrorMsg('Review notes / explanation are mandatory.');
      return;
    }

    setSubmittingReview(true);
    setErrorMsg(null);
    setStatusMsg(null);

    try {
      const res = await api.admin.reviewCorrection(selectedReq.id, {
        decision: reviewDecision,
        status: reviewDecision,
        resolution_note: reviewNotes,
        review_notes: reviewNotes
      });
      setStatusMsg(res.message || `Correction request successfully marked as ${reviewDecision}.`);
      setShowReviewModal(false);
      fetchCorrections();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to submit correction review');
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleDeleteSingle = async (id, rollNo) => {
    if (!window.confirm(`Delete correction request for student ${rollNo || id}? This cannot be undone.`)) {
      return;
    }
    setDeletingId(id);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.admin.deleteCorrection(id);
      setStatusMsg(res.message || 'Correction request deleted successfully.');
      setCorrections((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setErrorMsg(err.message || 'Failed to delete correction request');
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAll = async () => {
    setClearingAll(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.admin.clearAllCorrections(selectedStatus || undefined);
      setStatusMsg(res.message || 'All selected correction requests cleared.');
      setShowClearModal(false);
      fetchCorrections();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to clear correction requests');
    } finally {
      setClearingAll(false);
    }
  };

  const handleExportCsv = () => {
    if (!corrections || corrections.length === 0) return;
    const headers = [
      { key: 'roll_number', label: 'Roll Number' },
      { key: 'full_name', label: 'Student Name' },
      { key: 'date', label: 'Target Date' },
      { key: 'requested_status', label: 'Requested Status' },
      { key: 'reason', label: 'Reason' },
      { key: 'status', label: 'Decision Status' },
      { key: 'created_at', label: 'Submitted On (IST)' }
    ];
    const data = corrections.map(c => ({
      roll_number: c.roll_number || '',
      full_name: c.full_name || '',
      date: c.date || '',
      requested_status: c.requested_status || '',
      reason: c.reason || '',
      status: c.status || 'PENDING',
      created_at: c.created_at ? formatDateTime12h(c.created_at) : 'N/A'
    }));
    exportToCsv({
      filename: `hostelguard_corrections_${getTodayDateIST()}`,
      headers,
      data
    });
  };

  const handleExportExcel = () => {
    if (!corrections || corrections.length === 0) return;
    const headers = [
      { key: 'roll_number', label: 'Roll Number' },
      { key: 'full_name', label: 'Student Name' },
      { key: 'date', label: 'Target Date' },
      { key: 'requested_status', label: 'Requested Status' },
      { key: 'reason', label: 'Reason' },
      { key: 'status', label: 'Decision Status' },
      { key: 'created_at', label: 'Submitted On (IST)' }
    ];
    const data = corrections.map(c => ({
      roll_number: c.roll_number || '',
      full_name: c.full_name || '',
      date: c.date || '',
      requested_status: c.requested_status || '',
      reason: c.reason || '',
      status: c.status || 'PENDING',
      created_at: c.created_at ? formatDateTime12h(c.created_at) : 'N/A'
    }));
    exportToExcel({
      filename: `hostelguard_corrections_${getTodayDateIST()}`,
      sheetName: 'Corrections',
      headers,
      data
    });
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'PENDING':
        return <span className="badge bg-warning-subtle text-warning border border-warning-subtle px-2 py-1"><Clock size={12} className="me-1 inline" /> Pending</span>;
      case 'APPROVED':
        return <span className="badge bg-success-subtle text-success border border-success-subtle px-2 py-1"><CheckCircle2 size={12} className="me-1 inline" /> Approved</span>;
      case 'REJECTED':
        return <span className="badge bg-danger-subtle text-danger border border-danger-subtle px-2 py-1"><XCircle size={12} className="me-1 inline" /> Rejected</span>;
      default:
        return <span className="badge bg-light text-dark">{status}</span>;
    }
  };

  return (
    <div className="container-fluid px-0">
      {/* Page Title */}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-2">
        <div>
          <h4 className="fw-bold mb-1 d-flex align-items-center gap-2">
            <FileCheck2 className="text-primary" size={24} />
            Student Attendance Correction Desk
          </h4>
          <p className="text-muted small mb-0">
            Formal appeal workflow for students contesting attendance marks due to medical leaves, technical outages, or sanctioned absences.
          </p>
        </div>
        <div className="d-flex gap-2 flex-wrap">
          <button
            className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
            onClick={handleExportCsv}
            disabled={corrections.length === 0}
            title="Export Correction Requests as CSV"
          >
            <Download size={14} /> Export CSV
          </button>
          <button
            className="btn btn-outline-success btn-sm d-flex align-items-center gap-1"
            onClick={handleExportExcel}
            disabled={corrections.length === 0}
            title="Export Correction Requests as Excel (.xlsx)"
          >
            <FileSpreadsheet size={14} /> Export Excel (.xlsx)
          </button>
          <button
            className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
            onClick={fetchCorrections}
            disabled={loading}
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            className="btn btn-outline-danger btn-sm d-flex align-items-center gap-1"
            onClick={() => setShowClearModal(true)}
            disabled={loading || corrections.length === 0}
          >
            <Trash2 size={14} /> Clear All Requests
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

      {/* Category Tabs: Attendance Corrections vs Biometric Face Update Requests */}
      <div className="d-flex gap-2 mb-3">
        <button
          type="button"
          className={`btn btn-sm ${activeSubTab === 'corrections' ? 'btn-primary' : 'btn-outline-secondary'} fw-medium d-inline-flex align-items-center gap-1.5`}
          onClick={() => setActiveSubTab('corrections')}
        >
          <FileCheck2 size={15} />
          <span>Attendance Appeals</span>
          <span className="badge bg-secondary-subtle text-dark ms-1 hg-tabular">{corrections.length}</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm ${activeSubTab === 'face_updates' ? 'btn-primary' : 'btn-outline-secondary'} fw-medium d-inline-flex align-items-center gap-1.5`}
          onClick={() => {
            setActiveSubTab('face_updates');
            fetchFaceRequests();
          }}
        >
          <ShieldCheck size={15} />
          <span>Biometric Face Update Requests</span>
          <span className="badge bg-secondary-subtle text-dark ms-1 hg-tabular">{faceRequests.length}</span>
        </button>
      </div>

      {activeSubTab === 'corrections' && (
        <>
          {/* Filter Tabs */}
      <div className="card shadow-sm border-0 rounded-3 mb-4">
        <div className="card-body p-2">
          <div className="d-flex gap-2">
            <button
              className={`btn btn-sm ${selectedStatus === 'PENDING' ? 'btn-primary' : 'btn-light'}`}
              onClick={() => setSelectedStatus('PENDING')}
            >
              Pending Review
            </button>
            <button
              className={`btn btn-sm ${selectedStatus === 'APPROVED' ? 'btn-primary' : 'btn-light'}`}
              onClick={() => setSelectedStatus('APPROVED')}
            >
              Approved
            </button>
            <button
              className={`btn btn-sm ${selectedStatus === 'REJECTED' ? 'btn-primary' : 'btn-light'}`}
              onClick={() => setSelectedStatus('REJECTED')}
            >
              Rejected
            </button>
            <button
              className={`btn btn-sm ${selectedStatus === '' ? 'btn-primary' : 'btn-light'}`}
              onClick={() => setSelectedStatus('')}
            >
              All Requests
            </button>
          </div>
        </div>
      </div>

      {/* Corrections Table */}
      <div className="card shadow-sm border-0 rounded-3">
        <div className="card-header bg-white border-bottom py-3">
          <h6 className="card-title mb-0 fw-semibold">
            Correction Requests ({corrections.length})
          </h6>
        </div>
        <div className="card-body p-0">
          {loading ? (
            <div className="text-center p-5">
              <div className="spinner-border text-primary mb-2" role="status"></div>
              <p className="text-muted small mb-0">Loading student appeals...</p>
            </div>
          ) : corrections.length === 0 ? (
            <div className="text-center p-5 text-muted">
              <FileCheck2 size={40} className="mb-2 text-muted opacity-50" />
              <p className="mb-0">No correction requests found under this status filter.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead className="table-light">
                  <tr className="small text-muted">
                    <th className="ps-3">Student</th>
                    <th>Target Date</th>
                    <th>Requested Status</th>
                    <th>Student Justification</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th className="text-end pe-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {corrections.map((req) => (
                    <tr key={req.id}>
                      <td className="ps-3">
                        <div className="fw-medium text-dark">{req.full_name}</div>
                        <code className="small">{req.roll_no || req.roll_number}</code>
                      </td>
                      <td>
                        <span className="fw-semibold text-primary">{req.date}</span>
                      </td>
                      <td>
                        <span className="badge bg-light text-dark">{req.requested_status || 'PRESENT'}</span>
                      </td>
                      <td style={{ maxWidth: '300px' }}>
                        <div className="text-dark small text-truncate" title={req.reason}>
                          {req.reason}
                        </div>
                        {(req.review_notes || req.resolution_note) && (
                          <div className="text-muted small mt-1 fst-italic">
                            Admin Note: {req.review_notes || req.resolution_note}
                          </div>
                        )}
                      </td>
                      <td>{getStatusBadge(req.status)}</td>
                      <td>
                        <small className="text-muted">
                          {req.created_at ? formatDateTime12h(req.created_at) : 'N/A'}
                        </small>
                      </td>
                      <td className="text-end pe-3">
                        <div className="d-flex justify-content-end align-items-center gap-1">
                          {req.status === 'PENDING' ? (
                            <button
                              className="btn btn-sm btn-primary py-0 px-2"
                              style={{ fontSize: '12px' }}
                              onClick={() => openReviewModal(req)}
                            >
                              Review
                            </button>
                          ) : (
                            <button
                              className="btn btn-sm btn-outline-secondary py-0 px-2"
                              style={{ fontSize: '12px' }}
                              onClick={() => openReviewModal(req)}
                            >
                              Re-evaluate
                            </button>
                          )}
                          <button
                            className="btn btn-sm btn-outline-danger p-1"
                            title="Delete request"
                            style={{ lineHeight: 1 }}
                            disabled={deletingId === req.id}
                            onClick={() => handleDeleteSingle(req.id, req.roll_no || req.roll_number)}
                          >
                            <Trash2 size={13} />
                          </button>
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

  {activeSubTab === 'face_updates' && (
    <>
      {/* Face Updates Filter Tabs */}
      <div className="card shadow-sm border-0 rounded-3 mb-4">
        <div className="card-body p-2">
          <div className="d-flex gap-2">
            <button
              className={`btn btn-sm ${faceSelectedStatus === 'PENDING' ? 'btn-primary' : 'btn-light'}`}
              onClick={() => setFaceSelectedStatus('PENDING')}
            >
              Pending Review
            </button>
            <button
              className={`btn btn-sm ${faceSelectedStatus === 'APPROVED' ? 'btn-primary' : 'btn-light'}`}
              onClick={() => setFaceSelectedStatus('APPROVED')}
            >
              Approved
            </button>
            <button
              className={`btn btn-sm ${faceSelectedStatus === 'REJECTED' ? 'btn-primary' : 'btn-light'}`}
              onClick={() => setFaceSelectedStatus('REJECTED')}
            >
              Rejected
            </button>
            <button
              className={`btn btn-sm ${faceSelectedStatus === 'ALL' ? 'btn-primary' : 'btn-light'}`}
              onClick={() => setFaceSelectedStatus('ALL')}
            >
              All Requests
            </button>
          </div>
        </div>
      </div>

      {/* Face Requests Table */}
      <div className="card shadow-sm border-0 rounded-3">
        <div className="card-header bg-white border-bottom py-3">
          <h6 className="card-title mb-0 fw-semibold d-flex align-items-center gap-2">
            <ShieldCheck size={16} className="text-primary" />
            Biometric Face Re-enrollment Approvals ({faceRequests.length})
          </h6>
        </div>
        <div className="card-body p-0">
          {faceLoading ? (
            <div className="text-center p-5">
              <div className="spinner-border text-primary mb-2" role="status"></div>
              <p className="text-muted small mb-0">Loading face update requests...</p>
            </div>
          ) : faceRequests.length === 0 ? (
            <div className="text-center p-5 text-muted">
              <ShieldCheck size={40} className="mb-2 text-muted opacity-50" />
              <p className="mb-0">No face update requests found under this status filter.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead className="table-light">
                  <tr className="small text-muted">
                    <th className="ps-3">Student</th>
                    <th>Hostel &amp; Room</th>
                    <th>Justification Reason</th>
                    <th>Submitted</th>
                    <th>Status</th>
                    <th className="text-end pe-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {faceRequests.map((req) => (
                    <tr key={req.id}>
                      <td className="ps-3">
                        <div className="fw-medium text-dark">{req.full_name}</div>
                        <code className="small">{req.roll_number}</code>
                      </td>
                      <td>
                        <span className="badge bg-light text-dark">{req.hostel_block} - Rm {req.room_number || 'N/A'}</span>
                      </td>
                      <td style={{ maxWidth: '300px' }}>
                        <div className="text-dark small text-truncate" title={req.reason}>
                          {req.reason}
                        </div>
                        {req.rejection_reason && (
                          <div className="text-danger small mt-1">
                            Rejection Note: {req.rejection_reason}
                          </div>
                        )}
                      </td>
                      <td>
                        <small className="text-muted">
                          {req.created_at ? formatDateTime12h(req.created_at) : 'N/A'}
                        </small>
                      </td>
                      <td>
                        <span className={`badge ${req.status === 'APPROVED' ? 'bg-success-subtle text-success border border-success-subtle' : req.status === 'COMPLETED' ? 'bg-info-subtle text-info border border-info-subtle' : req.status === 'REJECTED' ? 'bg-danger-subtle text-danger border border-danger-subtle' : 'bg-warning-subtle text-warning border border-warning-subtle'}`}>
                          {req.status}
                        </span>
                      </td>
                      <td className="text-end pe-3">
                        {req.status === 'PENDING' ? (
                          <div className="d-flex justify-content-end align-items-center gap-1">
                            <button
                              className="btn btn-sm btn-outline-success py-0 px-2"
                              style={{ fontSize: '12px' }}
                              onClick={() => openFaceReviewModal(req, 'APPROVED')}
                            >
                              Approve
                            </button>
                            <button
                              className="btn btn-sm btn-outline-danger py-0 px-2"
                              style={{ fontSize: '12px' }}
                              onClick={() => openFaceReviewModal(req, 'REJECTED')}
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <button
                            className="btn btn-sm btn-outline-secondary py-0 px-2"
                            style={{ fontSize: '12px' }}
                            onClick={() => openFaceReviewModal(req, req.status === 'REJECTED' ? 'REJECTED' : 'APPROVED')}
                          >
                            Re-evaluate
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
    </>
  )}

  {/* Review Modal */}
      {showReviewModal && selectedReq && (
        <div className="modal show d-block hg-modal-backdrop" tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content hg-card rounded-2 border-0 shadow">
              <div className="modal-header border-bottom py-2.5 px-3">
                <h6 className="modal-title fw-bold d-flex align-items-center gap-2 mb-0">
                  <FileCheck2 size={16} className="text-primary" />
                  Review Attendance Correction Request
                </h6>
                <button type="button" className="btn-close" onClick={() => setShowReviewModal(false)}></button>
              </div>
              <form onSubmit={handleReviewSubmit}>
                <div className="modal-body p-4">
                  <div className="mb-3">
                    <label className="form-label small text-muted mb-0">Applicant Student</label>
                    <div className="fw-semibold text-dark">{selectedReq.full_name} ({selectedReq.roll_no})</div>
                    <div className="small text-muted">Contested Date: <strong>{selectedReq.date}</strong></div>
                  </div>

                  <div className="mb-3 p-3 bg-light rounded-3">
                    <label className="form-label small text-muted mb-1 d-flex align-items-center gap-1">
                      <MessageSquare size={14} /> Student's Submitted Statement:
                    </label>
                    <div className="small text-dark">{selectedReq.reason}</div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small fw-medium">Administrative Decision</label>
                    <select
                      className="form-select form-select-sm"
                      value={reviewDecision}
                      onChange={(e) => setReviewDecision(e.target.value)}
                      required
                    >
                      <option value="APPROVED">Approve (Mark Present in Database)</option>
                      <option value="REJECTED">Reject Request</option>
                    </select>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small fw-medium">
                      Reviewer Notes / Rationale <span className="text-danger">*</span>
                    </label>
                    <textarea
                      className="form-control"
                      rows="3"
                      placeholder="e.g., Medical leave slip verified by hostel physician on 14-Oct."
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="modal-footer border-top">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => setShowReviewModal(false)}
                    disabled={submittingReview}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`btn btn-sm ${reviewDecision === 'APPROVED' ? 'btn-success' : 'btn-danger'}`}
                    disabled={submittingReview}
                  >
                    {submittingReview ? 'Submitting...' : `Confirm ${reviewDecision}`}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Clear All Confirmation Modal */}
      {showClearModal && (
        <div className="modal show d-block hg-modal-backdrop" tabIndex="-1" style={{ zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content hg-card rounded-2 border-0 shadow">
              <div className="modal-header border-bottom py-2.5 px-3 bg-danger-subtle text-danger">
                <h6 className="modal-title fw-bold d-flex align-items-center gap-2">
                  <Trash2 size={18} />
                  Confirm Clear Correction Requests
                </h6>
                <button type="button" className="btn-close" onClick={() => setShowClearModal(false)}></button>
              </div>
              <div className="modal-body p-4">
                <p className="mb-2">
                  Are you sure you want to delete {selectedStatus ? <strong>all {selectedStatus}</strong> : 'all'} attendance correction requests?
                </p>
                <div className="text-muted small">
                  This will permanently delete {corrections.length} record(s) from the database to purge stale garbage data. This action cannot be undone.
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
                  onClick={handleClearAll}
                  disabled={clearingAll}
                >
                  <Trash2 size={14} />
                  {clearingAll ? 'Clearing Records...' : 'Yes, Delete All'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Face Review Modal */}
      {showFaceReviewModal && selectedFaceReq && (
        <div className="modal show d-block hg-modal-backdrop" tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content hg-card rounded-2 border-0 shadow">
              <div className="modal-header border-bottom py-2.5 px-3">
                <h6 className="modal-title fw-bold d-flex align-items-center gap-2 mb-0">
                  <ShieldCheck size={16} className="text-primary" />
                  Review Face Re-enrollment Authorization
                </h6>
                <button type="button" className="btn-close" onClick={() => setShowFaceReviewModal(false)}></button>
              </div>
              <form onSubmit={handleFaceReviewSubmit}>
                <div className="modal-body p-4">
                  <div className="mb-3">
                    <label className="form-label small text-muted mb-0">Applicant Student</label>
                    <div className="fw-semibold text-dark">{selectedFaceReq.full_name} ({selectedFaceReq.roll_number})</div>
                    <div className="small text-muted">{selectedFaceReq.hostel_block} &bull; Room {selectedFaceReq.room_number || 'N/A'}</div>
                  </div>

                  <div className="mb-3 p-3 bg-light rounded-3">
                    <label className="form-label small text-muted mb-1 d-flex align-items-center gap-1">
                      <MessageSquare size={14} /> Student's Justification:
                    </label>
                    <div className="small text-dark">{selectedFaceReq.reason}</div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small fw-semibold">Administrative Decision</label>
                    <div className="d-flex gap-3">
                      <div className="form-check">
                        <input
                          className="form-check-input"
                          type="radio"
                          name="faceDecision"
                          id="faceApprove"
                          value="APPROVED"
                          checked={faceReviewDecision === 'APPROVED'}
                          onChange={() => setFaceReviewDecision('APPROVED')}
                        />
                        <label className="form-check-label text-success fw-medium" htmlFor="faceApprove">
                          Approve (Authorize One-Time Re-enrollment)
                        </label>
                      </div>
                      <div className="form-check">
                        <input
                          className="form-check-input"
                          type="radio"
                          name="faceDecision"
                          id="faceReject"
                          value="REJECTED"
                          checked={faceReviewDecision === 'REJECTED'}
                          onChange={() => setFaceReviewDecision('REJECTED')}
                        />
                        <label className="form-check-label text-danger fw-medium" htmlFor="faceReject">
                          Reject
                        </label>
                      </div>
                    </div>
                  </div>

                  {faceReviewDecision === 'REJECTED' && (
                    <div className="mb-3">
                      <label className="form-label small fw-semibold">
                        Rejection Reason <span className="text-danger">*</span>
                      </label>
                      <textarea
                        className="form-control form-control-sm"
                        rows="2"
                        placeholder="State why the face update request is being denied..."
                        value={faceReviewNotes}
                        onChange={(e) => setFaceReviewNotes(e.target.value)}
                        required
                      />
                    </div>
                  )}
                </div>
                <div className="modal-footer border-top bg-light py-2">
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => setShowFaceReviewModal(false)}
                    disabled={submittingFaceReview}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`btn btn-sm ${faceReviewDecision === 'APPROVED' ? 'btn-success' : 'btn-danger'}`}
                    disabled={submittingFaceReview}
                  >
                    {submittingFaceReview ? 'Submitting...' : `Confirm ${faceReviewDecision}`}
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
