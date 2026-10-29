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
  Shield,
  Mail,
  Phone,
  UserPlus,
  Trash2,
  FileText,
  Download
} from 'lucide-react';

// Assam Engineering College (AEC), Jalukbari, Guwahati - Comprehensive Academic Architecture
export const AEC_PROGRAMS = {
  COURSES: [
    { id: 'B.Tech', label: 'B.Tech (Bachelor of Technology - 8 Semesters)' },
    { id: 'M.Tech', label: 'M.Tech (Master of Technology - 4 Semesters)' },
    { id: 'MCA', label: 'MCA (Master of Computer Applications - 4 Semesters)' }
  ],
  BRANCHES: [
    // Undergraduate B.Tech Branches (Assam Engineering College)
    { code: 'CSE', name: 'Computer Science & Engineering', degree: 'B.Tech' },
    { code: 'CE', name: 'Civil Engineering', degree: 'B.Tech' },
    { code: 'ME', name: 'Mechanical Engineering', degree: 'B.Tech' },
    { code: 'EE', name: 'Electrical Engineering', degree: 'B.Tech' },
    { code: 'ETE', name: 'Electronics & Telecommunication Engineering', degree: 'B.Tech' },
    { code: 'ChE', name: 'Chemical Engineering', degree: 'B.Tech' },
    { code: 'IE', name: 'Instrumentation Engineering', degree: 'B.Tech' },
    { code: 'IPE', name: 'Industrial & Production Engineering', degree: 'B.Tech' },
    // Postgraduate M.Tech Specializations (Assam Engineering College)
    { code: 'CE-GEO', name: 'Civil - Geotechnical Engineering', degree: 'M.Tech' },
    { code: 'CE-WRE', name: 'Civil - Water Resources Engineering', degree: 'M.Tech' },
    { code: 'CE-STR', name: 'Civil - Structural Engineering', degree: 'M.Tech' },
    { code: 'EE-PS', name: 'Electrical - Power Systems', degree: 'M.Tech' },
    { code: 'ME-TFE', name: 'Mechanical - Thermal & Fluid Engineering', degree: 'M.Tech' },
    // Postgraduate MCA (Assam Engineering College)
    { code: 'MCA', name: 'Master of Computer Applications', degree: 'MCA' }
  ],
  SEMESTERS: [
    { num: 1, label: '1st Semester (Sem 1)' },
    { num: 2, label: '2nd Semester (Sem 2)' },
    { num: 3, label: '3rd Semester (Sem 3)' },
    { num: 4, label: '4th Semester (Sem 4)' },
    { num: 5, label: '5th Semester (Sem 5)' },
    { num: 6, label: '6th Semester (Sem 6)' },
    { num: 7, label: '7th Semester (Sem 7)' },
    { num: 8, label: '8th Semester (Sem 8)' }
  ]
};

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
    course: 'BTech',
    semester: 1,
    full_name: '',
    branch: 'CSE',
    roll_number: '',
    building: 'Block A',
    floor: '1',
    room_number: 'A-101',
    whatsapp_no: '',
    phone: '',
    email: '',
    admission_year: new Date().getFullYear(),
    remarks: 'Regular',
    date_of_entry: new Date().toISOString().split('T')[0],
    hostel_block: 'Block A',
    create_login: true,
    default_password: 'Student@12345'
  });
  const [manualLoading, setManualLoading] = useState(false);

  // Delete Individual Student Modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [studentToDelete, setStudentToDelete] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [selectedStudent, setSelectedStudent] = useState(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editFormData, setEditFormData] = useState({});

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

  // 1. Download Official Excel Roster Template (.xlsx) - Exact 13-Column Specification
  const handleDownloadExcelTemplate = async () => {
    try {
      const XLSX = await import('xlsx');
      const sampleRows = [
        {
          'Course': 'B.Tech',
          'Semester': 1,
          'Name': 'Aditya Sharma',
          'Branch': 'CSE',
          'RollNo': '2024CS01',
          'Building': 'Block A',
          'Floor': '1',
          'RoomNo': 'A-101',
          'WhatsApp No': '+919876543210',
          'E-Mail': 'aditya.sharma@aec.ac.in',
          'Admission Year': 2024,
          'Remarks': 'Regular',
          'Date of Entry': '2024-08-01'
        },
        {
          'Course': 'B.Tech',
          'Semester': 2,
          'Name': 'Arunabh Das',
          'Branch': 'IE',
          'RollNo': '2024IE05',
          'Building': 'Block A',
          'Floor': '1',
          'RoomNo': 'A-104',
          'WhatsApp No': '+919876543214',
          'E-Mail': 'arunabh.ie@aec.ac.in',
          'Admission Year': 2024,
          'Remarks': 'Regular',
          'Date of Entry': '2024-08-01'
        },
        {
          'Course': 'B.Tech',
          'Semester': 3,
          'Name': 'Priya Baruah',
          'Branch': 'CE',
          'RollNo': '2023CE15',
          'Building': 'Block A',
          'Floor': '1',
          'RoomNo': 'A-102',
          'WhatsApp No': '+919876543211',
          'E-Mail': 'priya.ce@aec.ac.in',
          'Admission Year': 2023,
          'Remarks': 'Lateral',
          'Date of Entry': '2023-08-05'
        },
        {
          'Course': 'B.Tech',
          'Semester': 4,
          'Name': 'Tanmay Sarma',
          'Branch': 'ChE',
          'RollNo': '2023CHE08',
          'Building': 'Block A',
          'Floor': '2',
          'RoomNo': 'A-203',
          'WhatsApp No': '+919876543216',
          'E-Mail': 'tanmay.che@aec.ac.in',
          'Admission Year': 2023,
          'Remarks': 'Regular',
          'Date of Entry': '2023-08-01'
        },
        {
          'Course': 'B.Tech',
          'Semester': 5,
          'Name': 'Rahul Kalita',
          'Branch': 'ME',
          'RollNo': '2022ME24',
          'Building': 'Block B',
          'Floor': '2',
          'RoomNo': 'B-201',
          'WhatsApp No': '+919876543212',
          'E-Mail': 'rahul.me@aec.ac.in',
          'Admission Year': 2022,
          'Remarks': 'Regular',
          'Date of Entry': '2022-08-10'
        },
        {
          'Course': 'B.Tech',
          'Semester': 6,
          'Name': 'Jitu Saikia',
          'Branch': 'IPE',
          'RollNo': '2022IPE11',
          'Building': 'Block B',
          'Floor': '1',
          'RoomNo': 'B-105',
          'WhatsApp No': '+919876543217',
          'E-Mail': 'jitu.ipe@aec.ac.in',
          'Admission Year': 2022,
          'Remarks': 'Regular',
          'Date of Entry': '2022-08-01'
        },
        {
          'Course': 'B.Tech',
          'Semester': 7,
          'Name': 'Ananya Das',
          'Branch': 'EE',
          'RollNo': '2021EE08',
          'Building': 'Block B',
          'Floor': '2',
          'RoomNo': 'B-202',
          'WhatsApp No': '+919876543213',
          'E-Mail': 'ananya.ee@aec.ac.in',
          'Admission Year': 2021,
          'Remarks': 'Regular',
          'Date of Entry': '2021-08-01'
        },
        {
          'Course': 'B.Tech',
          'Semester': 8,
          'Name': 'Pallabi Medhi',
          'Branch': 'ETE',
          'RollNo': '2021ETE18',
          'Building': 'Block B',
          'Floor': '3',
          'RoomNo': 'B-301',
          'WhatsApp No': '+919876543218',
          'E-Mail': 'pallabi.ete@aec.ac.in',
          'Admission Year': 2021,
          'Remarks': 'Regular',
          'Date of Entry': '2021-08-01'
        },
        {
          'Course': 'M.Tech',
          'Semester': 1,
          'Name': 'Bikram Deka',
          'Branch': 'CE-WRE',
          'RollNo': '2024MTC02',
          'Building': 'Block C',
          'Floor': '1',
          'RoomNo': 'C-101',
          'WhatsApp No': '+919876543220',
          'E-Mail': 'bikram.wre@aec.ac.in',
          'Admission Year': 2024,
          'Remarks': 'Regular',
          'Date of Entry': '2024-08-15'
        },
        {
          'Course': 'M.Tech',
          'Semester': 2,
          'Name': 'Debajit Nath',
          'Branch': 'CE-GEO',
          'RollNo': '2024MTC07',
          'Building': 'Block C',
          'Floor': '1',
          'RoomNo': 'C-102',
          'WhatsApp No': '+919876543221',
          'E-Mail': 'debajit.geo@aec.ac.in',
          'Admission Year': 2024,
          'Remarks': 'Regular',
          'Date of Entry': '2024-08-15'
        },
        {
          'Course': 'M.Tech',
          'Semester': 3,
          'Name': 'Manash Pratim Saikia',
          'Branch': 'EE-PS',
          'RollNo': '2023MTE04',
          'Building': 'Block C',
          'Floor': '2',
          'RoomNo': 'C-201',
          'WhatsApp No': '+919876543222',
          'E-Mail': 'manash.ps@aec.ac.in',
          'Admission Year': 2023,
          'Remarks': 'Regular',
          'Date of Entry': '2023-08-15'
        },
        {
          'Course': 'M.Tech',
          'Semester': 4,
          'Name': 'Kalyan Jyoti Hazarika',
          'Branch': 'ME-TFE',
          'RollNo': '2023MTM03',
          'Building': 'Block C',
          'Floor': '2',
          'RoomNo': 'C-202',
          'WhatsApp No': '+919876543223',
          'E-Mail': 'kalyan.tfe@aec.ac.in',
          'Admission Year': 2023,
          'Remarks': 'Regular',
          'Date of Entry': '2023-08-15'
        },
        {
          'Course': 'MCA',
          'Semester': 2,
          'Name': 'Neha Boro',
          'Branch': 'MCA',
          'RollNo': '2024MCA12',
          'Building': 'Block A',
          'Floor': '2',
          'RoomNo': 'A-205',
          'WhatsApp No': '+919876543224',
          'E-Mail': 'neha.mca@aec.ac.in',
          'Admission Year': 2024,
          'Remarks': 'Late Admission',
          'Date of Entry': '2024-08-20'
        }
      ];

      const ws = XLSX.utils.json_to_sheet(sampleRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'StudentRoster');
      XLSX.writeFile(wb, 'hostelguard_student_roster_template.xlsx');
      showFeedback('Official Excel Template (.xlsx) downloaded with 13-column format!', 'success');
    } catch (err) {
      showFeedback('Failed to generate Excel template: ' + err.message, 'danger');
    }
  };

  // 2. Download Official CSV Roster Template (.csv)
  const handleDownloadCsvTemplate = () => {
    const csvContent =
      "Course,Semester,Name,Branch,RollNo,Building,Floor,RoomNo,WhatsApp No,E-Mail,Admission Year,Remarks,Date of Entry\n" +
      "B.Tech,1,Aditya Sharma,CSE,2024CS01,Block A,1,A-101,+919876543210,aditya.sharma@aec.ac.in,2024,Regular,2024-08-01\n" +
      "B.Tech,3,Priya Baruah,CE,2023CE15,Block A,1,A-102,+919876543211,priya.ce@aec.ac.in,2023,Lateral,2023-08-05\n" +
      "B.Tech,5,Rahul Kalita,ME,2022ME24,Block B,2,B-201,+919876543212,rahul.me@aec.ac.in,2022,Regular,2022-08-10\n" +
      "B.Tech,7,Ananya Das,EE,2021EE08,Block B,2,B-202,+919876543213,ananya.ee@aec.ac.in,2021,Regular,2021-08-01\n" +
      "B.Tech,8,Pallabi Medhi,ETE,2021ETE18,Block B,3,B-301,+919876543218,pallabi.ete@aec.ac.in,2021,Regular,2021-08-01\n" +
      "M.Tech,1,Bikram Deka,CE-WRE,2024MTC02,Block C,1,C-101,+919876543220,bikram.wre@aec.ac.in,2024,Regular,2024-08-15\n" +
      "M.Tech,3,Manash Saikia,EE-PS,2023MTE04,Block C,2,C-201,+919876543222,manash.ps@aec.ac.in,2023,Regular,2023-08-15\n" +
      "MCA,2,Neha Boro,MCA,2024MCA12,Block A,2,A-205,+919876543224,neha.mca@aec.ac.in,2024,Late Admission,2024-08-20\n";

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', 'hostelguard_student_roster_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showFeedback('CSV Template (.csv) downloaded with 13-column format!', 'success');
  };

  // 3. Download Word / Document Roster Template (.docx format preview)
  const handleDownloadDocTemplate = () => {
    const docContent =
      "HOSTELGUARD STUDENT ROSTER IMPORT GUIDE & WORD TEMPLATE\n" +
      "========================================================================\n\n" +
      "Instructions for Warden / Admin:\n" +
      "1. You can paste a table or line-separated student list directly into Microsoft Word (.docx).\n" +
      "2. Columns: Course, Semester, Name, Branch, RollNo, Building, Floor, RoomNo, WhatsApp No, E-Mail, Admission Year, Remarks, Date of Entry.\n" +
      "3. Real OTP authentication will use the E-Mail and WhatsApp / Mobile No specified for each student.\n\n" +
      "Sample Table Format:\n" +
      "Course\tSemester\tName\tBranch\tRollNo\tBuilding\tFloor\tRoomNo\tWhatsApp No\tE-Mail\tAdmission Year\tRemarks\tDate of Entry\n" +
      "BTech\t1\tAditya Sharma\tCSE\t2024CS01\tBlock A\t1\tA-101\t+919876543210\taditya.sharma@example.edu\t2024\tRegular\t2024-08-01\n" +
      "MCA\t1\tPriya Nair\tCA\t2024CS02\tBlock A\t1\tA-102\t+919876543211\tpriya.nair@example.edu\t2024\tLateral\t2024-08-05\n" +
      "Mtech\t1\tRahul Verma\tECE\t2024EC01\tBlock B\t2\tB-201\t+919876543212\trahul.verma@example.edu\t2024\tLate Admission\t2024-08-10\n";

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

    const trimmedEmail = manualFormData.email.trim().toLowerCase();
    if (trimmedEmail === 'admin@hostelguard.local' || trimmedEmail === 'warden@hostelguard.local') {
      showFeedback(`The email "${trimmedEmail}" is reserved for system administrators. Please enter the student's unique email address.`, 'danger');
      return;
    }

    const trimmedRoll = manualFormData.roll_number.trim().toUpperCase();
    const existingStudentWithEmail = students.find(s => s.email && s.email.toLowerCase() === trimmedEmail);
    if (existingStudentWithEmail) {
      showFeedback(`The email "${trimmedEmail}" is already used by student ${existingStudentWithEmail.full_name} (${existingStudentWithEmail.roll_number}). Each student requires a unique email address.`, 'danger');
      return;
    }

    const existingStudentWithRoll = students.find(s => s.roll_number && s.roll_number.toUpperCase() === trimmedRoll);
    if (existingStudentWithRoll) {
      showFeedback(`Student with Roll Number "${trimmedRoll}" already exists on the roster (${existingStudentWithRoll.full_name}).`, 'danger');
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

  // 5. Delete Individual Student (When Student Leaves the Hostel)
  const openDeleteModal = (student) => {
    setStudentToDelete(student);
    setShowDeleteModal(true);
  };

  const handleConfirmDeleteStudent = async () => {
    if (!studentToDelete) return;
    try {
      setDeleteLoading(true);
      const targetId = studentToDelete.id || studentToDelete.roll_number;
      const res = await api.admin.deleteStudent(targetId);
      showFeedback(res.message || `Student ${studentToDelete.full_name} (${studentToDelete.roll_number}) deleted successfully!`, 'success');
      setShowDeleteModal(false);
      setStudentToDelete(null);
      loadStudents();
    } catch (err) {
      showFeedback(err.message || 'Failed to delete student record.', 'danger');
    } finally {
      setDeleteLoading(false);
    }
  };

  // Open Edit Modal
  const openEditModal = (student) => {
    setSelectedStudent(student);
    setEditFormData({
      course: student.course || 'BTech',
      semester: student.semester || 1,
      branch: student.branch || '',
      building: student.building || student.hostel_block || 'Block A',
      hostel_block: student.hostel_block || student.building || 'Block A',
      floor: student.floor || '',
      room_number: student.room_number || '',
      whatsapp_no: student.whatsapp_no || student.phone || '',
      phone: student.phone || student.whatsapp_no || '',
      email: student.email || '',
      admission_year: student.admission_year || new Date().getFullYear(),
      remarks: student.remarks || 'Regular',
      date_of_entry: student.date_of_entry || '',
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
      loadStudents();
    } catch (err) {
      showFeedback(err.message || 'Failed to reset student password', 'danger');
    } finally {
      setResetLoading(false);
    }
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
                <option value="">All AEC Programs & Branches</option>
                <optgroup label="Assam Engg College (AEC) - B.Tech (Sem 1-8)">
                  <option value="CSE">B.Tech - Computer Science & Engineering (CSE)</option>
                  <option value="CE">B.Tech - Civil Engineering (CE)</option>
                  <option value="ME">B.Tech - Mechanical Engineering (ME)</option>
                  <option value="EE">B.Tech - Electrical Engineering (EE)</option>
                  <option value="ETE">B.Tech - Electronics & Telecommunication (ETE)</option>
                  <option value="ChE">B.Tech - Chemical Engineering (ChE)</option>
                  <option value="IE">B.Tech - Instrumentation Engineering (IE)</option>
                  <option value="IPE">B.Tech - Industrial & Production Engineering (IPE)</option>
                </optgroup>
                <optgroup label="Assam Engg College (AEC) - Masters (M.Tech / MCA)">
                  <option value="CE-GEO">M.Tech Civil (Geotechnical Engineering)</option>
                  <option value="CE-WRE">M.Tech Civil (Water Resources Engineering)</option>
                  <option value="CE-STR">M.Tech Civil (Structural Engineering)</option>
                  <option value="EE-PS">M.Tech Electrical (Power Systems)</option>
                  <option value="ME-TFE">M.Tech Mechanical (Thermal & Fluid Engineering)</option>
                  <option value="MCA">MCA - Master of Computer Applications</option>
                </optgroup>
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

      {/* Student Table - 13-Column Comprehensive Roster View */}
      <div className="hg-card">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0" style={{ fontSize: '12.5px' }}>
            <thead className="table-light">
              <tr className="text-nowrap">
                <th>Course</th>
                <th>Sem</th>
                <th>Name</th>
                <th>Branch</th>
                <th>RollNo</th>
                <th>Building</th>
                <th>Floor</th>
                <th>RoomNo</th>
                <th>WhatsApp No</th>
                <th>E-Mail</th>
                <th>Adm Year</th>
                <th>Remarks</th>
                <th>Date of Entry</th>
                <th>Status</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="15" className="text-center py-4 text-muted">
                    <div className="spinner-border spinner-border-sm me-2 text-primary" role="status"></div>
                    Loading student roster...
                  </td>
                </tr>
              ) : (Array.isArray(students) && students.length > 0) ? (
                students.map((st) => (
                  <tr key={st.id}>
                    <td>
                      <span className="badge bg-primary-subtle text-primary border border-primary-subtle fw-bold px-2 py-1">
                        {st.course || 'BTech'}
                      </span>
                    </td>
                    <td className="text-center fw-bold">{st.semester || 1}</td>
                    <td className="fw-semibold text-dark text-nowrap">{st.full_name}</td>
                    <td>
                      <span className="badge bg-light text-dark border">
                        {st.branch || '—'}
                      </span>
                    </td>
                    <td className="font-mono fw-bold text-primary text-nowrap">{st.roll_number}</td>
                    <td className="text-nowrap">{st.building || st.hostel_block || 'Block A'}</td>
                    <td className="text-center">{st.floor || '—'}</td>
                    <td className="font-mono fw-semibold text-nowrap">{st.room_number || 'N/A'}</td>
                    <td className="font-mono text-nowrap" style={{ fontSize: '11.5px' }}>
                      {st.whatsapp_no || st.phone || 'N/A'}
                    </td>
                    <td className="text-muted text-truncate" style={{ maxWidth: '140px', fontSize: '11.5px' }} title={st.email}>
                      {st.email || 'N/A'}
                    </td>
                    <td className="text-center">{st.admission_year || 2024}</td>
                    <td>
                      <span className={`badge ${
                        st.remarks === 'Lateral' ? 'bg-info' : 
                        st.remarks === 'Late Admission' ? 'bg-warning text-dark' : 
                        'bg-light text-muted border'
                      }`}>
                        {st.remarks || 'Regular'}
                      </span>
                    </td>
                    <td className="font-mono text-nowrap text-muted" style={{ fontSize: '11px' }}>
                      {st.date_of_entry || '—'}
                    </td>
                    <td>
                      {st.is_active ? (
                        <span className="badge bg-success">Active</span>
                      ) : (
                        <span className="badge bg-secondary">Inactive</span>
                      )}
                    </td>
                    <td className="text-end text-nowrap">
                      <div className="btn-group btn-group-sm">
                        <button
                          onClick={() => { setSelectedStudent(st); setShowViewModal(true); }}
                          className="btn btn-outline-secondary"
                          title="View Details"
                        >
                          <Eye size={13} />
                        </button>
                        <button
                          onClick={() => openEditModal(st)}
                          className="btn btn-outline-primary"
                          title="Edit Student"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => openResetModal(st)}
                          className="btn btn-outline-warning text-dark"
                          title="Admin Reset Password"
                        >
                          <Key size={13} />
                        </button>
                        <button
                          onClick={() => openDeleteModal(st)}
                          className="btn btn-outline-danger"
                          title="Delete Student (Left Hostel)"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="15" className="text-center py-4 text-muted">
                    No students found. Upload student records via Excel, Word, or CSV, or add a student manually above.
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

                    <h6 className="fw-bold" style={{ fontSize: '13px' }}>Verified Records Ready for Import (13-Column Format):</h6>
                    <div className="table-responsive" style={{ maxHeight: '250px', overflowY: 'auto' }}>
                      <table className="table table-sm table-bordered mb-0" style={{ fontSize: '11px' }}>
                        <thead className="table-light sticky-top">
                          <tr className="text-nowrap">
                            <th>Course</th>
                            <th>Sem</th>
                            <th>Name</th>
                            <th>Branch</th>
                            <th>RollNo</th>
                            <th>Building</th>
                            <th>Floor</th>
                            <th>RoomNo</th>
                            <th>WhatsApp No</th>
                            <th>E-Mail</th>
                            <th>Adm Year</th>
                            <th>Remarks</th>
                            <th>Date of Entry</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(previewData.validRecords || []).map((r, i) => (
                            <tr key={i} className="text-nowrap">
                              <td><span className="badge bg-light text-dark">{r.course || 'BTech'}</span></td>
                              <td className="text-center">{r.semester || 1}</td>
                              <td className="fw-semibold">{r.full_name}</td>
                              <td>{r.branch || '—'}</td>
                              <td className="font-mono text-primary fw-bold">{r.roll_number}</td>
                              <td>{r.building || r.hostel_block || 'Block A'}</td>
                              <td className="text-center">{r.floor || '—'}</td>
                              <td className="font-mono">{r.room_number || 'A-101'}</td>
                              <td className="font-mono">{r.whatsapp_no || r.phone || 'N/A'}</td>
                              <td className="text-muted">{r.email || 'Auto-generate'}</td>
                              <td className="text-center">{r.admission_year || 2024}</td>
                              <td>
                                <span className={`badge ${
                                  r.remarks === 'Lateral' ? 'bg-info' : 
                                  r.remarks === 'Late Admission' ? 'bg-warning text-dark' : 
                                  'bg-secondary'
                                }`}>
                                  {r.remarks || 'Regular'}
                                </span>
                              </td>
                              <td className="font-mono">{r.date_of_entry || '—'}</td>
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

      {/* MODAL 2: View Student Details - Full 13 Fields */}
      {showViewModal && selectedStudent && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title fw-bold">Student Identity & Academic Record</h5>
                <button type="button" className="btn-close" onClick={() => setShowViewModal(false)}></button>
              </div>
              <div className="modal-body" style={{ fontSize: '13px' }}>
                <div className="row g-3">
                  <div className="col-md-6">
                    <div className="p-3 bg-light rounded-3 border h-100">
                      <h6 className="fw-bold text-primary mb-3">Academic Details</h6>
                      <div className="mb-2"><strong>Course:</strong> <span className="badge bg-primary ms-1">{selectedStudent.course || 'BTech'}</span></div>
                      <div className="mb-2"><strong>Semester:</strong> Semester {selectedStudent.semester || 1}</div>
                      <div className="mb-2"><strong>Branch:</strong> {selectedStudent.branch || '—'}</div>
                      <div className="mb-2"><strong>Roll Number:</strong> <span className="font-mono text-primary fw-bold">{selectedStudent.roll_number}</span></div>
                      <div className="mb-2"><strong>Admission Year:</strong> {selectedStudent.admission_year || 2024}</div>
                      <div className="mb-2"><strong>Remarks:</strong> <span className="badge bg-secondary ms-1">{selectedStudent.remarks || 'Regular'}</span></div>
                      <div className="mb-2"><strong>Date of Entry:</strong> <span className="font-mono">{selectedStudent.date_of_entry || '—'}</span></div>
                    </div>
                  </div>
                  <div className="col-md-6">
                    <div className="p-3 bg-light rounded-3 border h-100">
                      <h6 className="fw-bold text-success mb-3">Hostel & Contact Allocation</h6>
                      <div className="mb-2"><strong>Full Name:</strong> {selectedStudent.full_name}</div>
                      <div className="mb-2"><strong>Building:</strong> {selectedStudent.building || selectedStudent.hostel_block || 'Block A'}</div>
                      <div className="mb-2"><strong>Floor:</strong> {selectedStudent.floor || '—'}</div>
                      <div className="mb-2"><strong>Room Number:</strong> <span className="font-mono fw-semibold">{selectedStudent.room_number || 'N/A'}</span></div>
                      <div className="mb-2"><strong>WhatsApp No:</strong> <span className="font-mono">{selectedStudent.whatsapp_no || selectedStudent.phone || 'N/A'}</span></div>
                      <div className="mb-2"><strong>E-Mail:</strong> {selectedStudent.email || 'N/A'}</div>
                    </div>
                  </div>
                  <div className="col-12">
                    <div className="p-3 bg-white rounded-3 border">
                      <h6 className="fw-bold text-secondary mb-2">Hardware Telemetry & Security</h6>
                      <div className="row g-2">
                        <div className="col-md-6">
                          <strong>Hardware Device ID:</strong> <span className="font-mono text-muted d-block">{selectedStudent.device_id || 'Pending'}</span>
                        </div>
                        <div className="col-md-3">
                          <strong>Failed Strikes:</strong> {selectedStudent.failed_attempts || 0} / 3
                        </div>
                        <div className="col-md-3">
                          <strong>Forge Status:</strong>{' '}
                          {selectedStudent.is_flagged_forge ? (
                            <span className="badge bg-danger">Flagged Forge</span>
                          ) : (
                            <span className="badge bg-success">Clear & Active</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
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

      {/* MODAL 3: Edit Student - 13 Details */}
      {showEditModal && selectedStudent && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg">
            <form onSubmit={handleSaveEdit} className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title fw-bold">Edit Student Details ({selectedStudent.roll_number})</h5>
                <button type="button" className="btn-close" onClick={() => setShowEditModal(false)}></button>
              </div>
              <div className="modal-body" style={{ fontSize: '13px' }}>
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>Full Name (Locked to Roster)</label>
                    <input type="text" className="form-control form-control-sm" value={selectedStudent.full_name} disabled />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>Roll Number (Locked)</label>
                    <input type="text" className="form-control form-control-sm font-mono text-primary fw-bold" value={selectedStudent.roll_number} disabled />
                  </div>

                  <div className="col-md-4">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>Degree / Program</label>
                    <select
                      className="form-select form-select-sm"
                      value={editFormData.course}
                      onChange={(e) => setEditFormData({ ...editFormData, course: e.target.value })}
                    >
                      <option value="B.Tech">B.Tech (Assam Engineering College)</option>
                      <option value="M.Tech">M.Tech (Assam Engineering College)</option>
                      <option value="MCA">MCA (Assam Engineering College)</option>
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>AEC Branch</label>
                    <select
                      className="form-select form-select-sm"
                      value={editFormData.branch}
                      onChange={(e) => setEditFormData({ ...editFormData, branch: e.target.value })}
                    >
                      <optgroup label="B.Tech Branches (Assam Engineering College)">
                        <option value="CSE">Computer Science & Engineering (CSE)</option>
                        <option value="CE">Civil Engineering (CE)</option>
                        <option value="ME">Mechanical Engineering (ME)</option>
                        <option value="EE">Electrical Engineering (EE)</option>
                        <option value="ETE">Electronics & Telecommunication (ETE)</option>
                        <option value="ChE">Chemical Engineering (ChE)</option>
                        <option value="IE">Instrumentation Engineering (IE)</option>
                        <option value="IPE">Industrial & Production Engineering (IPE)</option>
                      </optgroup>
                      <optgroup label="M.Tech Masters Specializations">
                        <option value="CE-GEO">M.Tech Civil (Geotechnical Engineering)</option>
                        <option value="CE-WRE">M.Tech Civil (Water Resources Engineering)</option>
                        <option value="CE-STR">M.Tech Civil (Structural Engineering)</option>
                        <option value="EE-PS">M.Tech Electrical (Power Systems)</option>
                        <option value="ME-TFE">M.Tech Mechanical (Thermal & Fluid Engineering)</option>
                      </optgroup>
                      <optgroup label="MCA Masters Program">
                        <option value="MCA">Master of Computer Applications (MCA)</option>
                      </optgroup>
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>Semester (1st till 8th)</label>
                    <select
                      className="form-select form-select-sm"
                      value={editFormData.semester}
                      onChange={(e) => setEditFormData({ ...editFormData, semester: parseInt(e.target.value) || 1 })}
                    >
                      <option value={1}>1st Semester (Sem 1)</option>
                      <option value={2}>2nd Semester (Sem 2)</option>
                      <option value={3}>3rd Semester (Sem 3)</option>
                      <option value={4}>4th Semester (Sem 4)</option>
                      <option value={5}>5th Semester (Sem 5)</option>
                      <option value={6}>6th Semester (Sem 6)</option>
                      <option value={7}>7th Semester (Sem 7)</option>
                      <option value={8}>8th Semester (Sem 8)</option>
                    </select>
                  </div>

                  <div className="col-md-4">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>Building</label>
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      placeholder="e.g. Block A"
                      value={editFormData.building}
                      onChange={(e) => setEditFormData({ ...editFormData, building: e.target.value, hostel_block: e.target.value })}
                    />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>Floor</label>
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      placeholder="e.g. 1, 2"
                      value={editFormData.floor}
                      onChange={(e) => setEditFormData({ ...editFormData, floor: e.target.value })}
                    />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>Room Number</label>
                    <input
                      type="text"
                      className="form-control form-control-sm font-mono"
                      placeholder="e.g. A-101"
                      value={editFormData.room_number}
                      onChange={(e) => setEditFormData({ ...editFormData, room_number: e.target.value })}
                    />
                  </div>

                  <div className="col-md-6">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>WhatsApp No / Phone</label>
                    <input
                      type="tel"
                      className="form-control form-control-sm font-mono"
                      placeholder="e.g. +91 9876543210"
                      value={editFormData.whatsapp_no}
                      onChange={(e) => setEditFormData({ ...editFormData, whatsapp_no: e.target.value, phone: e.target.value })}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>E-Mail Address</label>
                    <input
                      type="email"
                      className="form-control form-control-sm"
                      placeholder="e.g. student@college.edu"
                      value={editFormData.email}
                      onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                    />
                  </div>

                  <div className="col-md-4">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>Admission Year</label>
                    <input
                      type="number"
                      className="form-control form-control-sm"
                      value={editFormData.admission_year}
                      onChange={(e) => setEditFormData({ ...editFormData, admission_year: parseInt(e.target.value) || 2024 })}
                    />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>Remarks</label>
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      placeholder="e.g. Regular, Lateral, Late Admission"
                      value={editFormData.remarks}
                      onChange={(e) => setEditFormData({ ...editFormData, remarks: e.target.value })}
                    />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>Date of Entry</label>
                    <input
                      type="date"
                      className="form-control form-control-sm"
                      value={editFormData.date_of_entry}
                      onChange={(e) => setEditFormData({ ...editFormData, date_of_entry: e.target.value })}
                    />
                  </div>

                  <div className="col-12">
                    <div className="form-check mt-2">
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
            <form onSubmit={handleManualAddSubmit} autoComplete="off" className="modal-content shadow-lg border-0 rounded-3">
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
                  <div className="col-md-3">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>Degree / Program <span className="text-danger">*</span></label>
                    <select
                      className="form-select form-select-sm"
                      value={manualFormData.course}
                      onChange={(e) => {
                        const c = e.target.value;
                        const b = c === 'MCA' ? 'MCA' : c === 'M.Tech' ? 'CE-GEO' : 'CSE';
                        setManualFormData({ ...manualFormData, course: c, branch: b });
                      }}
                    >
                      <option value="B.Tech">B.Tech (Assam Engineering College)</option>
                      <option value="M.Tech">M.Tech (Assam Engineering College)</option>
                      <option value="MCA">MCA (Assam Engineering College)</option>
                    </select>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>AEC Branch <span className="text-danger">*</span></label>
                    <select
                      className="form-select form-select-sm"
                      value={manualFormData.branch}
                      onChange={(e) => setManualFormData({ ...manualFormData, branch: e.target.value })}
                    >
                      <optgroup label="B.Tech Branches (Assam Engineering College)">
                        <option value="CSE">Computer Science & Engineering (CSE)</option>
                        <option value="CE">Civil Engineering (CE)</option>
                        <option value="ME">Mechanical Engineering (ME)</option>
                        <option value="EE">Electrical Engineering (EE)</option>
                        <option value="ETE">Electronics & Telecommunication (ETE)</option>
                        <option value="ChE">Chemical Engineering (ChE)</option>
                        <option value="IE">Instrumentation Engineering (IE)</option>
                        <option value="IPE">Industrial & Production Engineering (IPE)</option>
                      </optgroup>
                      <optgroup label="M.Tech Masters Specializations">
                        <option value="CE-GEO">M.Tech Civil (Geotechnical Engineering)</option>
                        <option value="CE-WRE">M.Tech Civil (Water Resources Engineering)</option>
                        <option value="CE-STR">M.Tech Civil (Structural Engineering)</option>
                        <option value="EE-PS">M.Tech Electrical (Power Systems)</option>
                        <option value="ME-TFE">M.Tech Mechanical (Thermal & Fluid Engineering)</option>
                      </optgroup>
                      <optgroup label="MCA Masters Program">
                        <option value="MCA">Master of Computer Applications (MCA)</option>
                      </optgroup>
                    </select>
                  </div>
                  <div className="col-md-2">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>Semester <span className="text-danger">*</span></label>
                    <select
                      className="form-select form-select-sm"
                      value={manualFormData.semester}
                      onChange={(e) => setManualFormData({ ...manualFormData, semester: parseInt(e.target.value) || 1 })}
                    >
                      <option value={1}>1st Sem</option>
                      <option value={2}>2nd Sem</option>
                      <option value={3}>3rd Sem</option>
                      <option value={4}>4th Sem</option>
                      <option value={5}>5th Sem</option>
                      <option value={6}>6th Sem</option>
                      <option value={7}>7th Sem</option>
                      <option value={8}>8th Sem</option>
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>Name (Full Name) <span className="text-danger">*</span></label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Aditya Sharma"
                      className="form-control form-control-sm"
                      value={manualFormData.full_name}
                      onChange={(e) => setManualFormData({ ...manualFormData, full_name: e.target.value })}
                    />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>RollNo <span className="text-danger">*</span></label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 2024CS01"
                      className="form-control form-control-sm font-mono text-uppercase"
                      value={manualFormData.roll_number}
                      onChange={(e) => setManualFormData({ ...manualFormData, roll_number: e.target.value.toUpperCase() })}
                    />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>Building</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Block A"
                      className="form-control form-control-sm"
                      value={manualFormData.building}
                      onChange={(e) => setManualFormData({ ...manualFormData, building: e.target.value, hostel_block: e.target.value })}
                    />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>Floor</label>
                    <input
                      type="text"
                      placeholder="e.g. 1, 2"
                      className="form-control form-control-sm"
                      value={manualFormData.floor}
                      onChange={(e) => setManualFormData({ ...manualFormData, floor: e.target.value })}
                    />
                  </div>

                  <div className="col-md-3">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>RoomNo <span className="text-danger">*</span></label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. A-101"
                      className="form-control form-control-sm font-mono"
                      value={manualFormData.room_number}
                      onChange={(e) => setManualFormData({ ...manualFormData, room_number: e.target.value })}
                    />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>
                      <Phone size={13} className="me-1 text-success" /> WhatsApp No <span className="text-danger">*</span>
                    </label>
                    <input
                      type="tel"
                      required
                      placeholder="e.g. +91 9876543210"
                      className="form-control form-control-sm font-mono"
                      value={manualFormData.whatsapp_no || manualFormData.phone}
                      onChange={(e) => setManualFormData({ ...manualFormData, whatsapp_no: e.target.value, phone: e.target.value })}
                    />
                  </div>
                  <div className="col-md-5">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>
                      <Mail size={13} className="me-1 text-primary" /> E-Mail <span className="text-danger">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="e.g. student@college.edu"
                      className="form-control form-control-sm"
                      value={manualFormData.email}
                      onChange={(e) => setManualFormData({ ...manualFormData, email: e.target.value })}
                    />
                  </div>

                  <div className="col-md-4">
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
                  <div className="col-md-4">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>Remarks</label>
                    <select
                      className="form-select form-select-sm"
                      value={manualFormData.remarks}
                      onChange={(e) => setManualFormData({ ...manualFormData, remarks: e.target.value })}
                    >
                      <option value="Regular">Regular</option>
                      <option value="Lateral">Lateral</option>
                      <option value="Late Admission">Late Admission</option>
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-bold" style={{ fontSize: '12px' }}>Date of Entry</label>
                    <input
                      type="date"
                      className="form-control form-control-sm"
                      value={manualFormData.date_of_entry}
                      onChange={(e) => setManualFormData({ ...manualFormData, date_of_entry: e.target.value })}
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
                    Pre-creates portal account with username <code>{manualFormData.roll_number || 'ROLL_NO'}</code>. Student can sign in or reset credentials via Email/Phone OTP anytime.
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

      {/* MODAL: Delete Individual Student Confirmation */}
      {showDeleteModal && studentToDelete && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(3px)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 shadow-lg rounded-3">
              <div className="modal-header bg-danger text-white py-3">
                <div className="d-flex align-items-center gap-2">
                  <Trash2 size={20} />
                  <h5 className="modal-title fw-bold mb-0 text-white">Delete Student Record</h5>
                </div>
                <button
                  type="button"
                  className="btn-close btn-close-white"
                  onClick={() => { setShowDeleteModal(false); setStudentToDelete(null); }}
                  disabled={deleteLoading}
                ></button>
              </div>
              <div className="modal-body p-4">
                <p className="mb-2 text-dark" style={{ fontSize: '14px' }}>
                  Are you sure you want to delete student <strong>{studentToDelete.full_name}</strong>?
                </p>

                <div className="p-3 my-3 rounded bg-light border" style={{ fontSize: '12.5px' }}>
                  <div className="mb-1"><strong>Roll Number:</strong> <span className="font-mono text-primary fw-bold">{studentToDelete.roll_number}</span></div>
                  <div className="mb-1"><strong>Hostel Room:</strong> {studentToDelete.hostel_block} &bull; Room {studentToDelete.room_number}</div>
                  <div className="mb-1"><strong>Degree / Course:</strong> {studentToDelete.course}</div>
                  <div><strong>Email Address:</strong> {studentToDelete.email || 'N/A'}</div>
                </div>

                <div className="alert alert-warning py-2 px-3 mb-0 d-flex align-items-start gap-2" style={{ fontSize: '12px' }}>
                  <AlertTriangle size={16} className="text-warning flex-shrink-0 mt-1" />
                  <span>
                    <strong>Hostel Checkout Action:</strong> This permanently removes their room allotment, login credentials, biometric face profile, and attendance records. Their active sessions will be revoked immediately.
                  </span>
                </div>
              </div>
              <div className="modal-footer bg-light py-2">
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => { setShowDeleteModal(false); setStudentToDelete(null); }}
                  disabled={deleteLoading}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger d-flex align-items-center gap-1"
                  onClick={handleConfirmDeleteStudent}
                  disabled={deleteLoading}
                >
                  {deleteLoading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-1"></span>
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 size={14} /> Confirm & Delete Student
                    </>
                  )}
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
