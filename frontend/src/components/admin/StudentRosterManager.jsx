import React, { useState, useEffect } from 'react';
import { api } from '../../utils/api';
import {
  Users,
  Search,
  Upload,
  Filter,
  CheckCircle,
  AlertTriangle,
  Eye,
  Edit2,
  FileSpreadsheet,
  X,
  Check,
  RefreshCw,
  Plus
} from 'lucide-react';

export default function StudentRosterManager() {
  const [students, setStudents] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [blockFilter, setBlockFilter] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  // Modals state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [commitLoading, setCommitLoading] = useState(false);

  const [selectedStudent, setSelectedStudent] = useState(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editFormData, setEditFormData] = useState({});

  const showFeedback = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: '', type: 'success' }), 4000);
  };

  const loadStudents = async () => {
    try {
      setLoading(true);
      const res = await api.admin.getStudents({
        search,
        block: blockFilter,
        course: courseFilter,
        page,
        limit: 15
      });
      if (res.success) {
        setStudents(res.students);
        setTotalCount(res.totalCount);
        setTotalPages(res.totalPages || 1);
      }
    } catch (err) {
      showFeedback(err.message || 'Failed to fetch student roster', 'danger');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStudents();
  }, [page, blockFilter, courseFilter]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    loadStudents();
  };

  // Preview CSV upload
  const handleFilePreview = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      setPreviewLoading(true);
      setPreviewData(null);
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.admin.previewRosterUpload(formData);
      setPreviewData(res);
    } catch (err) {
      showFeedback(err.message || 'CSV Preview failed', 'danger');
    } finally {
      setPreviewLoading(false);
    }
  };

  // Commit verified records
  const handleCommitImport = async () => {
    if (!previewData?.validRecords || previewData.validRecords.length === 0) return;

    try {
      setCommitLoading(true);
      const res = await api.admin.commitRosterUpload(previewData.validRecords);
      showFeedback(res.message, 'success');
      setShowUploadModal(false);
      setPreviewData(null);
      loadStudents();
    } catch (err) {
      showFeedback(err.message || 'Failed to commit allotment import', 'danger');
    } finally {
      setCommitLoading(false);
    }
  };

  // Quick Seed Sample Students
  const handleSeedSamples = async () => {
    const samples = [
      { roll_number: '2023CS01', full_name: 'Aarav Sharma', room_number: 'A-101', hostel_block: 'Block A' },
      { roll_number: '2023CS02', full_name: 'Ananya Patel', room_number: 'A-102', hostel_block: 'Block A' },
      { roll_number: '2023EC01', full_name: 'Rohan Verma', room_number: 'A-103', hostel_block: 'Block A' },
      { roll_number: '2023ME05', full_name: 'Diya Sen', room_number: 'B-201', hostel_block: 'Block B' },
      { roll_number: '2023IT12', full_name: 'Kabir Mehta', room_number: 'B-202', hostel_block: 'Block B' },
      { roll_number: '2023CS99', full_name: 'Ishita Roy', room_number: 'B-203', hostel_block: 'Block B' }
    ];

    try {
      setLoading(true);
      const preview = await api.admin.previewRosterUpload({ allotments: samples });
      if (preview.validRecords.length > 0) {
        const res = await api.admin.commitRosterUpload(preview.validRecords);
        showFeedback(res.message, 'success');
        loadStudents();
      } else {
        showFeedback('All sample students already exist on the roster.', 'info');
      }
    } catch (err) {
      showFeedback(err.message, 'danger');
    } finally {
      setLoading(false);
    }
  };

  // Open Edit Modal
  const openEditModal = (student) => {
    setSelectedStudent(student);
    setEditFormData({
      course: student.course,
      semester: student.semester,
      room_number: student.room_number || '',
      hostel_block: student.hostel_block || '',
      phone: student.phone || '',
      email: student.email || '',
      is_active: student.is_active === 1
    });
    setShowEditModal(true);
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    try {
      await api.admin.updateStudent(selectedStudent.id, editFormData);
      showFeedback('Student record updated successfully.', 'success');
      setShowEditModal(false);
      loadStudents();
    } catch (err) {
      showFeedback(err.message, 'danger');
    }
  };

  return (
    <div className="container-fluid p-4">
      {/* Toast */}
      {toast.show && (
        <div className={`alert alert-${toast.type} alert-dismissible fade show mb-3`} role="alert">
          {toast.message}
          <button type="button" className="btn-close" onClick={() => setToast({ show: false, message: '', type: 'success' })}></button>
        </div>
      )}

      {/* Header */}
      <div className="d-flex align-items-center justify-content-between mb-4 flex-wrap gap-2">
        <div>
          <h4 className="fw-bold mb-1">Student Roster & Allotment Management</h4>
          <p className="text-muted mb-0" style={{ fontSize: '13px' }}>
            Official administration list. Students select from this roster during onboarding.
          </p>
        </div>
        <div className="d-flex align-items-center gap-2">
          <button onClick={() => setShowUploadModal(true)} className="btn btn-sm btn-primary d-flex align-items-center gap-1">
            <Upload size={14} /> Import CSV Roster
          </button>
          <button onClick={handleSeedSamples} className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1">
            <Plus size={14} /> Load Demo Allotments
          </button>
        </div>
      </div>

      {/* Filters & Search Bar */}
      <div className="hg-card mb-3">
        <div className="hg-card-body p-3">
          <form onSubmit={handleSearchSubmit} className="row g-2 align-items-center">
            <div className="col-12 col-md-5">
              <div className="input-group input-group-sm">
                <span className="input-group-text bg-white"><Search size={14} /></span>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Search by student name or roll number..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="col-6 col-md-3">
              <select
                className="form-select form-select-sm"
                value={blockFilter}
                onChange={(e) => { setBlockFilter(e.target.value); setPage(1); }}
              >
                <option value="">All Hostel Blocks</option>
                <option value="Block A">Block A</option>
                <option value="Block B">Block B</option>
                <option value="Block C">Block C</option>
              </select>
            </div>

            <div className="col-6 col-md-3">
              <select
                className="form-select form-select-sm"
                value={courseFilter}
                onChange={(e) => { setCourseFilter(e.target.value); setPage(1); }}
              >
                <option value="">All Programs / Courses</option>
                <option value="B.Tech Computer Science">B.Tech Computer Science</option>
                <option value="B.Tech Information Technology">B.Tech IT</option>
                <option value="B.Tech Electronics & Comm">B.Tech ECE</option>
                <option value="B.Tech Mechanical Engineering">B.Tech ME</option>
              </select>
            </div>

            <div className="col-12 col-md-1">
              <button type="submit" className="btn btn-sm btn-primary w-100">
                Filter
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Student Table */}
      <div className="hg-card">
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead>
              <tr>
                <th>Roll Number</th>
                <th>Full Name</th>
                <th>Course / Year</th>
                <th>Block & Room</th>
                <th>Device ID</th>
                <th>Biometrics</th>
                <th>Status</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="8" className="text-center py-4 text-muted">
                    <div className="spinner-border spinner-border-sm me-2 text-primary" role="status"></div>
                    Loading student roster...
                  </td>
                </tr>
              ) : students.length > 0 ? (
                students.map((st) => (
                  <tr key={st.id}>
                    <td className="font-mono fw-bold text-primary">{st.roll_number}</td>
                    <td className="fw-semibold">{st.full_name}</td>
                    <td style={{ fontSize: '12px' }}>
                      {st.course} <span className="text-muted">(Sem {st.semester})</span>
                    </td>
                    <td>
                      <span className="badge bg-light text-dark font-mono">
                        {st.hostel_block || 'N/A'} &bull; {st.room_number || 'N/A'}
                      </span>
                    </td>
                    <td className="font-mono text-muted" style={{ fontSize: '11px' }}>
                      {st.device_id ? st.device_id.slice(0, 14) + '...' : 'Pending'}
                    </td>
                    <td>
                      {st.embeddings_count > 0 ? (
                        <span className="badge-soft-success">
                          <Check size={12} className="me-1" />
                          {st.embeddings_count} Vectors
                        </span>
                      ) : (
                        <span className="badge-soft-warning">Pending Face</span>
                      )}
                    </td>
                    <td>
                      {st.is_active ? (
                        <span className="badge bg-success">Active</span>
                      ) : (
                        <span className="badge bg-secondary">Deactivated</span>
                      )}
                    </td>
                    <td className="text-end">
                      <div className="btn-group btn-group-sm">
                        <button
                          onClick={() => { setSelectedStudent(st); setShowViewModal(true); }}
                          className="btn btn-outline-secondary"
                          title="View Details"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          onClick={() => openEditModal(st)}
                          className="btn btn-outline-primary"
                          title="Edit Student"
                        >
                          <Edit2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="8" className="text-center py-4 text-muted">
                    No students found matching your search. Click "Import CSV Roster" or "Load Demo Allotments".
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="hg-card-body d-flex align-items-center justify-content-between py-2 border-top">
          <span className="text-muted" style={{ fontSize: '12px' }}>
            Showing {students.length} of {totalCount} registered students
          </span>
          <div className="btn-group btn-group-sm">
            <button
              className="btn btn-outline-secondary"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <span className="btn btn-light disabled text-dark" style={{ fontSize: '12px' }}>
              Page {page} of {totalPages}
            </span>
            <button
              className="btn btn-outline-secondary"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* MODAL 1: CSV Upload with Validation Preview */}
      {showUploadModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title fw-bold">Upload Hostel Allotment Roster (CSV)</h5>
                <button type="button" className="btn-close" onClick={() => { setShowUploadModal(false); setPreviewData(null); }}></button>
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label fw-semibold" style={{ fontSize: '13px' }}>
                    Select CSV File (Columns: roll_number, full_name, room_number, hostel_block)
                  </label>
                  <input
                    type="file"
                    className="form-control form-control-sm"
                    accept=".csv"
                    onChange={handleFilePreview}
                    disabled={previewLoading || commitLoading}
                  />
                  <small className="text-muted">Upload will be validated for conflicts before committing to database.</small>
                </div>

                {previewLoading && (
                  <div className="text-center py-4">
                    <div className="spinner-border spinner-border-sm text-primary me-2"></div>
                    Validating CSV records & detecting conflicts...
                  </div>
                )}

                {previewData && (
                  <div>
                    <div className="d-flex gap-2 mb-3">
                      <span className="badge bg-success p-2">Valid Records: {previewData.validCount}</span>
                      <span className="badge bg-danger p-2">Conflicts / Duplicates: {previewData.conflictCount}</span>
                      <span className="badge bg-secondary p-2">Total Submitted: {previewData.totalSubmitted}</span>
                    </div>

                    {previewData.conflictRecords.length > 0 && (
                      <div className="alert alert-warning p-2 mb-3" style={{ fontSize: '12px' }}>
                        <strong>Conflicts Found:</strong>
                        <ul className="mb-0 ps-3">
                          {previewData.conflictRecords.map((c, i) => (
                            <li key={i}>{c.roll_number} ({c.full_name}): {c.issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <h6 className="fw-bold" style={{ fontSize: '13px' }}>Valid Records Ready to Commit:</h6>
                    <div className="table-responsive" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                      <table className="table table-sm table-bordered" style={{ fontSize: '12px' }}>
                        <thead>
                          <tr>
                            <th>Roll Number</th>
                            <th>Student Name</th>
                            <th>Room No</th>
                            <th>Hostel Block</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previewData.validRecords.map((r, i) => (
                            <tr key={i}>
                              <td className="font-mono text-primary">{r.roll_number}</td>
                              <td>{r.full_name}</td>
                              <td>{r.room_number}</td>
                              <td>{r.hostel_block}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => { setShowUploadModal(false); setPreviewData(null); }}>
                  Cancel
                </button>
                {previewData && previewData.validCount > 0 && (
                  <button
                    type="button"
                    className="btn btn-sm btn-success"
                    onClick={handleCommitImport}
                    disabled={commitLoading}
                  >
                    {commitLoading ? 'Committing...' : `Commit ${previewData.validCount} Valid Records`}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: View Student Details */}
      {showViewModal && selectedStudent && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title fw-bold">Student Identity Details</h5>
                <button type="button" className="btn-close" onClick={() => setShowViewModal(false)}></button>
              </div>
              <div className="modal-body" style={{ fontSize: '13px' }}>
                <div className="mb-2"><strong>Roll Number:</strong> <span className="font-mono text-primary">{selectedStudent.roll_number}</span></div>
                <div className="mb-2"><strong>Full Name:</strong> {selectedStudent.full_name}</div>
                <div className="mb-2"><strong>Course / Degree:</strong> {selectedStudent.course}</div>
                <div className="mb-2"><strong>Admission Year:</strong> {selectedStudent.admission_year} | Semester: {selectedStudent.semester}</div>
                <div className="mb-2"><strong>Hostel Room:</strong> {selectedStudent.hostel_block} &bull; Room {selectedStudent.room_number}</div>
                <div className="mb-2"><strong>Hardware Device ID:</strong> <span className="font-mono text-muted">{selectedStudent.device_id}</span></div>
                <div className="mb-2"><strong>Failed Location Strikes:</strong> {selectedStudent.failed_attempts} / 3</div>
                <div className="mb-2">
                  <strong>Forge Location Status:</strong>{' '}
                  {selectedStudent.is_flagged_forge ? (
                    <span className="badge bg-danger">Flagged Forge Location</span>
                  ) : (
                    <span className="badge bg-success">Clear</span>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setShowViewModal(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Edit Student */}
      {showEditModal && selectedStudent && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog">
            <form onSubmit={handleSaveEdit} className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title fw-bold">Edit Student Details</h5>
                <button type="button" className="btn-close" onClick={() => setShowEditModal(false)}></button>
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label" style={{ fontSize: '12px' }}>Full Name (Locked to Roster)</label>
                  <input type="text" className="form-control form-control-sm" value={selectedStudent.full_name} disabled />
                </div>
                <div className="row g-2 mb-3">
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: '12px' }}>Hostel Block</label>
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      value={editFormData.hostel_block}
                      onChange={(e) => setEditFormData({ ...editFormData, hostel_block: e.target.value })}
                    />
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: '12px' }}>Room Number</label>
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      value={editFormData.room_number}
                      onChange={(e) => setEditFormData({ ...editFormData, room_number: e.target.value })}
                    />
                  </div>
                </div>
                <div className="row g-2 mb-3">
                  <div className="col-8">
                    <label className="form-label" style={{ fontSize: '12px' }}>Course / Program</label>
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      value={editFormData.course}
                      onChange={(e) => setEditFormData({ ...editFormData, course: e.target.value })}
                    />
                  </div>
                  <div className="col-4">
                    <label className="form-label" style={{ fontSize: '12px' }}>Semester</label>
                    <input
                      type="number"
                      className="form-control form-control-sm"
                      value={editFormData.semester}
                      onChange={(e) => setEditFormData({ ...editFormData, semester: e.target.value })}
                    />
                  </div>
                </div>
                <div className="form-check">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    id="isActiveCheck"
                    checked={editFormData.is_active}
                    onChange={(e) => setEditFormData({ ...editFormData, is_active: e.target.checked })}
                  />
                  <label className="form-check-label" htmlFor="isActiveCheck" style={{ fontSize: '13px' }}>
                    Active Student Resident
                  </label>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setShowEditModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-sm btn-primary">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
