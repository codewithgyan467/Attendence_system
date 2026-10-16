import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { getNativeOrBrowserLocation, isNativeMobile } from '../../utils/nativeHardware';
import { Line } from 'react-chartjs-2';
import {
  UserCheck,
  History,
  FileCheck2,
  LifeBuoy,
  User,
  MapPin,
  Camera,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Clock,
  ShieldAlert,
  Send,
  Navigation,
  Sparkles,
  X,
  Check,
  Zap,
  Volume2
} from 'lucide-react';
import GeofenceMap from '../common/GeofenceMap';
import { playBiometricChime, detectFaceAngle } from '../../utils/faceAngleGuide';

const formatDisplayTime12h = (timeVal) => {
  if (!timeVal) return '';
  if (typeof timeVal === 'string' && timeVal.includes('T')) {
    const d = new Date(timeVal);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    }
  }
  const parts = String(timeVal).split(':');
  if (parts.length >= 2) {
    let h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (!isNaN(h) && !isNaN(m)) {
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      const mm = m < 10 ? `0${m}` : `${m}`;
      return `${h}:${mm} ${ampm}`;
    }
  }
  return timeVal;
};

export default function StudentPortal({ activeTab = 'student_attendance', onSelectTab }) {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [history, setHistory] = useState([]);
  const [corrections, setCorrections] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [scheduleStatus, setScheduleStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [gpsLiveAccuracy, setGpsLiveAccuracy] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

  // Daily Check-in flow state: 'idle' | 'verifying_gps' | 'gps_ok' | 'camera_active' | 'verifying_face' | 'success' | 'failed'
  const [checkinStep, setCheckinStep] = useState('idle');
  const [sessionToken, setSessionToken] = useState(null);
  const [verifiedDistance, setVerifiedDistance] = useState(null);
  const [checkinError, setCheckinError] = useState(null);
  const [studentCoords, setStudentCoords] = useState(null);
  const [showMapRadar, setShowMapRadar] = useState(true);

  // Live Check-in Camera
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);

  // In-Portal Facial Identity Enrollment
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [enrollPhotos, setEnrollPhotos] = useState([]);
  const [enrollActiveAngle, setEnrollActiveAngle] = useState('FRONT');
  const [enrollSubmitting, setEnrollSubmitting] = useState(false);
  const [enrollError, setEnrollError] = useState(null);
  const enrollVideoRef = useRef(null);
  const enrollStreamRef = useRef(null);

  // Hands-Free Auto-Capture & Head Pose Tracking
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(true);
  const [poseStatus, setPoseStatus] = useState({ detected: false, angle: 'NONE', progress: 0, label: '' });
  const [flashActive, setFlashActive] = useState(false);
  const isAutoSnappingRef = useRef(false);
  const autoHoldProgressRef = useRef(0);

  // Forms
  const [correctionForm, setCorrectionForm] = useState({ date: new Date().toISOString().split('T')[0], reason: '' });
  const [submittingCorrection, setSubmittingCorrection] = useState(false);

  const [ticketForm, setTicketForm] = useState({ category: 'Hostel Facilities', subject: '', message: '' });
  const [submittingTicket, setSubmittingTicket] = useState(false);

  useEffect(() => {
    fetchStudentData();
    return () => {
      stopCamera();
      stopEnrollCamera();
    };
  }, []);

  // Ensure video stream is attached to the video DOM element as soon as it mounts or changes step
  useEffect(() => {
    if ((checkinStep === 'camera_active' || checkinStep === 'verifying_face') && videoRef.current && streamRef.current) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
      }
      videoRef.current.play().catch((err) => console.warn('Video autoPlay prevented on step change:', err));
    }
  }, [checkinStep]);

  // Callback ref guarantees video stream attaches the exact microsecond the DOM node mounts
  const attachVideoRef = (node) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      if (node.srcObject !== streamRef.current) {
        node.srcObject = streamRef.current;
      }
      node.play().catch((err) => console.warn('Camera play warning on attach:', err));
    }
  };

  const attachEnrollVideoRef = (node) => {
    enrollVideoRef.current = node;
    if (node && enrollStreamRef.current) {
      if (node.srcObject !== enrollStreamRef.current) {
        node.srcObject = enrollStreamRef.current;
      }
      node.play().catch((err) => console.warn('Enroll camera play warning on attach:', err));
    }
  };

  const fetchStudentData = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [dashRes, histRes, corrRes, tickRes, schedRes] = await Promise.allSettled([
        api.student.getDashboard(),
        api.student.getHistory(),
        api.student.getCorrections(),
        api.student.getFeedback(),
        api.attendance.getSchedule()
      ]);

      if (dashRes.status === 'fulfilled' && dashRes.value.success) setDashboard(dashRes.value);
      if (histRes.status === 'fulfilled' && histRes.value.success) setHistory(histRes.value.records || []);
      if (corrRes.status === 'fulfilled' && corrRes.value.success) setCorrections(corrRes.value.corrections || corrRes.value.requests || []);
      if (tickRes.status === 'fulfilled' && tickRes.value.success) setTickets(tickRes.value.tickets || tickRes.value.feedback || []);
      if (schedRes.status === 'fulfilled' && schedRes.value.success) setScheduleStatus(schedRes.value.schedule || null);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to load student data');
    } finally {
      setLoading(false);
    }
  };

  // Check-In Step 1: GPS Verification
  const handleVerifyLocation = async () => {
    if (scheduleStatus?.enforced && !scheduleStatus.isOpen) {
      setCheckinError(scheduleStatus.message || 'Attendance window is currently closed.');
      setCheckinStep('failed');
      return;
    }
    setCheckinStep('verifying_gps');
    setCheckinError(null);
    setGpsLiveAccuracy(null);

    try {
      const pos = await getNativeOrBrowserLocation({
        onProgress: (acc) => setGpsLiveAccuracy(acc),
        maxWaitMs: 3500,
        targetAccuracy: 25
      });

      // Save student live GPS coordinates for the radar map
      setStudentCoords({
        lat: pos.latitude,
        lng: pos.longitude,
        accuracy: pos.accuracy || 10
      });

      const res = await api.attendance.verifyLocation({
        roll_number: dashboard?.student?.roll_number || user?.username,
        latitude: pos.latitude,
        longitude: pos.longitude,
        accuracy: pos.accuracy || 10,
        is_mock_location: pos.isMockLocation || false
      });

      if (res.success) {
        setSessionToken(res.sessionToken || res.challengeToken);
        setVerifiedDistance(res.verifiedDistance || res.distanceMeters);
        setCheckinStep('gps_ok');
        // Auto open camera with resilient fallback
        setTimeout(() => startCamera(), 400);
      } else {
        const dist = res.distanceMeters ? ` (${Math.round(res.distanceMeters)}m away)` : '';
        setVerifiedDistance(res.distanceMeters || null);
        setCheckinError(res.message || res.error || `Location rejected by hostel geofence policy${dist}.`);
        setCheckinStep('failed');
      }
    } catch (err) {
      setCheckinError(err.message || 'Location verification rejected.');
      setCheckinStep('failed');
      fetchStudentData();
    }
  };

  // Check-In Step 2: Camera with Progressive Constraint Fallbacks
  const startCamera = async () => {
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } }
        });
      } catch (e1) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user' }
          });
        } catch (e2) {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
      }

      streamRef.current = stream;
      setCameraActive(true);
      setCheckinStep('camera_active');

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(console.warn);
      }
    } catch (err) {
      console.error('Camera access error:', err);
      setCheckinError('Could not access front camera. Please grant camera permission in your browser.');
      setCheckinStep('failed');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  // Facial Identity Enrollment Methods
  const startEnrollCamera = async () => {
    setEnrollError(null);
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } }
        });
      } catch (e1) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        } catch (e2) {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
      }
      enrollStreamRef.current = stream;
      if (enrollVideoRef.current) {
        enrollVideoRef.current.srcObject = stream;
        enrollVideoRef.current.play().catch(console.warn);
      }
    } catch (err) {
      console.error('Enroll camera error:', err);
      setEnrollError('Camera permission required. Please enable camera access in your mobile browser.');
    }
  };

  const stopEnrollCamera = () => {
    if (enrollStreamRef.current) {
      enrollStreamRef.current.getTracks().forEach((t) => t.stop());
      enrollStreamRef.current = null;
    }
  };

  const handleCaptureEnrollPhoto = (angle = enrollActiveAngle) => {
    if (!enrollVideoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = enrollVideoRef.current.videoWidth || 640;
    canvas.height = enrollVideoRef.current.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(enrollVideoRef.current, 0, 0, canvas.width, canvas.height);
    const base64 = canvas.toDataURL('image/jpeg', 0.9);

    // Trigger visual shutter flash
    setFlashActive(true);
    setTimeout(() => setFlashActive(false), 180);

    let nextAngle = null;
    if (angle === 'FRONT') nextAngle = 'LEFT';
    else if (angle === 'LEFT') nextAngle = 'RIGHT';

    setEnrollPhotos((prev) => {
      const filtered = prev.filter((p) => p.angle !== angle);
      const updated = [...filtered, { angle, imageBase64: base64 }];

      // Play audio feedback chime
      if (updated.length >= 3) {
        playBiometricChime('completed');
      } else {
        playBiometricChime('captured');
      }

      return updated;
    });

    // Advance angle automatically for convenient 1-2-3 flow
    if (nextAngle) {
      setEnrollActiveAngle(nextAngle);
    }
  };

  // Real-time Hands-Free Head Pose Auto-Tracking Loop
  useEffect(() => {
    let animId;
    let lastCheck = 0;

    const runPoseTracking = async (time) => {
      if (!showEnrollModal || !autoCaptureEnabled || enrollSubmitting) {
        return;
      }

      // If all 3 angles are already captured, stop auto-snapping
      if (enrollPhotos.length >= 3) {
        setPoseStatus({
          detected: true,
          angle: 'DONE',
          progress: 100,
          label: '✓ All 3 Angles Captured! Click Save to Complete'
        });
        return;
      }

      // Sample every 80ms (~12.5 FPS) for optimal responsiveness without CPU overhead
      if (time - lastCheck > 80) {
        lastCheck = time;
        if (enrollVideoRef.current && !isAutoSnappingRef.current) {
          const pose = await detectFaceAngle(enrollVideoRef.current, enrollActiveAngle);

          if (pose.detected && pose.angle === enrollActiveAngle) {
            // Angle matches required pose! Increment stability hold progress
            autoHoldProgressRef.current = Math.min(100, autoHoldProgressRef.current + 25);
            setPoseStatus({
              detected: true,
              angle: pose.angle,
              progress: autoHoldProgressRef.current,
              label: `Hold steady... (${autoHoldProgressRef.current}%)`
            });

            if (autoHoldProgressRef.current >= 100) {
              isAutoSnappingRef.current = true;
              handleCaptureEnrollPhoto(enrollActiveAngle);
              autoHoldProgressRef.current = 0;

              // Brief cooldown so user can hear the chime and turn to the next angle comfortably
              setTimeout(() => {
                isAutoSnappingRef.current = false;
              }, 750);
            }
          } else {
            // Decay progress if moved or changed angle
            autoHoldProgressRef.current = Math.max(0, autoHoldProgressRef.current - 15);
            setPoseStatus({
              detected: pose.detected,
              angle: pose.angle,
              progress: autoHoldProgressRef.current,
              label: pose.detected ? pose.label : 'Position face inside oval'
            });
          }
        }
      }

      animId = requestAnimationFrame(runPoseTracking);
    };

    if (showEnrollModal && autoCaptureEnabled) {
      autoHoldProgressRef.current = 0;
      isAutoSnappingRef.current = false;
      animId = requestAnimationFrame(runPoseTracking);
    }

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [showEnrollModal, autoCaptureEnabled, enrollActiveAngle, enrollSubmitting, enrollPhotos.length]);

  const handleSubmitFaceEnrollment = async () => {
    if (enrollPhotos.length === 0) {
      setEnrollError('Please capture at least one face photo (Front angle).');
      return;
    }
    setEnrollSubmitting(true);
    setEnrollError(null);
    try {
      const res = await api.student.registerFace({ photos: enrollPhotos });
      if (res.success) {
        setStatusMsg('Face profile successfully registered! You can now mark attendance.');
        stopEnrollCamera();
        setShowEnrollModal(false);
        setEnrollPhotos([]);
        setCheckinStep('idle');
        fetchStudentData();
      } else {
        setEnrollError(res.error || 'Failed to register face profile.');
      }
    } catch (err) {
      setEnrollError(err.message || 'Face enrollment failed. Ensure your face is centered with adequate lighting.');
    } finally {
      setEnrollSubmitting(false);
    }
  };

  // Check-In Step 3: Face Capture & Biometric Matching
  const handleVerifyFace = async () => {
    if (!videoRef.current || !sessionToken) return;

    setCheckinStep('verifying_face');
    setCheckinError(null);

    try {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const livePhotoBase64 = canvas.toDataURL('image/jpeg', 0.88);

      const res = await api.attendance.verifyFace({
        session_token: sessionToken,
        live_photo: livePhotoBase64
      });

      stopCamera();
      if (res.success) {
        setCheckinStep('success');
        setStatusMsg('Biometric attendance verified and recorded successfully!');
        fetchStudentData();
      } else {
        setCheckinError(res.error || 'Face verification failed.');
        setCheckinStep('failed');
      }
    } catch (err) {
      stopCamera();
      setCheckinError(err.message || 'Facial verification failed.');
      setCheckinStep('failed');
    }
  };

  // Submit Correction Form
  const handleSubmitCorrection = async (e) => {
    e.preventDefault();
    if (!correctionForm.reason.trim()) {
      setErrorMsg('Please specify a valid justification for the correction.');
      return;
    }
    setSubmittingCorrection(true);
    setErrorMsg(null);
    try {
      const res = await api.student.submitCorrection(correctionForm);
      setStatusMsg(res.message || 'Correction appeal submitted to warden/admin.');
      setCorrectionForm({ date: new Date().toISOString().split('T')[0], reason: '' });
      const corrRes = await api.student.getCorrections();
      if (corrRes?.success) setCorrections(corrRes.corrections || []);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to submit correction');
    } finally {
      setSubmittingCorrection(false);
    }
  };

  // Submit Support Ticket Form
  const handleSubmitTicket = async (e) => {
    e.preventDefault();
    if (!ticketForm.subject.trim() || !ticketForm.message.trim()) {
      setErrorMsg('Please fill in both subject and description.');
      return;
    }
    setSubmittingTicket(true);
    setErrorMsg(null);
    try {
      const res = await api.student.submitFeedback(ticketForm);
      setStatusMsg(res.message || 'Support ticket registered.');
      setTicketForm({ category: 'Hostel Facilities', subject: '', message: '' });
      const tickRes = await api.student.getFeedback();
      if (tickRes?.success) setTickets(tickRes.tickets || tickRes.feedback || []);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to submit ticket');
    } finally {
      setSubmittingTicket(false);
    }
  };

  const student = dashboard?.student || {};
  const stats = dashboard?.stats || {};
  const todayStatus = dashboard?.todayStatus || {};

  const getGreeting = (fullName) => {
    const hour = new Date().getHours();
    let tod = 'day';
    if (hour < 12) tod = 'morning';
    else if (hour < 17) tod = 'afternoon';
    else tod = 'evening';
    const firstName = fullName ? fullName.trim().split(' ')[0] : 'Resident';
    return `Good ${tod}, ${firstName}`;
  };

  const totalDays = stats.totalDaysRecorded || 0;
  const presentDays = stats.presentDays || 0;
  const absentDays = Math.max(0, totalDays - presentDays);
  const attendanceRate = stats.attendancePercentage !== undefined ? stats.attendancePercentage : 100;

  // Trend chart records
  const trendRecords = (history && history.length > 0) ? history.slice(0, 7).reverse() : [];
  const trendLabels = trendRecords.map(r => r.date ? r.date.slice(5) : '');
  const trendData = trendRecords.map(r => r.status === 'PRESENT' ? 100 : r.status === 'LATE' ? 75 : 0);

  return (
    <div className="container-fluid px-0">
      {/* Student Greeting & Summary Banner */}
      <div className="card shadow-sm border-0 rounded-4 mb-4 text-white overflow-hidden" style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)' }}>
        <div className="card-body p-4">
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-3">
            <div>
              <div className="text-primary-subtle small fw-medium text-uppercase mb-1" style={{ letterSpacing: '0.6px', fontSize: '11px' }}>
                {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </div>
              <h3 className="fw-bold mb-1 text-white">
                {getGreeting(student.full_name || user?.username)}
              </h3>
              <div className="text-muted small">
                Roll No: <span className="text-light fw-medium">{student.roll_number || user?.username}</span> &bull; {student.hostel_block || 'Hostel'} &bull; Rm {student.room_number || 'N/A'} &bull; {student.course || 'Resident'}
              </div>
            </div>

            {/* Today's Roll Call Status Indicator */}
            <div className="d-flex align-items-center gap-2">
              <div className={`px-3 py-2 rounded-3 border ${todayStatus.status === 'PRESENT' ? 'bg-success bg-opacity-15 border-success border-opacity-30 text-success' : 'bg-warning bg-opacity-15 border-warning border-opacity-30 text-warning'}`}>
                <div className="small text-muted" style={{ fontSize: '11px' }}>Today's Status</div>
                <div className="fw-bold fs-6">
                  {todayStatus.status === 'PRESENT' ? '✓ PRESENT' : 'ATTENDANCE REQUIRED'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4 Attendance Summary Metric Cards (Requirement #7) */}
      <div className="row g-3 mb-4">
        <div className="col-6 col-md-3">
          <div className="card border-0 shadow-sm rounded-4 p-3 bg-white h-100">
            <div className="text-muted small fw-medium">Overall Attendance</div>
            <div className="fw-bold fs-4 text-primary mt-1">{attendanceRate}%</div>
            <div className="text-muted small" style={{ fontSize: '11px' }}>Academic semester rate</div>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div className="card border-0 shadow-sm rounded-4 p-3 bg-white h-100">
            <div className="text-muted small fw-medium">Present Days</div>
            <div className="fw-bold fs-4 text-success mt-1">{presentDays}</div>
            <div className="text-muted small" style={{ fontSize: '11px' }}>Verified roll calls</div>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div className="card border-0 shadow-sm rounded-4 p-3 bg-white h-100">
            <div className="text-muted small fw-medium">Absent Days</div>
            <div className="fw-bold fs-4 text-danger mt-1">{absentDays}</div>
            <div className="text-muted small" style={{ fontSize: '11px' }}>Missed check-ins</div>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div className="card border-0 shadow-sm rounded-4 p-3 bg-white h-100">
            <div className="text-muted small fw-medium">Identity Status</div>
            <div className={`fw-bold fs-4 mt-1 ${stats.hasFaceRegistered ? 'text-success' : 'text-warning'}`}>
              {stats.hasFaceRegistered ? 'Active' : 'Pending'}
            </div>
            <div className="text-muted small" style={{ fontSize: '11px' }}>Biometric profile</div>
          </div>
        </div>
      </div>

      {/* Clean 7-Day Attendance Trend Chart (Requirement #7 & #21) */}
      {trendRecords.length > 0 && (
        <div className="card border-0 shadow-sm rounded-4 p-3 mb-4 bg-white">
          <div className="d-flex align-items-center justify-content-between mb-2">
            <div className="d-flex align-items-center gap-2">
              <Clock size={16} className="text-primary" />
              <span className="fw-semibold text-dark small">Recent Roll Call Trend</span>
            </div>
            <span className="badge bg-light text-muted small">Past {trendRecords.length} Sessions</span>
          </div>
          <div style={{ height: '110px' }}>
            <Line
              data={{
                labels: trendLabels,
                datasets: [{
                  label: 'Attendance Rate',
                  data: trendData,
                  borderColor: '#10b981',
                  backgroundColor: 'rgba(16, 185, 129, 0.08)',
                  fill: true,
                  tension: 0.35,
                  pointRadius: 4,
                  pointBackgroundColor: '#10b981'
                }]
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  y: { min: 0, max: 100, ticks: { callback: v => v === 100 ? 'Present' : v === 0 ? 'Absent' : '' }, grid: { display: false } },
                  x: { grid: { display: false } }
                },
                plugins: { legend: { display: false } }
              }}
            />
          </div>
        </div>
      )}

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

      {/* 1. Daily Attendance Tab */}
      {(activeTab === 'student_attendance' || !activeTab) && (
        <div className="row g-4 justify-content-center">
          <div className="col-lg-8">
            {/* Warning Banner if Facial Biometrics Not Yet Enrolled */}
            {dashboard && stats.hasFaceRegistered === false && (
              <div className="card border-warning border-opacity-50 bg-warning-subtle rounded-4 p-3 mb-4 shadow-sm text-start">
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                  <div className="d-flex align-items-center gap-2">
                    <AlertTriangle size={24} className="text-warning flex-shrink-0" />
                    <div>
                      <div className="fw-bold text-dark">Facial Biometrics Not Registered</div>
                      <div className="small text-muted">Complete your 10-second facial identity enrollment to enable one-tap biometric attendance.</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-warning fw-semibold btn-sm px-3 shadow-sm text-dark d-inline-flex align-items-center gap-1"
                    onClick={() => {
                      setShowEnrollModal(true);
                      startEnrollCamera();
                    }}
                  >
                    <Camera size={15} /> Complete Face Registration (10s)
                  </button>
                </div>
              </div>
            )}

            <div className="card shadow-sm border-0 rounded-4 overflow-hidden">
              <div className="card-header bg-white border-bottom py-3 d-flex justify-content-between align-items-center">
                <h6 className="card-title mb-0 fw-semibold d-flex align-items-center gap-2">
                  <UserCheck size={20} className="text-primary" />
                  Biometric Attendance Check-In
                </h6>
                <span className="badge bg-light text-dark">
                  {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                </span>
              </div>

              <div className="card-body p-4 text-center">
                {todayStatus.isMarkedToday ? (
                  /* Polished Confirmation Screen (Requirement #13) */
                  <div className="py-4 px-2">
                    <div className="d-inline-flex p-3 rounded-circle bg-success bg-opacity-10 text-success mb-3 shadow-sm">
                      <CheckCircle2 size={54} />
                    </div>
                    <h4 className="fw-bold text-success mb-1">Attendance Marked</h4>
                    <p className="text-muted small mb-4">You are marked <strong className="text-success">PRESENT</strong> for today's roll call.</p>

                    <div className="card bg-light border-0 rounded-4 p-3 mx-auto text-start shadow-sm" style={{ maxWidth: '380px' }}>
                      <div className="d-flex justify-content-between py-1.5 border-bottom">
                        <span className="text-muted small">Date</span>
                        <span className="fw-semibold text-dark small">{new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                      </div>
                      <div className="d-flex justify-content-between py-1.5 border-bottom">
                        <span className="text-muted small">Time Recorded</span>
                        <span className="fw-semibold text-dark small">{todayStatus.record?.time_marked || '7:18 PM'}</span>
                      </div>
                      <div className="d-flex justify-content-between py-1.5 border-bottom">
                        <span className="text-muted small">Location</span>
                        <span className="fw-semibold text-success small d-flex align-items-center gap-1">
                          <Check size={14} /> Verified
                        </span>
                      </div>
                      <div className="d-flex justify-content-between py-1.5">
                        <span className="text-muted small">Identity</span>
                        <span className="fw-semibold text-success small d-flex align-items-center gap-1">
                          <Check size={14} /> Verified
                        </span>
                      </div>
                    </div>
                    <div className="text-muted small mt-3" style={{ fontSize: '11.5px' }}>
                      Attendance recorded successfully. Have a safe and restful evening.
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Clear 4-Step Attendance Workflow (Section 7) */}
                    <div className="d-flex align-items-center justify-content-center gap-2 mb-4 px-2 flex-wrap">
                      <div className={`d-flex align-items-center gap-1.5 px-3 py-1.5 rounded-pill small fw-semibold ${checkinStep === 'idle' || checkinStep === 'verifying_gps' ? 'bg-primary text-white shadow-sm' : 'bg-light text-muted'}`}>
                        <span>1</span>
                        <span>Location</span>
                      </div>
                      <span className="text-muted small d-none d-sm-inline">➔</span>
                      <div className={`d-flex align-items-center gap-1.5 px-3 py-1.5 rounded-pill small fw-semibold ${checkinStep === 'camera_active' ? 'bg-primary text-white shadow-sm' : 'bg-light text-muted'}`}>
                        <span>2</span>
                        <span>Identity</span>
                      </div>
                      <span className="text-muted small d-none d-sm-inline">➔</span>
                      <div className={`d-flex align-items-center gap-1.5 px-3 py-1.5 rounded-pill small fw-semibold ${checkinStep === 'verifying_face' ? 'bg-primary text-white shadow-sm' : 'bg-light text-muted'}`}>
                        <span>3</span>
                        <span>Verification</span>
                      </div>
                      <span className="text-muted small d-none d-sm-inline">➔</span>
                      <div className={`d-flex align-items-center gap-1.5 px-3 py-1.5 rounded-pill small fw-semibold ${checkinStep === 'success' ? 'bg-success text-white shadow-sm' : 'bg-light text-muted'}`}>
                        <span>4</span>
                        <span>Complete</span>
                      </div>
                    </div>
                    {/* Geofence Boundary & Live Radar Map */}
                    <div className="mb-4 text-start">
                      <div className="d-flex justify-content-between align-items-center mb-2 px-1">
                        <span className="fw-semibold small text-muted d-flex align-items-center gap-1">
                          <MapPin size={15} className="text-primary" /> Geofence Boundary & Live Radar
                        </span>
                        <button
                          type="button"
                          className="btn btn-link btn-sm p-0 text-decoration-none text-primary fw-medium"
                          onClick={() => setShowMapRadar(!showMapRadar)}
                        >
                          {showMapRadar ? 'Hide Map' : 'Show Map'}
                        </button>
                      </div>
                      {showMapRadar && (
                        <GeofenceMap
                          centerLat={dashboard?.geofence?.latitude || 28.5355}
                          centerLng={dashboard?.geofence?.longitude || 77.3910}
                          radius={dashboard?.geofence?.radius_meters || 20}
                          locationName={dashboard?.geofence?.hostel_name || 'Hostel Campus Boundary'}
                          studentLat={studentCoords?.lat || null}
                          studentLng={studentCoords?.lng || null}
                          gpsAccuracy={studentCoords?.accuracy || null}
                          height="290px"
                          showLegend={true}
                          showDistanceBanner={true}
                        />
                      )}
                    </div>

                    {/* Real-World Attendance Window Status Banner */}
                    <div className="mb-4 text-start">
                      {scheduleStatus?.isHoliday ? (
                        <div className="alert alert-info border-info-subtle d-flex align-items-center gap-3 p-3 rounded-3 shadow-sm mb-0">
                          <Sparkles size={24} className="text-info flex-shrink-0" />
                          <div>
                            <div className="fw-bold text-dark">Today is a Campus Holiday: {scheduleStatus.title || 'Exempt'}</div>
                            <div className="small text-muted">{scheduleStatus.notes || 'Attendance check-in is suspended/exempt for today. Enjoy your day!'}</div>
                          </div>
                        </div>
                      ) : scheduleStatus?.enforced ? (
                        scheduleStatus.isOpen ? (
                          <div className="p-3 rounded-3 border border-success-subtle bg-success-subtle shadow-sm">
                            <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                              <div className="d-flex align-items-center gap-2">
                                <span className="spinner-grow spinner-grow-sm text-success" style={{ width: '9px', height: '9px' }} />
                                <span className="fw-bold text-success">
                                  Attendance Window is OPEN NOW ({scheduleStatus.startTime12} – {scheduleStatus.endTime12})
                                </span>
                              </div>
                              <span className="badge bg-success text-white px-2.5 py-1">
                                {scheduleStatus.remainingMinutes} min remaining
                              </span>
                            </div>
                            <div className="small text-dark text-opacity-75 mt-1">
                              {scheduleStatus.notes || `Please submit your GPS and facial identity verification before ${scheduleStatus.endTime12}.`}
                            </div>
                          </div>
                        ) : (
                          <div className="p-3 rounded-3 border border-warning-subtle bg-warning-subtle shadow-sm">
                            <div className="d-flex align-items-center gap-2 mb-1">
                              <Clock size={16} className="text-warning flex-shrink-0" />
                              <span className="fw-bold text-dark">
                                Attendance Window is Currently Closed
                              </span>
                              <span className="badge bg-warning text-dark ms-auto">
                                {scheduleStatus.startsInMinutes ? `Opens in ${scheduleStatus.startsInMinutes} min` : 'Window Closed'}
                              </span>
                            </div>
                            <div className="small text-muted">
                              {scheduleStatus.message || `Scheduled attendance hours: ${scheduleStatus.startTime12 || '7:00 PM'} to ${scheduleStatus.endTime12 || '7:30 PM'}.`}
                            </div>
                          </div>
                        )
                      ) : (
                        <div className="p-2.5 rounded-3 bg-light border text-muted small d-flex align-items-center gap-2">
                          <Clock size={14} className="text-primary" />
                          <span>Attendance Time Window: 24/7 Open (Admin enforcement off)</span>
                        </div>
                      )}
                    </div>

                    {/* Check-In Progress State */}
                    {checkinStep === 'idle' && (
                      <div className="py-2">
                        {scheduleStatus?.isHoliday ? (
                          <div className="py-3 text-center">
                            <Sparkles size={44} className="text-info mb-2" />
                            <h5 className="fw-bold text-dark">Attendance Exempt for Today</h5>
                            <p className="text-muted small mb-0">No roll call required due to the scheduled campus event or holiday.</p>
                          </div>
                        ) : scheduleStatus?.enforced && !scheduleStatus?.isOpen ? (
                          <div>
                            <h5 className="fw-bold mb-1 text-muted">Attendance Not Currently Available</h5>
                            <p className="text-muted small mx-auto mb-3" style={{ maxWidth: '440px' }}>
                              Available today: <strong>{scheduleStatus.startTime12 || '7:00 PM'} – {scheduleStatus.endTime12 || '7:30 PM'}</strong>
                            </p>
                            <button
                              className="btn btn-secondary px-4 py-2.5 fw-semibold d-inline-flex align-items-center gap-2 shadow-sm rounded-3"
                              disabled
                              title="Attendance window is currently closed"
                            >
                              <Clock size={18} /> Attendance Opens at {scheduleStatus.startTime12 || '7:00 PM'}
                            </button>
                          </div>
                        ) : (
                          <div>
                            <h5 className="fw-bold mb-1">Confirm Your Hostel Location</h5>
                            <p className="text-muted small mx-auto mb-3" style={{ maxWidth: '440px' }}>
                              Please verify your device is inside the hostel attendance area to start verification.
                            </p>
                            <button
                              className="btn btn-primary px-4 py-2.5 fw-semibold d-inline-flex align-items-center gap-2 shadow-sm rounded-3"
                              onClick={handleVerifyLocation}
                            >
                              <Navigation size={18} /> ✓ Mark Attendance
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {checkinStep === 'verifying_gps' && (
                      <div className="py-4">
                        <div className="spinner-border text-primary mb-3" role="status"></div>
                        <h6 className="fw-semibold mb-1">Confirming Location...</h6>
                        <p className="text-muted small">
                          Verifying that you are physically inside the hostel attendance area.
                        </p>
                      </div>
                    )}

                    {(checkinStep === 'camera_active' || checkinStep === 'verifying_face') && (
                      <div className="py-2">
                        <div className="position-relative d-inline-block rounded-4 overflow-hidden shadow-sm mb-2" style={{ maxWidth: '440px', width: '100%', backgroundColor: '#000' }}>
                          <video
                            ref={attachVideoRef}
                            autoPlay
                            playsInline
                            muted
                            controls={false}
                            style={{
                              width: '100%',
                              height: 'auto',
                              minHeight: '260px',
                              maxHeight: '380px',
                              objectFit: 'cover',
                              transform: 'scaleX(-1)',
                              display: 'block',
                              backgroundColor: '#000'
                            }}
                            onLoadedMetadata={(e) => {
                              e.target.play().catch(console.warn);
                            }}
                          />
                          {/* Face Oval Guide */}
                          <div
                            style={{
                              position: 'absolute',
                              top: '15%',
                              left: '25%',
                              width: '50%',
                              height: '70%',
                              border: '2px dashed #10b981',
                              borderRadius: '50%',
                              pointerEvents: 'none',
                              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.35)'
                            }}
                          ></div>
                        </div>

                        <div className="d-flex justify-content-center gap-2 mb-3">
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-1 shadow-sm"
                            onClick={() => {
                              if (videoRef.current && streamRef.current) {
                                videoRef.current.srcObject = streamRef.current;
                                videoRef.current.play().catch(console.warn);
                              } else {
                                startCamera();
                              }
                            }}
                          >
                            <RefreshCw size={13} /> Reload Camera Feed
                          </button>
                        </div>

                        <div>
                          <p className="text-muted small mb-3">
                            <Sparkles size={14} className="text-primary me-1 inline" />
                            Look directly at the camera and position your face inside the green frame.
                          </p>
                          <button
                            className="btn btn-success px-4 py-2.5 fw-semibold d-inline-flex align-items-center gap-2 rounded-3 shadow-sm"
                            onClick={handleVerifyFace}
                            disabled={checkinStep === 'verifying_face'}
                          >
                            {checkinStep === 'verifying_face' ? (
                              <>
                                <span className="spinner-border spinner-border-sm" role="status"></span>
                                Verifying Identity...
                              </>
                            ) : (
                              <>
                                <Camera size={18} /> ✓ Verify Identity &amp; Confirm Attendance
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {checkinStep === 'success' && (
                      <div className="py-4 px-2">
                        <div className="d-inline-flex p-3 rounded-circle bg-success bg-opacity-10 text-success mb-3 shadow-sm">
                          <CheckCircle2 size={54} />
                        </div>
                        <h4 className="fw-bold text-success mb-1">Attendance Marked</h4>
                        <p className="text-muted small mb-4">You are marked <strong className="text-success">PRESENT</strong> for today's roll call.</p>

                        <div className="card bg-light border-0 rounded-4 p-3 mx-auto text-start shadow-sm" style={{ maxWidth: '380px' }}>
                          <div className="d-flex justify-content-between py-1.5 border-bottom">
                            <span className="text-muted small">Date</span>
                            <span className="fw-semibold text-dark small">{new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                          </div>
                          <div className="d-flex justify-content-between py-1.5 border-bottom">
                            <span className="text-muted small">Time Recorded</span>
                            <span className="fw-semibold text-dark small">{new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}</span>
                          </div>
                          <div className="d-flex justify-content-between py-1.5 border-bottom">
                            <span className="text-muted small">Location</span>
                            <span className="fw-semibold text-success small d-flex align-items-center gap-1">
                              <Check size={14} /> Verified
                            </span>
                          </div>
                          <div className="d-flex justify-content-between py-1.5">
                            <span className="text-muted small">Identity</span>
                            <span className="fw-semibold text-success small d-flex align-items-center gap-1">
                              <Check size={14} /> Verified
                            </span>
                          </div>
                        </div>
                        <div className="text-muted small mt-3" style={{ fontSize: '11.5px' }}>
                          Attendance recorded successfully.
                        </div>
                      </div>
                    )}

                    {checkinStep === 'failed' && (
                      <div className="py-4">
                        <AlertTriangle size={56} className="text-danger mb-3" />
                        <h5 className="fw-bold text-danger mb-2">Check-In Verification Failed</h5>
                        <div className="alert alert-danger py-2 px-3 small mx-auto mb-3" style={{ maxWidth: '460px' }}>
                          {checkinError || 'Verification was rejected.'}
                        </div>

                        {/* CASE A: Missing Facial Registration / Onboarding */}
                        {(checkinError?.toLowerCase().includes('facial embeddings') || checkinError?.toLowerCase().includes('face profile') || checkinError?.toLowerCase().includes('onboarding')) ? (
                          <div className="d-flex flex-column align-items-center gap-2">
                            <div className="card bg-warning-subtle border-warning border-opacity-25 p-3 rounded-3 mb-2 text-start" style={{ maxWidth: '440px' }}>
                              <div className="fw-bold text-dark small mb-1">📸 Identity Verification Required</div>
                              <div className="small text-muted">
                                Your facial profile is not yet registered in the hostel system. Please complete your face enrollment to mark attendance.
                              </div>
                            </div>
                            <button
                              type="button"
                              className="btn btn-warning px-4 py-2 fw-semibold d-inline-flex align-items-center gap-2 shadow-sm text-dark"
                              onClick={() => {
                                setShowEnrollModal(true);
                                startEnrollCamera();
                              }}
                            >
                              <Camera size={18} /> Enroll Face Identity (10s)
                            </button>
                          </div>
                        ) : checkinError?.toLowerCase().includes('locked') ? (
                          /* CASE B: Account is Locked by Security Policy */
                          <div className="d-flex flex-column align-items-center gap-2">
                            <div className="card bg-danger-subtle border-danger border-opacity-25 p-3 rounded-3 mb-2 text-start" style={{ maxWidth: '440px' }}>
                              <div className="fw-bold text-danger small mb-1">🔒 Security Lockout Active</div>
                              <div className="small text-muted">
                                Your account is locked from roll call check-in. The hostel administrator or warden must clear your strikes in the Admin Security Desk.
                              </div>
                            </div>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm px-4 fw-semibold d-inline-flex align-items-center gap-1 shadow-sm"
                              onClick={() => {
                                if (onSelectTab) onSelectTab('student_support');
                                setTicketForm({
                                   category: 'ATTENDANCE',
                                  subject: `Strike Reset Appeal - Roll ${student.roll_number || user?.username}`,
                                  message: 'My check-in triggered a strike lockout due to GPS sensor variance inside the hostel room. Please reset my strikes in the Security Incident Desk so I can complete roll call.'
                                });
                              }}
                            >
                              <LifeBuoy size={14} /> Submit Strike Appeal to Warden
                            </button>
                          </div>
                        ) : (checkinError?.toLowerCase().includes('physically present') || checkinError?.toLowerCase().includes('anti-spoof') || checkinError?.toLowerCase().includes('liveness') || checkinError?.toLowerCase().includes('match') || checkinError?.toLowerCase().includes('camera') || checkinError?.toLowerCase().includes('facial') || checkinError?.toLowerCase().includes('photo')) ? (
                          /* CASE C: Face or Liveness Verification Notice (Section 24) */
                          <div className="d-flex flex-column align-items-center gap-2">
                            <div className="card bg-warning-subtle border-warning border-opacity-25 p-3 rounded-3 mb-2 text-start" style={{ maxWidth: '440px' }}>
                              <div className="fw-bold text-dark small mb-1 d-flex align-items-center gap-1">
                                <AlertTriangle size={15} className="text-warning" /> Face Verification Notice
                              </div>
                              <div className="small text-dark">
                                We couldn't verify that you're physically present. Please look directly at the camera in good lighting and try again.
                              </div>
                            </div>
                            <button
                              className="btn btn-primary btn-sm px-4 fw-semibold d-inline-flex align-items-center gap-1 shadow-sm"
                              onClick={() => {
                                setCheckinStep('camera_active');
                                startCamera();
                              }}
                            >
                              <RefreshCw size={14} /> Try Face Verification Again
                            </button>
                            <div className="text-muted small mt-1" style={{ fontSize: '11px', maxWidth: '380px' }}>
                              💡 <strong>Tip:</strong> Please try again in better lighting. Avoid backlighting or tilted angles.
                            </div>
                          </div>
                        ) : (
                          /* CASE D: Standard Location / Accuracy Issue */
                          <div className="d-flex flex-column align-items-center gap-2">
                            <div className="card bg-danger-subtle border-danger border-opacity-25 p-3 rounded-3 mb-2 text-start" style={{ maxWidth: '440px' }}>
                              <div className="fw-bold text-danger small mb-1 d-flex align-items-center gap-1">
                                <AlertTriangle size={15} /> Outside Attendance Area
                              </div>
                              <div className="small text-danger">
                                You are outside the authorized hostel attendance area. Please move closer to the hostel and try again.
                              </div>
                            </div>
                            <button
                              className="btn btn-primary btn-sm px-4 fw-semibold d-inline-flex align-items-center gap-1 shadow-sm"
                              onClick={handleVerifyLocation}
                            >
                              <RefreshCw size={14} /> Check Location Again
                            </button>
                            <div className="text-muted small mt-1" style={{ fontSize: '11px', maxWidth: '380px' }}>
                              💡 <strong>Tip:</strong> Turning on your phone's Wi-Fi helps your device lock onto campus location beacons instantly.
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Attendance History Tab */}
      {activeTab === 'student_history' && (
        <div className="card shadow-sm border-0 rounded-4">
          <div className="card-header bg-white border-bottom py-3">
            <h6 className="card-title mb-0 fw-semibold d-flex align-items-center gap-2">
              <History size={18} className="text-primary" />
              My Attendance History ({history.length} Records)
            </h6>
          </div>
          <div className="card-body p-0">
            {history.length === 0 ? (
              <div className="text-center p-5 text-muted small">No attendance records found yet.</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead className="table-light">
                    <tr className="small text-muted">
                      <th className="ps-3">Date</th>
                      <th>Check-in Time</th>
                      <th>Status</th>
                      <th>Method</th>
                      <th className="pe-3">Recorded Distance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id || h.date}>
                        <td className="ps-3 fw-medium text-dark">{h.date}</td>
                        <td>
                          {h.time_marked ? (
                            <span className="small text-dark"><Clock size={12} className="me-1 inline text-muted" />{formatDisplayTime12h(h.time_marked)}</span>
                          ) : (
                            <span className="small text-muted">&mdash;</span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${h.status === 'PRESENT' ? 'bg-success' : h.status === 'OVERRIDDEN' ? 'bg-primary' : 'bg-secondary'}`}>
                            {h.status}
                          </span>
                        </td>
                        <td><small className="text-muted">{h.verification_method || 'Facial Match'}</small></td>
                        <td className="pe-3">
                          <small className="text-muted">{h.distance_meters ? `${h.distance_meters.toFixed(1)}m` : 'N/A'}</small>
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

      {/* 3. Submit Correction Tab */}
      {activeTab === 'student_correction' && (
        <div className="row g-4">
          <div className="col-lg-5">
            <div className="card shadow-sm border-0 rounded-4">
              <div className="card-header bg-white border-bottom py-3">
                <h6 className="card-title mb-0 fw-semibold d-flex align-items-center gap-2">
                  <FileCheck2 size={18} className="text-primary" />
                  Submit Attendance Appeal
                </h6>
              </div>
              <div className="card-body p-4">
                <form onSubmit={handleSubmitCorrection}>
                  <div className="mb-3">
                    <label className="form-label small fw-medium">Contested Date</label>
                    <input
                      type="date"
                      className="form-control form-control-sm"
                      value={correctionForm.date}
                      onChange={(e) => setCorrectionForm({ ...correctionForm, date: e.target.value })}
                      required
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label small fw-medium">Justification Reason</label>
                    <textarea
                      className="form-control"
                      rows="4"
                      placeholder="e.g., On official college tech fest duty; leave letter submitted to warden."
                      value={correctionForm.reason}
                      onChange={(e) => setCorrectionForm({ ...correctionForm, reason: e.target.value })}
                      required
                    />
                  </div>
                  <button type="submit" className="btn btn-primary btn-sm w-100" disabled={submittingCorrection}>
                    {submittingCorrection ? 'Submitting...' : 'Submit Appeal to Warden'}
                  </button>
                </form>
              </div>
            </div>
          </div>

          <div className="col-lg-7">
            <div className="card shadow-sm border-0 rounded-4">
              <div className="card-header bg-white border-bottom py-3">
                <h6 className="card-title mb-0 fw-semibold">My Submitted Correction Appeals ({corrections.length})</h6>
              </div>
              <div className="card-body p-0">
                {corrections.length === 0 ? (
                  <div className="text-center p-4 text-muted small">No appeals submitted.</div>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                      <thead className="table-light">
                        <tr className="small text-muted">
                          <th className="ps-3">Date</th>
                          <th>Reason</th>
                          <th>Status</th>
                          <th className="pe-3">Resolution Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {corrections.map((c) => (
                          <tr key={c.id}>
                            <td className="ps-3 fw-medium text-dark">{c.date}</td>
                            <td style={{ maxWidth: '240px' }}><div className="small text-truncate" title={c.reason}>{c.reason}</div></td>
                            <td>
                              <span className={`badge ${c.status === 'APPROVED' ? 'bg-success' : c.status === 'REJECTED' ? 'bg-danger' : 'bg-warning text-dark'}`}>
                                {c.status}
                              </span>
                            </td>
                            <td className="pe-3 small text-muted">{c.review_notes || c.resolution_note || '&mdash;'}</td>
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
      )}

      {/* 4. Support & Feedback Tab */}
      {activeTab === 'student_support' && (
        <div className="row g-4">
          <div className="col-lg-5">
            <div className="card shadow-sm border-0 rounded-4">
              <div className="card-header bg-white border-bottom py-3">
                <h6 className="card-title mb-0 fw-semibold d-flex align-items-center gap-2">
                  <LifeBuoy size={18} className="text-primary" />
                  Register Facility Grievance
                </h6>
              </div>
              <div className="card-body p-4">
                <form onSubmit={handleSubmitTicket}>
                  <div className="mb-3">
                    <label className="form-label small fw-medium">Category</label>
                    <select
                      className="form-select form-select-sm"
                      value={ticketForm.category}
                      onChange={(e) => setTicketForm({ ...ticketForm, category: e.target.value })}
                    >
                      <option value="Hostel Facilities">Hostel Facilities & Maintenance</option>
                      <option value="Wi-Fi / Internet">Wi-Fi & Connectivity</option>
                      <option value="Mess & Food">Mess & Food Service</option>
                      <option value="App / Technical">Attendance App / Biometrics</option>
                    </select>
                  </div>
                  <div className="mb-3">
                    <label className="form-label small fw-medium">Subject</label>
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      placeholder="e.g., Water leakage in bathroom 2nd floor"
                      value={ticketForm.subject}
                      onChange={(e) => setTicketForm({ ...ticketForm, subject: e.target.value })}
                      required
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label small fw-medium">Detailed Description</label>
                    <textarea
                      className="form-control"
                      rows="4"
                      placeholder="Please provide specific room or floor details..."
                      value={ticketForm.message}
                      onChange={(e) => setTicketForm({ ...ticketForm, message: e.target.value })}
                      required
                    />
                  </div>
                  <button type="submit" className="btn btn-primary btn-sm w-100" disabled={submittingTicket}>
                    {submittingTicket ? 'Submitting...' : 'Send Grievance Ticket'}
                  </button>
                </form>
              </div>
            </div>
          </div>

          <div className="col-lg-7">
            <div className="card shadow-sm border-0 rounded-4">
              <div className="card-header bg-white border-bottom py-3">
                <h6 className="card-title mb-0 fw-semibold">My Grievance Tickets ({tickets.length})</h6>
              </div>
              <div className="card-body p-0">
                {tickets.length === 0 ? (
                  <div className="text-center p-4 text-muted small">No tickets submitted.</div>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                      <thead className="table-light">
                        <tr className="small text-muted">
                          <th className="ps-3">Subject</th>
                          <th>Category</th>
                          <th>Status</th>
                          <th className="pe-3">Warden Response</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tickets.map((t) => (
                          <tr key={t.id}>
                            <td className="ps-3">
                              <div className="fw-semibold text-dark small">{t.subject}</div>
                              <div className="small text-muted text-truncate" style={{ maxWidth: '200px' }}>{t.message}</div>
                            </td>
                            <td><span className="badge bg-light text-dark">{t.category}</span></td>
                            <td>
                              <span className={`badge ${t.status === 'RESOLVED' ? 'bg-success' : 'bg-warning text-dark'}`}>
                                {t.status}
                              </span>
                            </td>
                            <td className="pe-3 small text-muted">{t.admin_response || t.resolution_note || '&mdash;'}</td>
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
      )}

      {/* 5. Student Profile Tab */}
      {activeTab === 'student_profile' && (
        <div className="card shadow-sm border-0 rounded-4 p-4">
          <h5 className="fw-bold mb-3 d-flex align-items-center gap-2">
            <User size={20} className="text-primary" />
            Official Roster Profile & Security Parameters
          </h5>
          <div className="row g-3 small">
            <div className="col-md-6">
              <div className="p-3 bg-light rounded-3">
                <div className="text-muted">Full Name</div>
                <div className="fw-semibold fs-6 text-dark">{student.full_name || 'N/A'}</div>
              </div>
            </div>
            <div className="col-md-6">
              <div className="p-3 bg-light rounded-3">
                <div className="text-muted">Roll Number</div>
                <div className="fw-semibold fs-6 text-primary">{student.roll_number || user?.username}</div>
              </div>
            </div>
            <div className="col-md-4">
              <div className="p-3 bg-light rounded-3">
                <div className="text-muted">Hostel Block</div>
                <div className="fw-medium text-dark">{student.hostel_block || 'Block A'}</div>
              </div>
            </div>
            <div className="col-md-4">
              <div className="p-3 bg-light rounded-3">
                <div className="text-muted">Assigned Room</div>
                <div className="fw-medium text-dark">Room {student.room_number || 'N/A'}</div>
              </div>
            </div>
            <div className="col-md-4">
              <div className="p-3 bg-light rounded-3">
                <div className="text-muted">Academic Program</div>
                <div className="fw-medium text-dark">{student.course || 'B.Tech'} (Sem {student.semester || 1})</div>
              </div>
            </div>
            <div className="col-md-6">
              <div className="p-3 bg-light rounded-3 d-flex justify-content-between align-items-center">
                <div>
                  <div className="text-muted">Identity Verification</div>
                  <div className={`fw-medium ${stats.hasFaceRegistered ? 'text-success' : 'text-warning'}`}>
                    {stats.hasFaceRegistered ? 'Active • Identity Verified' : 'Pending Enrollment'}
                  </div>
                </div>
                <button
                  type="button"
                  className={`btn btn-sm ${stats.hasFaceRegistered ? 'btn-outline-primary' : 'btn-primary'} fw-medium d-inline-flex align-items-center gap-1`}
                  onClick={() => {
                    setShowEnrollModal(true);
                    startEnrollCamera();
                  }}
                >
                  <Camera size={14} />
                  {stats.hasFaceRegistered ? 'Update Face Profile' : 'Enroll Face'}
                </button>
              </div>
            </div>
            <div className="col-md-6">
              <div className="p-3 bg-light rounded-3">
                <div className="text-muted">Location Standing</div>
                <div className={`fw-medium ${stats.failedStrikes > 0 ? 'text-danger' : 'text-success'}`}>
                  {stats.failedStrikes > 0 ? `${stats.failedStrikes} Security Warnings` : 'Normal • In Good Standing'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. Biometric Face Enrollment Modal */}
      {showEnrollModal && (
        <div
          className="modal fade show d-block"
          style={{ backgroundColor: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)', zIndex: 1055 }}
          tabIndex="-1"
          role="dialog"
        >
          <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: '480px' }}>
            <div className="modal-content rounded-4 border-0 shadow-lg overflow-hidden">
              <div className="modal-header bg-dark text-white border-0 py-3 px-4">
                <h5 className="modal-title fw-bold fs-6 d-flex align-items-center gap-2">
                  <Camera size={18} className="text-primary" />
                  Facial Biometrics Enrollment
                </h5>
                <button
                  type="button"
                  className="btn-close btn-close-white"
                  aria-label="Close"
                  onClick={() => {
                    stopEnrollCamera();
                    setShowEnrollModal(false);
                  }}
                ></button>
              </div>

              <div className="modal-body p-4 text-center">
                {enrollError && (
                  <div className="alert alert-danger py-2 px-3 small d-flex align-items-center gap-2 mb-3 text-start">
                    <AlertTriangle size={16} className="flex-shrink-0" />
                    <div>{enrollError}</div>
                  </div>
                )}

                <div className="mb-2">
                  <div className="d-flex justify-content-center gap-2 mb-2">
                    {['FRONT', 'LEFT', 'RIGHT'].map((ang) => {
                      const isCaptured = enrollPhotos.some((p) => p.angle === ang);
                      const isActive = enrollActiveAngle === ang;
                      return (
                        <button
                          key={ang}
                          type="button"
                          className={`btn btn-sm px-3 rounded-pill fw-medium ${
                            isCaptured
                              ? 'btn-success text-white'
                              : isActive
                              ? 'btn-primary'
                              : 'btn-outline-secondary'
                          }`}
                          onClick={() => setEnrollActiveAngle(ang)}
                        >
                          {isCaptured ? <Check size={12} className="me-1 inline" /> : null}
                          {ang === 'FRONT' ? '1. Front' : ang === 'LEFT' ? '2. Left Angle' : '3. Right Angle'}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-muted small mb-2">
                    {enrollActiveAngle === 'FRONT'
                      ? 'Look directly at the camera with a neutral expression.'
                      : enrollActiveAngle === 'LEFT'
                      ? 'Turn your head slightly to the left (~15°).'
                      : 'Turn your head slightly to the right (~15°).'}
                  </p>
                  {autoCaptureEnabled && (
                    <div className="d-inline-flex align-items-center gap-1 px-2 py-1 rounded bg-success-subtle text-success small fw-medium mb-3">
                      <Zap size={13} />
                      <span>Hands-Free Auto-Capture ON: Just hold the requested angle steady!</span>
                    </div>
                  )}
                </div>

                {/* Viewport */}
                <div
                  className="position-relative d-inline-block rounded-4 overflow-hidden shadow mb-3"
                  style={{ width: '100%', maxWidth: '400px', height: '280px', backgroundColor: '#000' }}
                >
                  <video
                    ref={attachEnrollVideoRef}
                    autoPlay
                    playsInline
                    muted
                    controls={false}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      transform: 'scaleX(-1)',
                      display: 'block'
                    }}
                    onLoadedMetadata={(e) => e.target.play().catch(console.warn)}
                  />

                  {/* Face Guide Oval with Real-Time Pose Glow */}
                  <div
                    style={{
                      position: 'absolute',
                      top: '12%',
                      left: '25%',
                      width: '50%',
                      height: '76%',
                      border:
                        poseStatus.progress > 0
                          ? '3px solid #10b981'
                          : poseStatus.detected && poseStatus.angle === enrollActiveAngle
                          ? '2px solid #10b981'
                          : '2px dashed rgba(16, 185, 129, 0.65)',
                      borderRadius: '50%',
                      pointerEvents: 'none',
                      boxShadow:
                        poseStatus.progress > 0
                          ? '0 0 22px rgba(16, 185, 129, 0.85), 0 0 0 9999px rgba(0, 0, 0, 0.42)'
                          : '0 0 0 9999px rgba(0, 0, 0, 0.35)',
                      transition: 'all 0.15s ease'
                    }}
                  />

                  {/* Shutter Flash Animation */}
                  {flashActive && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        backgroundColor: '#ffffff',
                        opacity: 0.85,
                        zIndex: 20,
                        pointerEvents: 'none'
                      }}
                    />
                  )}

                  {/* Hands-Free Live Guidance Badge */}
                  <div
                    className="position-absolute start-50 translate-middle-x px-3 py-1 rounded-pill small fw-semibold text-white shadow-sm d-flex align-items-center gap-2"
                    style={{
                      bottom: '12px',
                      backgroundColor: poseStatus.progress > 0 ? 'rgba(16, 185, 129, 0.95)' : 'rgba(15, 23, 42, 0.82)',
                      backdropFilter: 'blur(8px)',
                      border: poseStatus.progress > 0 ? '1px solid #10b981' : '1px solid rgba(255, 255, 255, 0.15)',
                      fontSize: '11px',
                      zIndex: 15,
                      transition: 'all 0.18s ease',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {autoCaptureEnabled && (
                      <Zap
                        size={12}
                        className={poseStatus.progress > 0 ? 'text-warning' : 'text-success'}
                      />
                    )}
                    <span>
                      {poseStatus.label || (autoCaptureEnabled ? 'Align your face in oval' : 'Ready to capture')}
                    </span>
                    {autoCaptureEnabled && poseStatus.progress > 0 && (
                      <span className="badge bg-white text-success fw-bold px-1.5 py-0" style={{ fontSize: '10px' }}>
                        {poseStatus.progress}%
                      </span>
                    )}
                  </div>

                  {/* Stability Hold Progress Bar */}
                  {autoCaptureEnabled && poseStatus.progress > 0 && (
                    <div
                      className="position-absolute bottom-0 start-0 w-100"
                      style={{ height: '4px', backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 16 }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${poseStatus.progress}%`,
                          backgroundColor: '#10b981',
                          boxShadow: '0 0 8px #10b981',
                          transition: 'width 0.08s linear'
                        }}
                      />
                    </div>
                  )}
                </div>

                <div className="d-flex justify-content-center align-items-center gap-2 mb-3 flex-wrap">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-1 shadow-sm"
                    onClick={() => {
                      if (enrollVideoRef.current && enrollStreamRef.current) {
                        enrollVideoRef.current.srcObject = enrollStreamRef.current;
                        enrollVideoRef.current.play().catch(console.warn);
                      } else {
                        startEnrollCamera();
                      }
                    }}
                  >
                    <RefreshCw size={13} /> Restart Camera
                  </button>

                  <button
                    type="button"
                    className={`btn btn-sm d-inline-flex align-items-center gap-1 shadow-sm ${
                      autoCaptureEnabled ? 'btn-success text-white' : 'btn-outline-secondary'
                    }`}
                    onClick={() => setAutoCaptureEnabled(!autoCaptureEnabled)}
                    title={autoCaptureEnabled ? 'Hands-Free Auto Snap is ON' : 'Turn Auto-Snap ON'}
                  >
                    <Zap size={13} />
                    {autoCaptureEnabled ? 'Auto-Snap: ON' : 'Auto-Snap: OFF'}
                  </button>

                  <button
                    type="button"
                    className="btn btn-primary btn-sm px-3 fw-semibold d-inline-flex align-items-center gap-1 shadow-sm"
                    onClick={() => handleCaptureEnrollPhoto(enrollActiveAngle)}
                  >
                    <Camera size={14} /> Snap {enrollActiveAngle} Photo
                  </button>

                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm p-1 px-2"
                    onClick={() => playBiometricChime('captured')}
                    title="Test Audio Chime"
                  >
                    <Volume2 size={13} />
                  </button>
                </div>

                {/* Captured previews */}
                {enrollPhotos.length > 0 && (
                  <div className="d-flex justify-content-center gap-2 mb-3 p-2 bg-light rounded-3">
                    {enrollPhotos.map((p) => (
                      <div key={p.angle} className="position-relative text-center">
                        <img
                          src={p.imageBase64}
                          alt={p.angle}
                          className="rounded-2 border border-2 border-success"
                          style={{ width: '64px', height: '64px', objectFit: 'cover' }}
                        />
                        <span className="badge bg-dark position-absolute bottom-0 start-50 translate-middle-x" style={{ fontSize: '9px' }}>
                          {p.angle}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="d-grid gap-2">
                  <button
                    type="button"
                    className="btn btn-success fw-bold py-2 shadow-sm d-flex align-items-center justify-content-center gap-2"
                    disabled={enrollPhotos.length === 0 || enrollSubmitting}
                    onClick={handleSubmitFaceEnrollment}
                  >
                    {enrollSubmitting ? (
                      <>
                        <span className="spinner-border spinner-border-sm" role="status"></span>
                        Saving & Verifying Face Profile...
                      </>
                    ) : (
                      <>
                        <Check size={18} />
                        Save Biometric Profile ({enrollPhotos.length} / 3 Captured)
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => {
                      stopEnrollCamera();
                      setShowEnrollModal(false);
                    }}
                    disabled={enrollSubmitting}
                  >
                    Cancel
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
