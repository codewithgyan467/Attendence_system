import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { getNativeOrBrowserLocation, isNativeMobile } from '../../utils/nativeHardware';
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
  Sparkles
} from 'lucide-react';

export default function StudentPortal({ activeTab = 'student_attendance', onSelectTab }) {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [history, setHistory] = useState([]);
  const [corrections, setCorrections] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [gpsLiveAccuracy, setGpsLiveAccuracy] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

  // Daily Check-in flow state: 'idle' | 'verifying_gps' | 'gps_ok' | 'camera_active' | 'verifying_face' | 'success' | 'failed'
  const [checkinStep, setCheckinStep] = useState('idle');
  const [sessionToken, setSessionToken] = useState(null);
  const [verifiedDistance, setVerifiedDistance] = useState(null);
  const [checkinError, setCheckinError] = useState(null);

  // Live Camera
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);

  // Forms
  const [correctionForm, setCorrectionForm] = useState({ date: new Date().toISOString().split('T')[0], reason: '' });
  const [submittingCorrection, setSubmittingCorrection] = useState(false);

  const [ticketForm, setTicketForm] = useState({ category: 'Hostel Facilities', subject: '', message: '' });
  const [submittingTicket, setSubmittingTicket] = useState(false);

  useEffect(() => {
    fetchStudentData();
    return () => stopCamera();
  }, []);

  const fetchStudentData = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [dashRes, histRes, corrRes, tickRes] = await Promise.allSettled([
        api.student.getDashboard(),
        api.student.getHistory(),
        api.student.getCorrections(),
        api.student.getFeedback()
      ]);

      if (dashRes.status === 'fulfilled' && dashRes.value.success) setDashboard(dashRes.value);
      if (histRes.status === 'fulfilled' && histRes.value.success) setHistory(histRes.value.records || []);
      if (corrRes.status === 'fulfilled' && corrRes.value.success) setCorrections(corrRes.value.corrections || []);
      if (tickRes.status === 'fulfilled' && tickRes.value.success) setTickets(tickRes.value.feedback || []);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to load student data');
    } finally {
      setLoading(false);
    }
  };

  // Check-In Step 1: GPS Verification (Native Android Hardware via Capacitor or Browser fallback)
  const handleVerifyLocation = async () => {
    setCheckinStep('verifying_gps');
    setCheckinError(null);
    setGpsLiveAccuracy(null);

    try {
      const pos = await getNativeOrBrowserLocation({
        onProgress: (acc) => setGpsLiveAccuracy(acc),
        maxWaitMs: 3500,
        targetAccuracy: 25
      });
      const res = await api.attendance.verifyLocation({
        roll_number: dashboard?.student?.roll_number || user?.username,
        latitude: pos.latitude,
        longitude: pos.longitude,
        accuracy: pos.accuracy || 10,
        is_mock_location: pos.isMockLocation || false
      });

      if (res.success) {
        setSessionToken(res.sessionToken);
        setVerifiedDistance(res.verifiedDistance);
        setCheckinStep('gps_ok');
        // Auto open camera
        setTimeout(() => startCamera(), 500);
      } else {
        setCheckinError(res.error || 'Location rejected by geofence policy.');
        setCheckinStep('failed');
      }
    } catch (err) {
      setCheckinError(err.message || 'Location verification rejected.');
      setCheckinStep('failed');
      fetchStudentData();
    }
  };

  // Check-In Step 2: Camera
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      streamRef.current = stream;
      setCameraActive(true);
      setCheckinStep('camera_active');
    } catch (err) {
      setCheckinError('Could not access front camera. Please grant camera permission.');
      setCheckinStep('failed');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
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
      if (tickRes?.success) setTickets(tickRes.feedback || []);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to submit ticket');
    } finally {
      setSubmittingTicket(false);
    }
  };

  const student = dashboard?.student || {};
  const stats = dashboard?.stats || {};
  const todayStatus = dashboard?.todayStatus || {};

  return (
    <div className="container-fluid px-0">
      {/* Student Banner */}
      <div className="card shadow-sm border-0 rounded-4 mb-4 text-white" style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)' }}>
        <div className="card-body p-4">
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-3">
            <div>
              <div className="d-flex align-items-center gap-2 mb-1">
                <h4 className="fw-bold mb-0">{student.full_name || user?.username}</h4>
                <span className="badge bg-primary px-2 py-1">Student Portal</span>
              </div>
              <div className="text-muted small">
                Roll No: <code className="text-light">{student.roll_number || user?.username}</code> &bull; Block {student.hostel_block || 'N/A'} &bull; Rm {student.room_number || 'N/A'} &bull; {student.course || 'B.Tech'}
              </div>
            </div>

            <div className="d-flex gap-3 text-center">
              <div className="bg-white bg-opacity-10 px-3 py-2 rounded-3">
                <div className="small text-muted">Attendance Rate</div>
                <div className="fw-bold fs-5 text-success">{stats.attendancePercentage || 100}%</div>
              </div>
              <div className="bg-white bg-opacity-10 px-3 py-2 rounded-3">
                <div className="small text-muted">Today's Roll Call</div>
                <div className={`fw-bold fs-6 ${todayStatus.status === 'PRESENT' ? 'text-success' : 'text-warning'}`}>
                  {todayStatus.status || 'PENDING'}
                </div>
              </div>
            </div>
          </div>
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

      {/* 1. Daily Attendance Tab */}
      {(activeTab === 'student_attendance' || !activeTab) && (
        <div className="row g-4 justify-content-center">
          <div className="col-lg-8">
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
                  <div className="py-4">
                    <CheckCircle2 size={64} className="text-success mb-3" />
                    <h5 className="fw-bold text-success mb-1">Attendance Already Recorded Today!</h5>
                    <p className="text-muted small mb-3">
                      Recorded at <strong>{todayStatus.record?.time_marked || 'Roll Call'}</strong> ({todayStatus.record?.status || 'PRESENT'})
                    </p>
                    <div className="badge bg-success-subtle text-success border border-success-subtle px-3 py-2">
                      Verified within {todayStatus.record?.distance_meters ? `${todayStatus.record.distance_meters.toFixed(1)}m` : 'Geofence'} &bull; Facial Vector Matched
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Check-In Progress State */}
                    {checkinStep === 'idle' && (
                      <div className="py-3">
                        <MapPin size={48} className="text-primary mb-3" />
                        <h5 className="fw-bold mb-1">Step 1: Verify Hostel Geofence Location</h5>
                        <p className="text-muted small mx-auto mb-4" style={{ maxWidth: '440px' }}>
                          In compliance with hostel policy, attendance requires verifying your device's physical presence within the campus boundary (15-20 meters).
                        </p>
                        <button
                          className="btn btn-primary px-4 py-2 fw-semibold d-inline-flex align-items-center gap-2"
                          onClick={handleVerifyLocation}
                        >
                          <Navigation size={18} /> Verify Current Location & Unlock Camera
                        </button>
                      </div>
                    )}

                    {checkinStep === 'verifying_gps' && (
                      <div className="py-4">
                        <div className="spinner-border text-primary mb-3" role="status"></div>
                        <h6 className="fw-semibold mb-1">
                          {gpsLiveAccuracy ? `Locking onto Satellite Signals (${gpsLiveAccuracy}m)...` : 'Querying GPS Hardware & Calculating Distance...'}
                        </h6>
                        <p className="text-muted small">
                          {gpsLiveAccuracy
                            ? 'Progressively refining GPS satellite fix for precision...'
                            : 'Server enforcing Haversine great-circle validation.'}
                        </p>
                      </div>
                    )}

                    {(checkinStep === 'camera_active' || checkinStep === 'verifying_face') && (
                      <div className="py-2">
                        <div className="position-relative d-inline-block rounded-4 overflow-hidden shadow-sm mb-3" style={{ maxWidth: '440px', width: '100%', backgroundColor: '#000' }}>
                          <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            style={{ width: '100%', height: 'auto', transform: 'scaleX(-1)' }}
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

                        <div>
                          <p className="text-muted small mb-3">
                            <Sparkles size={14} className="text-primary me-1 inline" />
                            Align your face inside the green oval guide with adequate lighting.
                          </p>
                          <button
                            className="btn btn-success px-4 py-2 fw-semibold d-inline-flex align-items-center gap-2"
                            onClick={handleVerifyFace}
                            disabled={checkinStep === 'verifying_face'}
                          >
                            {checkinStep === 'verifying_face' ? (
                              <>
                                <span className="spinner-border spinner-border-sm" role="status"></span>
                                Verifying Biometric Embeddings...
                              </>
                            ) : (
                              <>
                                <Camera size={18} /> Capture Live Face & Mark Attendance
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {checkinStep === 'success' && (
                      <div className="py-4">
                        <CheckCircle2 size={64} className="text-success mb-3" />
                        <h5 className="fw-bold text-success mb-1">Attendance Confirmed!</h5>
                        <p className="text-muted small mb-0">Your roll call check-in has been persisted to the authoritative database.</p>
                      </div>
                    )}

                    {checkinStep === 'failed' && (
                      <div className="py-4">
                        <AlertTriangle size={56} className="text-danger mb-3" />
                        <h5 className="fw-bold text-danger mb-2">Check-In Verification Failed</h5>
                        <div className="alert alert-danger py-2 px-3 small mx-auto mb-3" style={{ maxWidth: '460px' }}>
                          {checkinError || 'Verification was rejected.'}
                        </div>

                        {/* CASE A: Account is Locked by Security Policy */}
                        {checkinError?.toLowerCase().includes('locked') ? (
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
                                if (onSelectTab) onSelectTab('support_tickets');
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
                        ) : (
                          /* CASE B: Standard Location / Accuracy Issue */
                          <div className="d-flex flex-column align-items-center gap-2">
                            <button
                              className="btn btn-primary btn-sm px-4 fw-semibold d-inline-flex align-items-center gap-1 shadow-sm"
                              onClick={handleVerifyLocation}
                            >
                              <RefreshCw size={14} /> Re-Scan GPS & Try Again
                            </button>
                            <div className="text-muted small mt-1" style={{ fontSize: '11px', maxWidth: '380px' }}>
                              💡 <strong>Tip:</strong> Turning on your phone's Wi-Fi (even without connecting) helps your device lock onto campus location beacons instantly.
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
                            <span className="small text-dark"><Clock size={12} className="me-1 inline text-muted" />{h.time_marked}</span>
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
              <div className="p-3 bg-light rounded-3">
                <div className="text-muted">Biometric Status</div>
                <div className="fw-medium text-success">Active &bull; SFace 128-D Vector Embeddings Stored</div>
              </div>
            </div>
            <div className="col-md-6">
              <div className="p-3 bg-light rounded-3">
                <div className="text-muted">Forge Location Strikes</div>
                <div className={`fw-medium ${stats.failedStrikes > 0 ? 'text-danger' : 'text-success'}`}>
                  {stats.failedStrikes || 0} / 3 Strikes
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
