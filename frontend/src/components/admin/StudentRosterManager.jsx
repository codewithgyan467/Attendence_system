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
  Plus,
  Key,
  KeyRound,
  Copy,
  ExternalLink,
  Shield,
  Lock,
  Mail,
  Phone,
  UserPlus,
  Trash2,
  FileText,
  Download,
  Sparkles
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
  const [preCreateLogins, setPreCreateLogins] = useState(true);

  // Manual Add Student Modal state
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualFormData, setManualFormData] = useState({
    roll_number: '',
    full_name: '',
    room_number: 'A-101',
    hostel_block: 'Block A',
    email: '',
    phone: '',
    course: 'B.Tech Computer Science',
    admission_year: new Date().getFullYear(),
    semester: 1,
    create_login: true,
    default_password: 'Student@12345'
  });
  const [manualLoading, setManualLoading] = useState(false);

  // Clear All Students Modal state
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);

  const [selectedStudent, setSelectedStudent] = useState(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editFormData, setEditFormData] = useState({});

  // Credentials & Password Hub state
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [credentialsData, setCredentialsData] = useState(null);
  const [credentialsLoading, setCredentialsLoading] = useState(false);
  const [credentialsTab, setCredentialsTab] = useState('students');
  const [copiedId, setCopiedId] = useState(null);

  // Admin Single-Student Password Reset Modal
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetTargetStudent, setResetTargetStudent] = useState(null);
  const [resetPasswordInput, setResetPasswordInput] = useState('Student@12345');
  const [resetPasswordReason, setResetPasswordReason] = useState('Administrative credential recovery');
  const [resetLoading, setResetLoading] = useState(false);

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

  // Commit verified records (Excel, Word, CSV)
  const handleCommitImport = async () => {
    if (!previewData?.validRecords || previewData.validRecords.length === 0) return;

    try {
      setCommitLoading(true);
      const res = await api.admin.commitRosterUpload(previewData.validRecords, preCreateLogins);
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

  // 1. Download Official Excel Roster Template (.xlsx)
  const handleDownloadExcelTemplate = async () => {
    try {
      const XLSX = await import('xlsx');
      const sampleRows = [
        {
          'Roll Number': '2024CS01',
          'Full Name': 'Aditya Sharma',
          'Room Number': 'A-101',
          'Hostel Block': 'Block A',
          'Email': 'aditya.sharma@example.edu',
          'Phone': '+919876543210',
          'Course': 'B.Tech Computer Science',
          'Admission Year': 2024,
          'Semester': 1
        },
        {
          'Roll Number': '2024CS02',
          'Full Name': 'Priya Nair',
          'Room Number': 'A-102',
          'Hostel Block': 'Block A',
          'Email': 'priya.nair@example.edu',
          'Phone': '+919876543211',
          'Course': 'B.Tech Computer Science',
          'Admission Year': 2024,
          'Semester': 1
        },
        {
          'Roll Number': '2024EC01',
          'Full Name': 'Rahul Verma',
          'Room Number': 'B-201',
          'Hostel Block': 'Block B',
          'Email': 'rahul.verma@example.edu',
          'Phone': '+919876543212',
          'Course': 'B.Tech Electronics & Comm',
          'Admission Year': 2024,
          'Semester': 1
        }
      ];

      const ws = XLSX.utils.json_to_sheet(sampleRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'StudentRoster');
      XLSX.writeFile(wb, 'hostelguard_student_roster_template.xlsx');
      showFeedback('Official Excel Template (.xlsx) downloaded successfully!', 'success');
    } catch (err) {
      showFeedback('Failed to generate Excel template: ' + err.message, 'danger');
    }
  };

  // 2. Download Official CSV Roster Template (.csv)
  const handleDownloadCsvTemplate = () => {
    const csvContent =
      "Roll Number,Full Name,Room Number,Hostel Block,Email,Phone,Course,Admission Year,Semester\n" +
      "2024CS01,Aditya Sharma,A-101,Block A,aditya.sharma@example.edu,+919876543210,B.Tech Computer Science,2024,1\n" +
      "2024CS02,Priya Nair,A-102,Block A,priya.nair@example.edu,+919876543211,B.Tech Computer Science,2024,1\n" +
      "2024EC01,Rahul Verma,B-201,Block B,rahul.verma@example.edu,+919876543212,B.Tech Electronics & Comm,2024,1\n";

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', 'hostelguard_student_roster_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showFeedback('CSV Template (.csv) downloaded successfully!', 'success');
  };

  // 3. Download Word / Document Roster Template (.docx format preview)
  const handleDownloadDocTemplate = () => {
    const docContent =
      "HOSTELGUARD STUDENT ROSTER IMPORT GUIDE & WORD TEMPLATE\n" +
      "========================================================================\n\n" +
      "Instructions for Warden / Admin:\n" +
      "1. You can paste a table or line-separated student list directly into Microsoft Word (.docx).\n" +
      "2. Ensure each row contains: Roll Number, Full Name, Room Number, Hostel Block, Email, Phone.\n" +
      "3. Real OTP authentication will use the Email and Mobile Phone specified for each student.\n\n" +
      "Sample Table Format:\n" +
      "Roll Number\tFull Name\tRoom Number\tHostel Block\tEmail\tPhone\n" +
      "2024CS01\tAditya Sharma\tA-101\tBlock A\taditya.sharma@example.edu\t+919876543210\n" +
      "2024CS02\tPriya Nair\tA-102\tBlock A\tpriya.nair@example.edu\t+919876543211\n" +
      "2024EC01\tRahul Verma\tB-201\tBlock B\trahul.verma@example.edu\t+919876543212\n";

    const blob = new Blob([docContent], { type: 'text/plain;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', 'hostelguard_student_roster_template.docx');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showFeedback('Word/Document Template guide (.docx) downloaded successfully!', 'success');
  };

  // 4. Handle Manual Single Student Registration
  const handleManualAddSubmit = async (e) => {
    e.preventDefault();
    if (!manualFormData.roll_number?.trim() || !manualFormData.full_name?.trim()) {
      showFeedback('Roll Number and Full Name are strictly required.', 'danger');
      return;
    }
    if (!manualFormData.email?.trim() || !manualFormData.phone?.trim()) {
      showFeedback('Student Email Address and Mobile Phone are required for real OTP authentication.', 'danger');
      return;
    }

    try {
      setManualLoading(true);
      const res = await api.admin.manualAddStudent(manualFormData);
      showFeedback(res.message || 'Student record added successfully!', 'success');
      setShowManualModal(false);
      setManualFormData({
        roll_number: '',
        full_name: '',
        room_number: 'A-101',
        hostel_block: 'Block A',
        email: '',
        phone: '',
        course: 'B.Tech Computer Science',
        admission_year: new Date().getFullYear(),
        semester: 1,
        create_login: true,
        default_password: 'Student@12345'
      });
      loadStudents();
    } catch (err) {
      showFeedback(err.message || 'Failed to add student manually', 'danger');
    } finally {
      setManualLoading(false);
    }
  };

  // 5. Clear All Student Records
  const handleClearAllStudents = async () => {
    try {
      setClearLoading(true);
      const res = await api.admin.clearAllStudents();
      showFeedback(res.message || 'All student records successfully cleared!', 'success');
      setShowClearModal(false);
      loadStudents();
    } catch (err) {
      showFeedback(err.message || 'Failed to clear student records', 'danger');
    } finally {
      setClearLoading(false);
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

  // Fetch and open credentials directory
  const handleOpenCredentialsHub = async () => {
    try {
      setCredentialsLoading(true);
      setShowCredentialsModal(true);
      const res = await api.admin.getCredentialsDirectory();
      if (res.success) {
        setCredentialsData(res.directory);
      }
    } catch (err) {
      showFeedback(err.message || 'Failed to load credentials directory', 'danger');
    } finally {
      setCredentialsLoading(false);
    }
  };

  // Open Admin Reset Password modal
  const openResetModal = (student) => {
    setResetTargetStudent(student);
    setResetPasswordInput('Student@12345');
    setResetPasswordReason('Administrative credential recovery');
    setShowResetModal(true);
  };

  // Execute Admin Reset Password
  const handleAdminResetPassword = async (e) => {
    e.preventDefault();
    if (!resetTargetStudent || !resetPasswordInput) return;

    try {
      setResetLoading(true);
      const res = await api.admin.resetStudentPassword(resetTargetStudent.id || resetTargetStudent.roll_number, {
        new_password: resetPasswordInput,
        reason: resetPasswordReason
      });

      showFeedback(res.message, 'success');
      setShowResetModal(false);
      // Refresh credentials data if open
      if (showCredentialsModal) {
        const credRes = await api.admin.getCredentialsDirectory();
        if (credRes.success) setCredentialsData(credRes.directory);
      }
      loadStudents();
    } catch (err) {
      showFeedback(err.message || 'Failed to reset student password', 'danger');
    } finally {
      setResetLoading(false);
    }
  };

  // Copy helper
  const handleCopyText = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Copy all credentials to clipboard
  const handleCopyAllCredentials = () => {
    if (!credentialsData) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
    let text = `========================================================\nHOSTELGUARD SYSTEM CREDENTIALS & ACCESS DIRECTORY\nPortal Link: ${origin}\nDirect Password Reset Link: ${origin}?mode=reset\n========================================================\n\n`;

    text += `--- 👑 STAFF & ADMINISTRATIVE ACCOUNTS ---\n`;
    credentialsData.staff?.forEach((st) => {
      text += `Role: ${st.role} | Username: ${st.username} | Email: ${st.email} | Default Password: ${st.defaultPasswordHint}\n`;
    });

    text += `\n--- 🎓 REGISTERED STUDENT ACCOUNTS ---\n`;
    credentialsData.students?.forEach((s) => {
      text += `Roll: ${s.roll_number} | Name: ${s.full_name} | Email: ${s.email || 'N/A'} | Phone: ${s.phone || 'N/A'} | Default Pass: Student@12345 | Reset Link: ${origin}?mode=reset&roll=${s.roll_number}\n`;
    });

    text += `\n--- 📋 PRE-ALLOTTED ROSTER STUDENTS (READY FOR ONBOARDING) ---\n`;
    credentialsData.pendingAllotments?.forEach((p) => {
      text += `Roll: ${p.roll_number} | Name: ${p.full_name} | Block/Room: ${p.hostel_block} ${p.room_number}\n`;
    });

    navigator.clipboard.writeText(text);
    showFeedback('All credentials directory copied to clipboard!', 'success');
  };

  return (
    <div className="container-fluid px-0">
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
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <button onClick={() => setShowManualModal(true)} className="btn btn-sm btn-success d-flex align-items-center gap-1 shadow-sm">
            <UserPlus size={14} /> + Add Student Manually
          </button>
          <button onClick={() => setShowUploadModal(true)} className="btn btn-sm btn-primary d-flex align-items-center gap-1 shadow-sm">
            <Upload size={14} /> Upload Records (Excel / Word / CSV)
          </button>
          <button onClick={handleOpenCredentialsHub} className="btn btn-sm btn-dark d-flex align-items-center gap-1 shadow-sm">
            <KeyRound size={14} className="text-warning" /> Credentials & Password Hub
          </button>
          <button onClick={() => setShowClearModal(true)} className="btn btn-sm btn-outline-danger d-flex align-items-center gap-1">
            <Trash2 size={14} /> Clear All Records
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
                        <button
                          onClick={() => openResetModal(st)}
                          className="btn btn-outline-warning text-dark"
                          title="Admin Reset Password"
                        >
                          <Key size={14} />
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

      {/* MODAL 1: Multi-Format Upload with Validation Preview (Excel, Word, CSV) */}
      {showUploadModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <div className="d-flex align-items-center gap-2">
                  <div className="p-2 rounded bg-primary-subtle text-primary">
                    <FileSpreadsheet size={18} />
                  </div>
                  <div>
                    <h5 className="modal-title fw-bold mb-0">Upload Student Records</h5>
                    <small className="text-muted" style={{ fontSize: '11px' }}>
                      Supports Excel (.xlsx, .xls), Word (.docx, .doc), and CSV (.csv)
                    </small>
                  </div>
                </div>
                <button type="button" className="btn-close" onClick={() => { setShowUploadModal(false); setPreviewData(null); }}></button>
              </div>
              <div className="modal-body">
                {/* Download Sample Templates Banner */}
                <div className="p-3 mb-3 rounded-3" style={{ background: 'rgba(99, 102, 241, 0.06)', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
                  <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                    <div>
                      <div className="fw-bold" style={{ fontSize: '13px', color: '#4338ca' }}>
                        📥 Download Official Roster Templates
                      </div>
                      <div className="text-muted" style={{ fontSize: '11px' }}>
                        Required columns: <code>Roll Number</code>, <code>Full Name</code>, <code>Room Number</code>, <code>Hostel Block</code>, <code>Email</code>, <code>Phone</code>
                      </div>
                    </div>
                    <div className="d-flex gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={handleDownloadExcelTemplate}
                        className="btn btn-sm btn-outline-success d-flex align-items-center gap-1 shadow-sm"
                        style={{ fontSize: '11px' }}
                      >
                        <FileSpreadsheet size={13} /> Excel (.xlsx)
                      </button>
                      <button
                        type="button"
                        onClick={handleDownloadCsvTemplate}
                        className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1 shadow-sm"
                        style={{ fontSize: '11px' }}
                      >
                        <FileText size={13} /> CSV (.csv)
                      </button>
                      <button
                        type="button"
                        onClick={handleDownloadDocTemplate}
                        className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1 shadow-sm"
                        style={{ fontSize: '11px' }}
                      >
                        <Download size={13} /> Word Guide (.docx)
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mb-3">
                  <label className="form-label fw-semibold" style={{ fontSize: '13px' }}>
                    Select File to Upload
                  </label>
                  <input
                    type="file"
                    className="form-control form-control-sm"
                    accept=".xlsx, .xls, .docx, .doc, .csv"
                    onChange={handleFilePreview}
                    disabled={previewLoading || commitLoading}
                  />
                  <small className="text-muted" style={{ fontSize: '11px' }}>
                    Automatic conflict detection checks for duplicate roll numbers or existing registered students.
                  </small>
                </div>

                {previewLoading && (
                  <div className="text-center py-4">
                    <div className="spinner-border spinner-border-sm text-primary me-2"></div>
                    Parsing document & validating student records...
                  </div>
                )}

                {previewData && (
                  <div>
                    <div className="d-flex gap-2 mb-3 flex-wrap">
                      <span className="badge bg-success p-2">Valid Records: {previewData.validCount}</span>
                      <span className="badge bg-danger p-2">Conflicts / Duplicates: {previewData.conflictCount}</span>
                      <span className="badge bg-secondary p-2">Total Rows: {previewData.totalSubmitted}</span>
                    </div>

                    {previewData.conflictRecords?.length > 0 && (
                      <div className="alert alert-warning p-2 mb-3" style={{ fontSize: '12px' }}>
                        <strong>Conflicts Found (Will be skipped on commit):</strong>
                        <ul className="mb-0 ps-3">
                          {previewData.conflictRecords.map((c, i) => (
                            <li key={i}>{c.roll_number} ({c.full_name}): {c.issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <h6 className="fw-bold" style={{ fontSize: '13px' }}>Verified Records Ready for Import:</h6>
                    <div className="table-responsive" style={{ maxHeight: '220px', overflowY: 'auto' }}>
                      <table className="table table-sm table-bordered" style={{ fontSize: '12px' }}>
                        <thead className="table-light">
                          <tr>
                            <th>Roll Number</th>
                            <th>Student Name</th>
                            <th>Room & Block</th>
                            <th>Email Address</th>
                            <th>Phone (For OTP)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previewData.validRecords.map((r, i) => (
                            <tr key={i}>
                              <td className="font-mono text-primary fw-bold">{r.roll_number}</td>
                              <td>{r.full_name}</td>
                              <td>{r.room_number} ({r.hostel_block})</td>
                              <td className="text-muted">{r.email || 'Will auto-generate'}</td>
                              <td className="font-mono">{r.phone || 'N/A'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Pre-create student logins toggle */}
                    <div className="form-check form-switch mt-3 p-3 rounded" style={{ background: 'rgba(0,0,0,0.02)', border: '1px solid #e2e8f0' }}>
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id="preCreateLoginsSwitch"
                        checked={preCreateLogins}
                        onChange={(e) => setPreCreateLogins(e.target.checked)}
                      />
                      <label className="form-check-label fw-bold text-dark" htmlFor="preCreateLoginsSwitch" style={{ fontSize: '13px' }}>
                        Automatically create login accounts with default password (Student@12345)
                      </label>
                      <div className="text-muted" style={{ fontSize: '11px', marginTop: '2px' }}>
                        Enables students to log in immediately and self-reset passwords via Phone.email or Email OTP.
                      </div>
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
                    {commitLoading ? 'Committing...' : `Commit & Activate ${previewData.validCount} Records`}
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

      {/* MODAL: Manual Add Student Record */}
      {showManualModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)', zIndex: 1055 }}>
          <div className="modal-dialog modal-lg">
            <form onSubmit={handleManualAddSubmit} className="modal-content shadow-lg border-0 rounded-3">
              <div className="modal-header bg-success text-white py-3">
                <div className="d-flex align-items-center gap-2">
                  <UserPlus size={20} />
                  <h5 className="modal-title fw-bold mb-0 text-white">Manual Student Registration</h5>
                </div>
                <button type="button" className="btn-close btn-close-white" onClick={() => setShowManualModal(false)}></button>
              </div>

              <div className="modal-body p-4">
                <div className="alert alert-info py-2 px-3 mb-3 d-flex align-items-center gap-2" style={{ fontSize: '13px' }}>
                  <Shield size={18} className="text-primary flex-shrink-0" />
                  <span>
                    <strong>Authentic OTP Setup:</strong> The student's email and phone number entered here are linked directly to their profile for real Email OTP and Phone.email verification requests.
                  </span>
                </div>

                <div className="row g-3">
                  <div className="col-12 col-md-6">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>
                      Full Name <span className="text-danger">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Vikram Malhotra"
                      className="form-control form-control-sm"
                      value={manualFormData.full_name}
                      onChange={(e) => setManualFormData({ ...manualFormData, full_name: e.target.value })}
                    />
                  </div>

                  <div className="col-12 col-md-6">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>
                      Roll / Student Number <span className="text-danger">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 2024CS01"
                      className="form-control form-control-sm font-mono text-uppercase"
                      value={manualFormData.roll_number}
                      onChange={(e) => setManualFormData({ ...manualFormData, roll_number: e.target.value.toUpperCase() })}
                    />
                  </div>

                  <div className="col-12 col-md-6">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>
                      <Mail size={13} className="me-1 text-primary" /> Student Email Address <span className="text-danger">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="e.g. vikram.m@college.edu"
                      className="form-control form-control-sm"
                      value={manualFormData.email}
                      onChange={(e) => setManualFormData({ ...manualFormData, email: e.target.value })}
                    />
                    <small className="text-muted" style={{ fontSize: '11px' }}>Direct recipient for 6-digit Email OTPs and Magic Link recovery.</small>
                  </div>

                  <div className="col-12 col-md-6">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>
                      <Phone size={13} className="me-1 text-success" /> Mobile Phone Number <span className="text-danger">*</span>
                    </label>
                    <input
                      type="tel"
                      required
                      placeholder="e.g. +91 9876543210"
                      className="form-control form-control-sm font-mono"
                      value={manualFormData.phone}
                      onChange={(e) => setManualFormData({ ...manualFormData, phone: e.target.value })}
                    />
                    <small className="text-muted" style={{ fontSize: '11px' }}>Used for Phone.email instant SMS/WhatsApp OTP verification.</small>
                  </div>

                  <div className="col-6 col-md-3">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>Hostel Block</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Block A"
                      className="form-control form-control-sm"
                      value={manualFormData.hostel_block}
                      onChange={(e) => setManualFormData({ ...manualFormData, hostel_block: e.target.value })}
                    />
                  </div>

                  <div className="col-6 col-md-3">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>Room Number</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. A-101"
                      className="form-control form-control-sm font-mono"
                      value={manualFormData.room_number}
                      onChange={(e) => setManualFormData({ ...manualFormData, room_number: e.target.value })}
                    />
                  </div>

                  <div className="col-6 col-md-3">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>Admission Year</label>
                    <input
                      type="number"
                      min="2018"
                      max="2035"
                      className="form-control form-control-sm"
                      value={manualFormData.admission_year}
                      onChange={(e) => setManualFormData({ ...manualFormData, admission_year: parseInt(e.target.value) || new Date().getFullYear() })}
                    />
                  </div>

                  <div className="col-6 col-md-3">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>Semester</label>
                    <select
                      className="form-select form-select-sm"
                      value={manualFormData.semester}
                      onChange={(e) => setManualFormData({ ...manualFormData, semester: parseInt(e.target.value) || 1 })}
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8].map(s => <option key={s} value={s}>Semester {s}</option>)}
                    </select>
                  </div>

                  <div className="col-12">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>Degree / Course Program</label>
                    <input
                      type="text"
                      placeholder="e.g. B.Tech Computer Science & Engineering"
                      className="form-control form-control-sm"
                      value={manualFormData.course}
                      onChange={(e) => setManualFormData({ ...manualFormData, course: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-check form-switch mt-3 p-3 rounded" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="createLoginSwitch"
                    checked={manualFormData.create_login}
                    onChange={(e) => setManualFormData({ ...manualFormData, create_login: e.target.checked })}
                  />
                  <label className="form-check-label fw-bold" htmlFor="createLoginSwitch" style={{ fontSize: '13px' }}>
                    Pre-create Student Login Account Immediately
                  </label>
                  <div className="text-muted" style={{ fontSize: '11px' }}>
                    Creates username <code>{manualFormData.roll_number || 'ROLL_NO'}</code> with default password <code>Student@12345</code>. Student can log in directly or use OTP password reset.
                  </div>
                </div>
              </div>

              <div className="modal-footer bg-light py-2">
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setShowManualModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-sm btn-success d-flex align-items-center gap-1" disabled={manualLoading}>
                  {manualLoading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-1"></span>
                      Registering...
                    </>
                  ) : (
                    <>
                      <Check size={14} /> Register & Activate Student
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Clear All Students Confirmation */}
      {showClearModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 shadow-lg rounded-3">
              <div className="modal-header bg-danger text-white py-3">
                <div className="d-flex align-items-center gap-2">
                  <Trash2 size={20} />
                  <h5 className="modal-title fw-bold mb-0 text-white">Wipe All Student Records?</h5>
                </div>
                <button type="button" className="btn-close btn-close-white" onClick={() => setShowClearModal(false)}></button>
              </div>
              <div className="modal-body p-4">
                <p className="mb-2 text-danger fw-bold">⚠️ Warning: This action cannot be undone!</p>
                <p className="text-muted" style={{ fontSize: '13px', lineHeight: 1.6 }}>
                  This will completely remove all student accounts, hostel allotments, biometric facial embeddings, and daily attendance history from the database. Administrative and Warden staff accounts will remain safe.
                </p>
                <div className="p-3 rounded bg-light border text-muted" style={{ fontSize: '12px' }}>
                  Use this to wipe out demo or old academic year student records so you can upload a clean roster via Excel, Word, or manual entry.
                </div>
              </div>
              <div className="modal-footer bg-light py-2">
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setShowClearModal(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger d-flex align-items-center gap-1"
                  onClick={handleClearAllStudents}
                  disabled={clearLoading}
                >
                  {clearLoading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-1"></span>
                      Wiping Data...
                    </>
                  ) : (
                    <>
                      <Trash2 size={14} /> Yes, Wipe All Student Records
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Credentials & Password Hub */}
      {showCredentialsModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(3px)', zIndex: 1055 }}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content border-0 shadow-2xl rounded-4 overflow-hidden">
              <div className="modal-header p-4 text-white" style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)' }}>
                <div className="d-flex align-items-center gap-3">
                  <div className="p-2 rounded-circle bg-warning bg-opacity-25 text-warning">
                    <KeyRound size={24} />
                  </div>
                  <div>
                    <h5 className="modal-title fw-bold text-white mb-0">System Credentials & Student Password Directory</h5>
                    <p className="text-muted small mb-0">
                      Complete directory of student & staff account IDs, default passwords, and quick OTP reset links.
                    </p>
                  </div>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <button onClick={handleCopyAllCredentials} className="btn btn-sm btn-outline-light d-flex align-items-center gap-1">
                    <Copy size={13} /> Copy All Directory Text
                  </button>
                  <button type="button" className="btn-close btn-close-white" onClick={() => setShowCredentialsModal(false)}></button>
                </div>
              </div>

              <div className="modal-body p-4 bg-light">
                {/* Tab Navigation */}
                <ul className="nav nav-pills mb-3 gap-2">
                  <li className="nav-item">
                    <button
                      className={`nav-link btn-sm ${credentialsTab === 'students' ? 'active fw-bold' : 'bg-white text-dark border'}`}
                      onClick={() => setCredentialsTab('students')}
                    >
                      🎓 Registered Students ({credentialsData?.students?.length || 0})
                    </button>
                  </li>
                  <li className="nav-item">
                    <button
                      className={`nav-link btn-sm ${credentialsTab === 'staff' ? 'active fw-bold' : 'bg-white text-dark border'}`}
                      onClick={() => setCredentialsTab('staff')}
                    >
                      👑 Staff & Admins ({credentialsData?.staff?.length || 0})
                    </button>
                  </li>
                  <li className="nav-item">
                    <button
                      className={`nav-link btn-sm ${credentialsTab === 'allotments' ? 'active fw-bold' : 'bg-white text-dark border'}`}
                      onClick={() => setCredentialsTab('allotments')}
                    >
                      📋 Pre-Allotted Roster ({credentialsData?.pendingAllotments?.length || 0})
                    </button>
                  </li>
                </ul>

                {credentialsLoading ? (
                  <div className="text-center py-5">
                    <div className="spinner-border text-primary mb-2" role="status"></div>
                    <div className="text-muted small">Loading system credentials directory...</div>
                  </div>
                ) : (
                  <>
                    {/* STUDENTS TAB */}
                    {credentialsTab === 'students' && (
                      <div className="card border-0 shadow-sm rounded-3 overflow-hidden">
                        <div className="table-responsive">
                          <table className="table table-hover align-middle mb-0" style={{ fontSize: '13px' }}>
                            <thead className="table-light">
                              <tr>
                                <th>Roll Number</th>
                                <th>Student Name</th>
                                <th>Student ID</th>
                                <th>Email & Phone</th>
                                <th>Room / Block</th>
                                <th>Default Password</th>
                                <th className="text-end">Direct Links & Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {credentialsData?.students?.map((s) => {
                                const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
                                const resetLink = `${origin}?mode=reset&roll=${s.roll_number}`;
                                return (
                                  <tr key={s.student_id}>
                                    <td className="font-mono fw-bold text-primary">{s.roll_number}</td>
                                    <td className="fw-semibold">{s.full_name}</td>
                                    <td className="font-mono text-muted small">{s.student_id}</td>
                                    <td>
                                      <div className="d-flex flex-column gap-1 small">
                                        <span className="text-truncate" style={{ maxWidth: '180px' }}>
                                          <Mail size={12} className="me-1 text-muted" />
                                          {s.email || 'None'}
                                        </span>
                                        <span>
                                          <Phone size={12} className="me-1 text-muted" />
                                          {s.phone || 'None'}
                                        </span>
                                      </div>
                                    </td>
                                    <td>
                                      <span className="badge bg-light text-dark font-mono">
                                        {s.hostel_block || 'N/A'} &bull; {s.room_number || 'N/A'}
                                      </span>
                                    </td>
                                    <td>
                                      <code className="text-success fw-bold">Student@12345</code>
                                    </td>
                                    <td className="text-end">
                                      <div className="btn-group btn-group-sm">
                                        <button
                                          className="btn btn-outline-secondary"
                                          title="Copy Direct Reset Link"
                                          onClick={() => handleCopyText(resetLink, `reset-${s.roll_number}`)}
                                        >
                                          {copiedId === `reset-${s.roll_number}` ? (
                                            <span className="text-success"><Check size={12} /> Copied</span>
                                          ) : (
                                            <span className="d-inline-flex align-items-center gap-1"><Copy size={12} /> Reset Link</span>
                                          )}
                                        </button>
                                        <button
                                          className="btn btn-outline-warning text-dark"
                                          title="Admin Reset Password"
                                          onClick={() => {
                                            openResetModal(s);
                                          }}
                                        >
                                          <Key size={12} className="me-1" /> Reset
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* STAFF TAB */}
                    {credentialsTab === 'staff' && (
                      <div className="card border-0 shadow-sm rounded-3 overflow-hidden">
                        <div className="table-responsive">
                          <table className="table table-hover align-middle mb-0" style={{ fontSize: '13px' }}>
                            <thead className="table-light">
                              <tr>
                                <th>Role</th>
                                <th>Username</th>
                                <th>Email</th>
                                <th>Default Password</th>
                                <th>Account Status</th>
                                <th className="text-end">Quick Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {credentialsData?.staff?.map((st) => (
                                <tr key={st.id}>
                                  <td>
                                    <span className={`badge ${st.role === 'ADMIN' ? 'bg-primary' : 'bg-info'}`}>
                                      {st.role}
                                    </span>
                                  </td>
                                  <td className="font-mono fw-bold">{st.username}</td>
                                  <td>{st.email}</td>
                                  <td>
                                    <code className="text-primary fw-bold">{st.defaultPasswordHint}</code>
                                  </td>
                                  <td>
                                    <span className="badge bg-success">Active</span>
                                  </td>
                                  <td className="text-end">
                                    <button
                                      className="btn btn-sm btn-outline-secondary"
                                      onClick={() => handleCopyText(`${st.username} | ${st.defaultPasswordHint}`, `staff-${st.username}`)}
                                    >
                                      {copiedId === `staff-${st.username}` ? (
                                        <span className="text-success"><Check size={12} /> Copied</span>
                                      ) : (
                                        <span className="d-inline-flex align-items-center gap-1"><Copy size={12} /> Copy Login</span>
                                      )}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* ALLOTMENTS TAB */}
                    {credentialsTab === 'allotments' && (
                      <div className="card border-0 shadow-sm rounded-3 overflow-hidden">
                        <div className="table-responsive">
                          <table className="table table-hover align-middle mb-0" style={{ fontSize: '13px' }}>
                            <thead className="table-light">
                              <tr>
                                <th>Roll Number</th>
                                <th>Student Full Name</th>
                                <th>Block & Room</th>
                                <th>Onboarding Password</th>
                                <th>Self-Registration Link</th>
                              </tr>
                            </thead>
                            <tbody>
                              {credentialsData?.pendingAllotments?.map((a) => {
                                const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
                                return (
                                  <tr key={a.id}>
                                    <td className="font-mono fw-bold text-primary">{a.roll_number}</td>
                                    <td>{a.full_name}</td>
                                    <td>{a.hostel_block} &bull; {a.room_number}</td>
                                    <td>
                                      <code className="text-muted">Student@12345 (Default)</code>
                                    </td>
                                    <td>
                                      <button
                                        className="btn btn-sm btn-outline-primary"
                                        onClick={() => handleCopyText(origin, `allot-${a.roll_number}`)}
                                      >
                                        <Copy size={12} className="me-1" /> Copy Portal Link
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="modal-footer p-3 bg-white">
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setShowCredentialsModal(false)}>
                  Close Hub
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: Admin One-Click Password Reset for Student */}
      {showResetModal && resetTargetStudent && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1060 }}>
          <div className="modal-dialog">
            <form onSubmit={handleAdminResetPassword} className="modal-content border-0 shadow-lg rounded-4 overflow-hidden">
              <div className="modal-header bg-dark text-white p-3">
                <div className="d-flex align-items-center gap-2">
                  <Key size={18} className="text-warning" />
                  <h6 className="modal-title fw-bold mb-0">Admin Password Reset</h6>
                </div>
                <button type="button" className="btn-close btn-close-white" onClick={() => setShowResetModal(false)}></button>
              </div>

              <div className="modal-body p-4">
                <div className="alert alert-warning py-2 px-3 small mb-3 rounded-3">
                  You are resetting the password for student{' '}
                  <strong>{resetTargetStudent.full_name}</strong> (<code>{resetTargetStudent.roll_number}</code>).
                </div>

                <div className="mb-3">
                  <label className="form-label small fw-semibold">New Password to Assign</label>
                  <input
                    type="text"
                    className="form-control form-control-sm font-mono"
                    value={resetPasswordInput}
                    onChange={(e) => setResetPasswordInput(e.target.value)}
                    required
                    minLength={8}
                  />
                  <div className="form-text" style={{ fontSize: '11px' }}>
                    Standard default is <code>Student@12345</code>. The student can sign in immediately with this password.
                  </div>
                </div>

                <div className="mb-3">
                  <label className="form-label small fw-semibold">Audit Reason / Justification</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={resetPasswordReason}
                    onChange={(e) => setResetPasswordReason(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="modal-footer p-3 bg-light">
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setShowResetModal(false)} disabled={resetLoading}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-sm btn-primary fw-semibold" disabled={resetLoading || resetPasswordInput.length < 8}>
                  {resetLoading ? 'Resetting...' : 'Confirm Password Reset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
