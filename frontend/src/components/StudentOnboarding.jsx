import React, { useState, useEffect, useRef } from 'react';
import { api } from '../utils/api';
import {
  Camera,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  UserCheck,
  Sparkles,
  Smartphone,
  Mail,
  Phone,
  Shield,
  Key,
  Copy,
  Check,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  Lock,
  Search,
  Home,
  Zap,
  Volume2
} from 'lucide-react';
import { playBiometricChime, detectFaceAngle } from '../utils/faceAngleGuide';

export default function StudentOnboarding({ onComplete }) {
  // Step flow: lookup -> otp -> credentials -> camera -> success
  const [currentStep, setCurrentStep] = useState('lookup');

  // Step 1: Lookup state
  const [searchQuery, setSearchQuery] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [matchedStudent, setMatchedStudent] = useState(null);
  const [otpMethod, setOtpMethod] = useState('PHONE'); // 'PHONE' | 'EMAIL'
  const [manualPhoneInput, setManualPhoneInput] = useState('');
  const [manualEmailInput, setManualEmailInput] = useState('');

  // Step 2: OTP state
  const [otpCode, setOtpCode] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [maskedTarget, setMaskedTarget] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [debugOtp, setDebugOtp] = useState(null);

  // Step 3: Verified Credentials state
  const [onboardingToken, setOnboardingToken] = useState(null);
  const [revealedCredentials, setRevealedCredentials] = useState(null);
  const [verifiedStudent, setVerifiedStudent] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [copiedUser, setCopiedUser] = useState(false);
  const [copiedPass, setCopiedPass] = useState(false);

  // Step 4: Face Biometric Capture state
  const [photos, setPhotos] = useState([]); // [{ angle: 'FRONT', imageBase64: '...' }]
  const [activeAngleIndex, setActiveAngleIndex] = useState(0);
  const anglesToCapture = ['FRONT', 'LEFT_TILT', 'RIGHT_TILT'];
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);

  // Hands-Free Auto-Capture & Head Pose Tracking
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(true);
  const [poseStatus, setPoseStatus] = useState({ detected: false, angle: 'NONE', progress: 0, label: '' });
  const [flashActive, setFlashActive] = useState(false);
  const isAutoSnappingRef = useRef(false);
  const autoHoldProgressRef = useRef(0);

  // Global UI feedback
  const [errorMsg, setErrorMsg] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [registeredResult, setRegisteredResult] = useState(null);

  // Cleanup camera when leaving
  useEffect(() => {
    return () => stopCamera();
  }, []);

  // Resend OTP countdown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // -------------------------------------------------------------
  // STEP 1: Search & Lookup Identity (Privacy-First)
  // -------------------------------------------------------------
  const handleLookupSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusMsg('');
    if (!searchQuery.trim()) {
      setErrorMsg('Please enter your institutional Roll Number or registered Mobile Phone.');
      return;
    }

    try {
      setLookupLoading(true);
      const res = await api.studentOnboarding.lookup(searchQuery.trim());
      if (res.success && res.student) {
        setMatchedStudent(res.student);
        // Default OTP method based on available contacts
        if (res.student.has_phone) {
          setOtpMethod('PHONE');
        } else if (res.student.has_email) {
          setOtpMethod('EMAIL');
        }
      } else {
        setErrorMsg(res.error || 'No matching resident found on the hostel allotment roster.');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Identity lookup failed.');
      setMatchedStudent(null);
    } finally {
      setLookupLoading(false);
    }
  };

  // -------------------------------------------------------------
  // STEP 1b: Request OTP
  // -------------------------------------------------------------
  const handleSendOtp = async () => {
    if (!matchedStudent) return;
    setErrorMsg('');
    setStatusMsg('');

    let contactOverride = null;
    if (otpMethod === 'PHONE' && !matchedStudent.has_phone) {
      if (!manualPhoneInput || manualPhoneInput.trim().length < 8) {
        setErrorMsg('Please enter a valid mobile phone number for SMS OTP.');
        return;
      }
      contactOverride = manualPhoneInput.trim();
    } else if (otpMethod === 'EMAIL' && !matchedStudent.has_email) {
      if (!manualEmailInput || !manualEmailInput.includes('@')) {
        setErrorMsg('Please enter a valid email address for Email OTP.');
        return;
      }
      contactOverride = manualEmailInput.trim();
    }

    try {
      setOtpLoading(true);
      const res = await api.studentOnboarding.sendOtp({
        roll_number: matchedStudent.roll_number,
        method: otpMethod,
        contact_override: contactOverride
      });

      if (res.success) {
        setMaskedTarget(res.maskedDestination);
        setResendCooldown(60);
        if (res.debugOtp) setDebugOtp(res.debugOtp);
        setCurrentStep('otp');
        setStatusMsg(res.message || 'Verification OTP dispatched.');
      } else {
        setErrorMsg(res.error || 'Failed to dispatch verification code.');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to send OTP.');
    } finally {
      setOtpLoading(false);
    }
  };

  // -------------------------------------------------------------
  // STEP 2: Verify OTP & Reveal Credentials
  // -------------------------------------------------------------
  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusMsg('');

    if (!otpCode || otpCode.trim().length < 6) {
      setErrorMsg('Please enter the full 6-digit verification code.');
      return;
    }

    try {
      setOtpLoading(true);
      const res = await api.studentOnboarding.verifyOtp({
        roll_number: matchedStudent.roll_number,
        otp: otpCode.trim()
      });

      if (res.success) {
        setOnboardingToken(res.onboarding_token);
        setRevealedCredentials(res.credentials);
        setVerifiedStudent(res.student);
        setCurrentStep('credentials');
        setStatusMsg('Identity authenticated! Please record your official portal login credentials.');
      } else {
        setErrorMsg(res.error || 'Invalid or expired OTP code.');
      }
    } catch (err) {
      setErrorMsg(err.message || 'OTP verification failed.');
    } finally {
      setOtpLoading(false);
    }
  };

  // -------------------------------------------------------------
  // Copy to clipboard helpers
  // -------------------------------------------------------------
  const handleCopyUser = () => {
    if (!revealedCredentials?.username) return;
    navigator.clipboard.writeText(revealedCredentials.username);
    setCopiedUser(true);
    setTimeout(() => setCopiedUser(false), 2500);
  };

  const handleCopyPass = () => {
    if (!revealedCredentials?.initial_password) return;
    navigator.clipboard.writeText(revealedCredentials.initial_password);
    setCopiedPass(true);
    setTimeout(() => setCopiedPass(false), 2500);
  };

  // -------------------------------------------------------------
  // STEP 3 -> 4: Proceed to Mandatory Face Capture
  // -------------------------------------------------------------
  const handleProceedToCamera = () => {
    setErrorMsg('');
    setStatusMsg('');
    setCurrentStep('camera');
    startCamera();
  };

  // -------------------------------------------------------------
  // Camera Management & Frame Capture
  // -------------------------------------------------------------
  const startCamera = async () => {
    try {
      setCameraError('');
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } }
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(console.warn);
      }
      streamRef.current = stream;
      setCameraActive(true);
    } catch (err) {
      console.error('Camera access error:', err);
      setCameraError('Camera access denied or unavailable. Please grant webcam permissions.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const captureFrame = (targetIdx = activeAngleIndex) => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const base64 = canvas.toDataURL('image/jpeg', 0.9);

    // Shutter flash
    setFlashActive(true);
    setTimeout(() => setFlashActive(false), 180);

    const angleName = anglesToCapture[targetIdx];
    const newPhotos = [...photos.filter((p) => p.angle !== angleName), { angle: angleName, imageBase64: base64 }];
    setPhotos(newPhotos);

    // Play chime sound
    if (newPhotos.length >= 3) {
      playBiometricChime('completed');
    } else {
      playBiometricChime('captured');
    }

    // Auto advance angle for smooth 1-2-3 capture
    if (targetIdx < anglesToCapture.length - 1) {
      setActiveAngleIndex((prev) => prev + 1);
    }
  };

  // Real-time Hands-Free Head Pose Auto-Tracking Loop for Student Onboarding
  useEffect(() => {
    let animId;
    let lastCheck = 0;

    const runPoseTracking = async (time) => {
      if (currentStep !== 'camera' || !cameraActive || !autoCaptureEnabled || submitLoading) {
        return;
      }

      if (photos.length >= 3) {
        setPoseStatus({
          detected: true,
          angle: 'DONE',
          progress: 100,
          label: '✓ All 3 Angles Captured! Click Submit to Finish'
        });
        return;
      }

      if (time - lastCheck > 80) {
        lastCheck = time;
        if (videoRef.current && !isAutoSnappingRef.current) {
          const currentAngle = anglesToCapture[activeAngleIndex] || 'FRONT';
          const targetNorm = currentAngle.includes('LEFT') ? 'LEFT' : currentAngle.includes('RIGHT') ? 'RIGHT' : 'FRONT';
          const pose = await detectFaceAngle(videoRef.current, targetNorm);

          if (pose.detected && pose.angle === targetNorm) {
            autoHoldProgressRef.current = Math.min(100, autoHoldProgressRef.current + 25);
            setPoseStatus({
              detected: true,
              angle: pose.angle,
              progress: autoHoldProgressRef.current,
              label: `Hold steady... (${autoHoldProgressRef.current}%)`
            });

            if (autoHoldProgressRef.current >= 100) {
              isAutoSnappingRef.current = true;
              captureFrame(activeAngleIndex);
              autoHoldProgressRef.current = 0;

              setTimeout(() => {
                isAutoSnappingRef.current = false;
              }, 750);
            }
          } else {
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

    if (currentStep === 'camera' && cameraActive && autoCaptureEnabled) {
      autoHoldProgressRef.current = 0;
      isAutoSnappingRef.current = false;
      animId = requestAnimationFrame(runPoseTracking);
    }

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [currentStep, cameraActive, autoCaptureEnabled, activeAngleIndex, submitLoading, photos.length]);

  // -------------------------------------------------------------
  // Submit Biometric Face Vectors to AI Microservice
  // -------------------------------------------------------------
  const handleSubmitBiometrics = async () => {
    if (!verifiedStudent && !matchedStudent) {
      setErrorMsg('Student profile context missing.');
      return;
    }
    if (photos.length === 0) {
      setErrorMsg('Please capture at least the FRONT angle photo.');
      return;
    }

    try {
      setSubmitLoading(true);
      setErrorMsg('');

      const deviceFingerprint = `DEV-${btoa(navigator.userAgent.slice(0, 32)).replace(/=/g, '').slice(0, 12)}`;

      const payload = {
        onboarding_token: onboardingToken,
        roll_number: verifiedStudent?.roll_number || matchedStudent?.roll_number,
        course: verifiedStudent?.course || 'B.Tech Computer Science',
        admission_year: verifiedStudent?.admission_year || new Date().getFullYear(),
        semester: verifiedStudent?.semester || 1,
        email: verifiedStudent?.email || '',
        phone: verifiedStudent?.phone || '',
        device_id: deviceFingerprint,
        device_model: navigator.userAgent.includes('Mobile') ? 'Mobile Device' : 'Desktop / PC Workstation',
        photos: photos
      };

      const result = await api.studentOnboarding.submitFaceBiometrics(payload);
      stopCamera();
      setRegisteredResult(result.student);
      setCurrentStep('success');
    } catch (err) {
      setErrorMsg(err.message || 'Face enrollment processing failed. Please ensure good lighting and try again.');
    } finally {
      setSubmitLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '850px', margin: '0 auto', padding: '0 20px 40px' }}>
      <div className="glass-panel" style={{ padding: '32px' }}>
        {/* Header Badge */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #6366f1 0%, #10b981 100%)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '12px',
              boxShadow: '0 6px 20px rgba(99, 102, 241, 0.35)'
            }}
          >
            <Shield size={30} color="#ffffff" />
          </div>
          <h2 style={{ fontSize: '24px', fontWeight: '800', color: '#ffffff', letterSpacing: '-0.02em' }}>
            Student Identity Verification &amp; Account Setup
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px', maxWidth: '580px', margin: '4px auto 0' }}>
            Institutional Onboarding: Authenticate your pre-allotted student profile via OTP, secure your portal credentials, and complete your facial identity enrollment.
          </p>
        </div>

        {/* Step Indicator */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginBottom: '28px', flexWrap: 'wrap' }}>
          {[
            { id: 'lookup', label: '1. Identity Lookup' },
            { id: 'otp', label: '2. OTP Security' },
            { id: 'credentials', label: '3. Login Credentials' },
            { id: 'camera', label: '4. Face Biometrics' }
          ].map((st) => (
            <div
              key={st.id}
              style={{
                padding: '6px 14px',
                borderRadius: '999px',
                fontSize: '12px',
                fontWeight: '700',
                background: currentStep === st.id ? 'var(--primary)' : 'rgba(255, 255, 255, 0.05)',
                color: currentStep === st.id ? '#ffffff' : 'var(--text-dim)',
                border: currentStep === st.id ? '1px solid #818cf8' : '1px solid transparent',
                transition: 'all 0.2s ease'
              }}
            >
              {st.label}
            </div>
          ))}
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div
            style={{
              padding: '12px 18px',
              borderRadius: '10px',
              marginBottom: '20px',
              background: 'rgba(244, 63, 94, 0.2)',
              border: '1px solid #f43f5e',
              color: '#fb7185',
              fontWeight: '600',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}
          >
            <AlertCircle size={18} /> {errorMsg}
          </div>
        )}

        {/* Status / Success Toast */}
        {statusMsg && (
          <div
            style={{
              padding: '12px 18px',
              borderRadius: '10px',
              marginBottom: '20px',
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid #10b981',
              color: '#34d399',
              fontWeight: '600',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}
          >
            <CheckCircle size={18} /> {statusMsg}
          </div>
        )}

        {/* ========================================================= */}
        {/* STEP 1: IDENTITY LOOKUP (Zero Public Data Exposure)      */}
        {/* ========================================================= */}
        {currentStep === 'lookup' && (
          <div>
            <div
              style={{
                background: 'rgba(99, 102, 241, 0.08)',
                border: '1px solid rgba(99, 102, 241, 0.25)',
                borderRadius: '12px',
                padding: '14px 18px',
                marginBottom: '22px',
                fontSize: '13px',
                color: '#c7d2fe',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px'
              }}
            >
              <Shield size={20} className="text-indigo-400" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>Data Privacy Guarantee:</strong> Public student roster lists have been disabled to protect your personal details (room number, course, and phone number). Enter your institutional Roll Number or registered Mobile Number below to find your profile privately.
              </div>
            </div>

            <form onSubmit={handleLookupSubmit} style={{ marginBottom: '24px' }}>
              <label className="form-label" style={{ fontWeight: '700', fontSize: '13px' }}>
                Enter Your Roll Number or Registered Mobile Phone
              </label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <Search
                    size={18}
                    style={{
                      position: 'absolute',
                      left: '14px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-dim)'
                    }}
                  />
                  <input
                    className="form-input"
                    type="text"
                    required
                    style={{ paddingLeft: '42px', fontSize: '14px' }}
                    placeholder="e.g. 2024CS008 or +91 9876543210"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn-primary" disabled={lookupLoading} style={{ minWidth: '140px' }}>
                  {lookupLoading ? <RefreshCw className="animate-spin" size={16} /> : <UserCheck size={16} />}
                  {lookupLoading ? 'Searching...' : 'Find Profile'}
                </button>
              </div>
            </form>

            {/* Matched Profile Card */}
            {matchedStudent && (
              <div
                style={{
                  background: 'rgba(15, 23, 42, 0.7)',
                  border: '1px solid rgba(99, 102, 241, 0.35)',
                  borderRadius: '14px',
                  padding: '22px',
                  boxShadow: '0 8px 30px rgba(0, 0, 0, 0.3)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
                  <div
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '12px',
                      background: 'rgba(16, 185, 129, 0.2)',
                      border: '1px solid #10b981',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <CheckCircle size={22} color="#10b981" />
                  </div>
                  <div>
                    <div style={{ fontSize: '18px', fontWeight: '800', color: '#ffffff' }}>
                      {matchedStudent.full_name}
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      Roll Number: <strong>{matchedStudent.roll_number}</strong> | Program: {matchedStudent.course || 'B.Tech CS'}
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '12px', fontWeight: '700', textTransform: 'uppercase' }}>
                  Select OTP Verification Channel:
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                  {/* Phone OTP Option */}
                  <div
                    onClick={() => setOtpMethod('PHONE')}
                    style={{
                      padding: '14px',
                      borderRadius: '10px',
                      border: otpMethod === 'PHONE' ? '2px solid #6366f1' : '1px solid rgba(255, 255, 255, 0.1)',
                      background: otpMethod === 'PHONE' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <Smartphone size={16} color={otpMethod === 'PHONE' ? '#818cf8' : '#94a3b8'} />
                      <strong style={{ fontSize: '13px', color: '#ffffff' }}>SMS / Phone OTP</strong>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {matchedStudent.has_phone ? matchedStudent.masked_phone : 'Phone not on file'}
                    </div>
                  </div>

                  {/* Email OTP Option */}
                  <div
                    onClick={() => setOtpMethod('EMAIL')}
                    style={{
                      padding: '14px',
                      borderRadius: '10px',
                      border: otpMethod === 'EMAIL' ? '2px solid #6366f1' : '1px solid rgba(255, 255, 255, 0.1)',
                      background: otpMethod === 'EMAIL' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <Mail size={16} color={otpMethod === 'EMAIL' ? '#818cf8' : '#94a3b8'} />
                      <strong style={{ fontSize: '13px', color: '#ffffff' }}>Email OTP</strong>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {matchedStudent.has_email ? matchedStudent.masked_email : 'Email not on file'}
                    </div>
                  </div>
                </div>

                {/* Manual contact entry fallback if none on file */}
                {otpMethod === 'PHONE' && !matchedStudent.has_phone && (
                  <div style={{ marginBottom: '16px' }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>Enter Your Mobile Phone Number</label>
                    <input
                      className="form-input"
                      type="tel"
                      placeholder="e.g. +91 9876543210"
                      value={manualPhoneInput}
                      onChange={(e) => setManualPhoneInput(e.target.value)}
                    />
                  </div>
                )}

                {otpMethod === 'EMAIL' && !matchedStudent.has_email && (
                  <div style={{ marginBottom: '16px' }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>Enter Your College Email Address</label>
                    <input
                      className="form-input"
                      type="email"
                      placeholder="e.g. student@college.edu"
                      value={manualEmailInput}
                      onChange={(e) => setManualEmailInput(e.target.value)}
                    />
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
                  <button onClick={handleSendOtp} className="btn-primary" disabled={otpLoading}>
                    {otpLoading ? <RefreshCw className="animate-spin" size={16} /> : <ArrowRight size={16} />}
                    {otpLoading ? 'Dispatching OTP...' : 'Send 6-Digit Verification Code →'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* STEP 2: ENTER OTP VERIFICATION CODE                      */}
        {/* ========================================================= */}
        {currentStep === 'otp' && (
          <div style={{ maxWidth: '480px', margin: '0 auto', textAlign: 'center' }}>
            <div
              style={{
                width: '52px',
                height: '52px',
                borderRadius: '50%',
                background: 'rgba(99, 102, 241, 0.15)',
                border: '2px solid #818cf8',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '14px'
              }}
            >
              <Key size={26} color="#818cf8" />
            </div>

            <h3 style={{ fontSize: '20px', fontWeight: '800', color: '#ffffff', marginBottom: '6px' }}>
              Enter 6-Digit Security Code
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '22px' }}>
              A security verification code has been dispatched to{' '}
              <strong style={{ color: '#ffffff', fontFamily: 'var(--font-mono)' }}>{maskedTarget}</strong>.
            </p>

            {debugOtp && (
              <div
                style={{
                  background: 'rgba(234, 179, 8, 0.15)',
                  border: '1px dashed #eab308',
                  padding: '8px 14px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#facc15',
                  marginBottom: '18px'
                }}
              >
                🔐 <strong>Dev Mode OTP Code:</strong> <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '800' }}>{debugOtp}</span>
              </div>
            )}

            <form onSubmit={handleVerifyOtp}>
              <div style={{ marginBottom: '22px' }}>
                <input
                  type="text"
                  required
                  maxLength={6}
                  autoFocus
                  autoComplete="one-time-code"
                  placeholder="• • • • • •"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, ''))}
                  style={{
                    width: '100%',
                    maxWidth: '280px',
                    margin: '0 auto',
                    textAlign: 'center',
                    fontSize: '28px',
                    letterSpacing: '10px',
                    fontWeight: '800',
                    fontFamily: 'var(--font-mono)',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    border: '2px solid #6366f1',
                    background: 'rgba(10, 15, 28, 0.8)',
                    color: '#ffffff'
                  }}
                />
              </div>

              <button
                type="submit"
                className="btn-primary"
                disabled={otpLoading || otpCode.length < 6}
                style={{ width: '100%', padding: '12px', fontSize: '14px' }}
              >
                {otpLoading ? <RefreshCw className="animate-spin" size={16} /> : <CheckCircle size={16} />}
                {otpLoading ? 'Verifying Code...' : 'Verify & Reveal Credentials'}
              </button>
            </form>

            <div style={{ marginTop: '18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => {
                  setCurrentStep('lookup');
                  setOtpCode('');
                }}
                className="btn-secondary"
                style={{ fontSize: '12px' }}
              >
                ← Back
              </button>

              <button
                type="button"
                onClick={handleSendOtp}
                disabled={resendCooldown > 0 || otpLoading}
                style={{
                  background: 'none',
                  border: 'none',
                  color: resendCooldown > 0 ? 'var(--text-dim)' : '#818cf8',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: resendCooldown > 0 ? 'not-allowed' : 'pointer'
                }}
              >
                {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend Code'}
              </button>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* STEP 3: CREDENTIAL REVEAL POPUP / MODAL (User Requirement) */}
        {/* ========================================================= */}
        {currentStep === 'credentials' && revealedCredentials && (
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '16px',
                background: 'linear-gradient(135deg, #10b981 0%, #3b82f6 100%)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '14px',
                boxShadow: '0 6px 20px rgba(16, 185, 129, 0.35)'
              }}
            >
              <Key size={28} color="#ffffff" />
            </div>

            <h3 style={{ fontSize: '22px', fontWeight: '800', color: '#ffffff', marginBottom: '4px' }}>
              Identity Verified & Portal Credentials Issued!
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '24px' }}>
              Please take note of your official HostelGuard login credentials below. You will use these to sign in.
            </p>

            {/* Official Credentials Card */}
            <div
              style={{
                maxWidth: '520px',
                margin: '0 auto 24px',
                padding: '24px',
                borderRadius: '16px',
                background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.9) 0%, rgba(15, 23, 42, 0.95) 100%)',
                border: '1.5px solid rgba(129, 140, 248, 0.4)',
                boxShadow: '0 12px 35px rgba(0, 0, 0, 0.45)',
                textAlign: 'left'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '12px' }}>
                <div>
                  <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700' }}>RESIDENT PROFILE</span>
                  <div style={{ fontSize: '16px', fontWeight: '800', color: '#ffffff' }}>
                    {verifiedStudent?.full_name}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700' }}>ALLOTTED ROOM</span>
                  <div style={{ fontSize: '14px', fontWeight: '700', color: '#34d399', fontFamily: 'var(--font-mono)' }}>
                    {verifiedStudent?.hostel_block} · {verifiedStudent?.room_number}
                  </div>
                </div>
              </div>

              {/* Username Field */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '12px', fontWeight: '700', color: '#cbd5e1', marginBottom: '6px', display: 'block' }}>
                  Your Portal Username (Roll Number):
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    readOnly
                    value={revealedCredentials.username}
                    style={{
                      flex: 1,
                      padding: '10px 14px',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      background: 'rgba(0, 0, 0, 0.4)',
                      color: '#ffffff',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '15px',
                      fontWeight: '700'
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleCopyUser}
                    className="btn-secondary"
                    style={{ padding: '0 14px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
                  >
                    {copiedUser ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                    {copiedUser ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Password Field */}
              <div style={{ marginBottom: '18px' }}>
                <label style={{ fontSize: '12px', fontWeight: '700', color: '#cbd5e1', marginBottom: '6px', display: 'block' }}>
                  Your Initial Password:
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      readOnly
                      value={revealedCredentials.initial_password}
                      style={{
                        width: '100%',
                        padding: '10px 42px 10px 14px',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        background: 'rgba(0, 0, 0, 0.4)',
                        color: '#facc15',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '15px',
                        fontWeight: '700'
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{
                        position: 'absolute',
                        right: '10px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-dim)',
                        cursor: 'pointer',
                        padding: '4px'
                      }}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyPass}
                    className="btn-secondary"
                    style={{ padding: '0 14px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
                  >
                    {copiedPass ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                    {copiedPass ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(59, 130, 246, 0.12)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                  borderRadius: '10px',
                  padding: '12px',
                  fontSize: '12px',
                  color: '#bfdbfe'
                }}
              >
                💡 <strong>Important:</strong> You can change your password anytime using the <em>Forgot Password</em> feature or in <em>Account Settings</em>.
              </div>
            </div>

            {/* Mandatory Biometric Face Notice */}
            <div
              style={{
                maxWidth: '520px',
                margin: '0 auto 24px',
                padding: '14px 18px',
                borderRadius: '12px',
                background: 'rgba(234, 179, 8, 0.12)',
                border: '1px solid rgba(234, 179, 8, 0.3)',
                color: '#fef08a',
                fontSize: '13px',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}
            >
              <Camera size={24} color="#facc15" style={{ flexShrink: 0 }} />
              <div>
                <strong>Identity Verification Required:</strong> Roll call attendance requires facial identity verification. Please complete 3 quick camera angles (~15 seconds).
              </div>
            </div>

            <button onClick={handleProceedToCamera} className="btn-primary" style={{ padding: '12px 28px', fontSize: '15px' }}>
              Proceed to Face Enrollment →
            </button>
          </div>
        )}

        {/* ========================================================= */}
        {/* STEP 4: MANDATORY FACE BIOMETRIC REGISTRATION            */}
        {/* ========================================================= */}
        {currentStep === 'camera' && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '20px', fontWeight: '800', color: '#ffffff' }}>
                Capture Facial Angles for Verification
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                {anglesToCapture[activeAngleIndex] === 'FRONT'
                  ? 'Look straight at the camera with a neutral expression.'
                  : anglesToCapture[activeAngleIndex].includes('LEFT')
                  ? 'Turn your head slightly to your left (~15°).'
                  : 'Turn your head slightly to your right (~15°).'}
              </p>
              {autoCaptureEnabled && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 12px',
                    borderRadius: '999px',
                    background: 'rgba(16, 185, 129, 0.15)',
                    border: '1px solid rgba(16, 185, 129, 0.35)',
                    color: '#34d399',
                    fontSize: '12px',
                    fontWeight: '600'
                  }}
                >
                  <Zap size={13} />
                  <span>Hands-Free Auto-Capture ON: Just hold the requested angle steady!</span>
                </div>
              )}
            </div>

            {/* Camera Viewport */}
            <div
              style={{
                width: '100%',
                maxWidth: '540px',
                margin: '0 auto 20px',
                height: '380px',
                background: '#000000',
                borderRadius: '16px',
                overflow: 'hidden',
                position: 'relative',
                boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)'
              }}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: 'scaleX(-1)'
                }}
              />

              {/* Dynamic Face Guide Oval with Pose Glow */}
              <div
                style={{
                  position: 'absolute',
                  top: '14%',
                  left: '25%',
                  width: '50%',
                  height: '72%',
                  border:
                    poseStatus.progress > 0
                      ? '3px solid #10b981'
                      : poseStatus.detected
                      ? '2px solid #10b981'
                      : '2px dashed rgba(16, 185, 129, 0.65)',
                  borderRadius: '50%',
                  pointerEvents: 'none',
                  boxShadow:
                    poseStatus.progress > 0
                      ? '0 0 24px rgba(16, 185, 129, 0.85), 0 0 0 9999px rgba(0, 0, 0, 0.45)'
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
                style={{
                  position: 'absolute',
                  bottom: '16px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: poseStatus.progress > 0 ? 'rgba(16, 185, 129, 0.95)' : 'rgba(15, 23, 42, 0.85)',
                  backdropFilter: 'blur(8px)',
                  padding: '6px 16px',
                  borderRadius: '999px',
                  color: '#ffffff',
                  fontSize: '12px',
                  fontWeight: '700',
                  border: poseStatus.progress > 0 ? '1px solid #10b981' : '1px solid rgba(255, 255, 255, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  whiteSpace: 'nowrap',
                  zIndex: 15,
                  boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
                }}
              >
                {autoCaptureEnabled && (
                  <Zap size={13} color={poseStatus.progress > 0 ? '#facc15' : '#10b981'} />
                )}
                <span>
                  {poseStatus.label || (autoCaptureEnabled ? 'Align your face in oval' : 'Ready to capture')}
                </span>
                {autoCaptureEnabled && poseStatus.progress > 0 && (
                  <span
                    style={{
                      background: '#ffffff',
                      color: '#065f46',
                      borderRadius: '6px',
                      padding: '1px 6px',
                      fontSize: '11px',
                      fontWeight: '800'
                    }}
                  >
                    {poseStatus.progress}%
                  </span>
                )}
              </div>

              {/* Stability Hold Progress Bar */}
              {autoCaptureEnabled && poseStatus.progress > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    width: '100%',
                    height: '5px',
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    zIndex: 16
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${poseStatus.progress}%`,
                      backgroundColor: '#10b981',
                      boxShadow: '0 0 10px #10b981',
                      transition: 'width 0.08s linear'
                    }}
                  />
                </div>
              )}

              {!cameraActive && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(3, 7, 18, 0.95)',
                    padding: '20px',
                    textAlign: 'center'
                  }}
                >
                  <Camera size={36} color="var(--text-dim)" style={{ marginBottom: '12px' }} />
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                    {cameraError || 'Camera stream is stopped.'}
                  </p>
                  <button onClick={startCamera} className="btn-emerald">
                    Activate Camera
                  </button>
                </div>
              )}
            </div>

            {/* Angle Indicator & Previews */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginBottom: '24px' }}>
              {anglesToCapture.map((ang, idx) => {
                const captured = photos.find((p) => p.angle === ang);
                return (
                  <div key={ang} style={{ textAlign: 'center' }}>
                    <div
                      onClick={() => setActiveAngleIndex(idx)}
                      style={{
                        width: '74px',
                        height: '74px',
                        borderRadius: '12px',
                        border: activeAngleIndex === idx ? '2px solid #6366f1' : '1px solid var(--border-card)',
                        overflow: 'hidden',
                        background: 'rgba(255, 255, 255, 0.05)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer'
                      }}
                    >
                      {captured ? (
                        <img src={captured.imageBase64} alt={ang} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <Camera size={22} color="var(--text-dim)" />
                      )}
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px', display: 'block' }}>
                      {ang.replace('_', ' ')}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setAutoCaptureEnabled(!autoCaptureEnabled)}
                className={autoCaptureEnabled ? 'btn-emerald' : 'btn-secondary'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                title={autoCaptureEnabled ? 'Hands-Free Auto Snap is ON' : 'Turn Auto-Snap ON'}
              >
                <Zap size={16} /> {autoCaptureEnabled ? 'Auto-Snap: ON' : 'Auto-Snap: OFF'}
              </button>

              <button onClick={() => captureFrame(activeAngleIndex)} className="btn-emerald" disabled={!cameraActive || submitLoading}>
                <Camera size={18} /> Capture {anglesToCapture[activeAngleIndex].replace('_', ' ')}
              </button>

              <button
                type="button"
                onClick={() => playBiometricChime('captured')}
                className="btn-secondary"
                style={{ padding: '10px 14px' }}
                title="Test Audio Chime"
              >
                <Volume2 size={16} />
              </button>

              {photos.length > 0 && (
                <button onClick={handleSubmitBiometrics} className="btn-primary" disabled={submitLoading}>
                  {submitLoading ? <RefreshCw className="animate-spin" size={18} /> : <Sparkles size={18} />}
                  {submitLoading ? 'Processing Face Verification...' : `Submit Facial Profile (${photos.length} Captured)`}
                </button>
              )}
            </div>

            <div style={{ marginTop: '20px', textAlign: 'center' }}>
              <button
                onClick={() => {
                  stopCamera();
                  setCurrentStep('credentials');
                }}
                className="btn-secondary"
                style={{ fontSize: '12px' }}
              >
                ← Back to Credentials
              </button>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* STEP 5: REGISTRATION SUCCESSFUL                          */}
        {/* ========================================================= */}
        {currentStep === 'success' && registeredResult && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div
              style={{
                width: '68px',
                height: '68px',
                borderRadius: '50%',
                background: 'rgba(16, 185, 129, 0.15)',
                border: '2px solid #10b981',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px'
              }}
            >
              <CheckCircle size={40} color="#10b981" />
            </div>

            <h3 style={{ fontSize: '24px', fontWeight: '800', color: '#ffffff', marginBottom: '8px' }}>
              Registration & Biometrics Activated!
            </h3>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '24px' }}>
              Welcome, <strong>{registeredResult.fullName}</strong>. Your account is fully active and enrolled in the attendance system.
            </p>

            <div className="glass-panel" style={{ maxWidth: '460px', margin: '0 auto 24px', padding: '20px', textAlign: 'left' }}>
              <div style={{ marginBottom: '10px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)', textTransform: 'uppercase' }}>STUDENT ROLL NUMBER</span>
                <div style={{ fontSize: '16px', fontWeight: '800', color: '#818cf8', fontFamily: 'var(--font-mono)' }}>
                  {registeredResult.rollNumber}
                </div>
              </div>
              <div style={{ marginBottom: '10px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)', textTransform: 'uppercase' }}>ASSIGNED ROOM</span>
                <div style={{ fontSize: '14px', color: '#ffffff', fontWeight: '600' }}>
                  {registeredResult.hostelBlock} · Room {registeredResult.roomNumber}
                </div>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)', textTransform: 'uppercase' }}>VERIFICATION STATUS</span>
                <div style={{ fontSize: '13px', color: '#34d399', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CheckCircle size={15} /> Identity Verification Active
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
              <button
                onClick={() => {
                  if (onComplete) onComplete();
                }}
                className="btn-primary"
                style={{ padding: '12px 28px', fontSize: '14px' }}
              >
                Sign In to Student Portal →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
