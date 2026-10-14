import React, { useState, useEffect, useRef } from 'react';
import { api } from '../utils/api';
import { Camera, CheckCircle, AlertCircle, RefreshCw, UserCheck, Sparkles, Smartphone, Mail, Phone, Shield, Info } from 'lucide-react';

export default function StudentOnboarding({ onComplete }) {
  const [unregisteredList, setUnregisteredList] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);

  const [formData, setFormData] = useState({
    course: 'B.Tech Computer Science',
    admission_year: new Date().getFullYear(),
    semester: 1,
    email: '',
    phone: '',
    device_model: navigator.userAgent.includes('Mobile') ? 'Mobile Device' : 'Laptop / PC Workstation'
  });

  const [currentStep, setCurrentStep] = useState('identity'); // identity -> academic -> camera -> success
  const [photos, setPhotos] = useState([]); // [{ angle: 'FRONT', imageBase64: '...' }, ...]
  const [activeAngleIndex, setActiveAngleIndex] = useState(0);
  const anglesToCapture = ['FRONT', 'LEFT_TILT', 'RIGHT_TILT'];

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [registeredStudentResult, setRegisteredStudentResult] = useState(null);

  // Auto-populate form when student is selected from allotment
  useEffect(() => {
    if (selectedStudent) {
      setFormData((prev) => ({
        ...prev,
        course: selectedStudent.course || prev.course,
        admission_year: selectedStudent.admission_year || prev.admission_year,
        semester: selectedStudent.semester || prev.semester,
        email: selectedStudent.email || prev.email || '',
        phone: selectedStudent.phone || prev.phone || ''
      }));
    }
  }, [selectedStudent]);

  // Load available allotment list
  useEffect(() => {
    loadAllotments();
    return () => stopCamera();
  }, []);

  const loadAllotments = async () => {
    try {
      const data = await api.getUnregisteredAllotments();
      setUnregisteredList(data);
    } catch (e) {
      console.error(e);
    }
  };

  const filteredList = unregisteredList.filter(
    (s) =>
      s.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.roll_number.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Camera Management
  const startCamera = async () => {
    try {
      setCameraError('');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
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

  const captureFrame = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const base64 = canvas.toDataURL('image/jpeg', 0.9);

    const angleName = anglesToCapture[activeAngleIndex];
    const newPhotos = [...photos.filter((p) => p.angle !== angleName), { angle: angleName, imageBase64: base64 }];
    setPhotos(newPhotos);

    if (activeAngleIndex < anglesToCapture.length - 1) {
      setActiveAngleIndex((prev) => prev + 1);
    }
  };

  const handleProceedToCamera = () => {
    setErrorMsg('');
    if (!formData.email || !/^\S+@\S+\.\S+$/.test(formData.email.trim())) {
      setErrorMsg('Please enter a valid student email address for real OTP password resets.');
      return;
    }
    if (!formData.phone || formData.phone.trim().length < 8) {
      setErrorMsg('Please enter a valid mobile phone number with country code (e.g. +91 9876543210) for Phone.email OTP authentication.');
      return;
    }
    setCurrentStep('camera');
    startCamera();
  };

  // Submit Onboarding
  const handleSubmitOnboarding = async () => {
    if (!selectedStudent) {
      setErrorMsg('Please select a student identity.');
      return;
    }
    if (photos.length === 0) {
      setErrorMsg('Please capture at least the FRONT angle photo.');
      return;
    }

    try {
      setLoading(true);
      setErrorMsg('');

      // Generate device fingerprint
      const deviceFingerprint = `DEV-${btoa(navigator.userAgent.slice(0, 32)).replace(/=/g, '').slice(0, 12)}`;

      const payload = {
        roll_number: selectedStudent.roll_number,
        course: formData.course,
        admission_year: formData.admission_year,
        semester: formData.semester,
        email: formData.email.trim(),
        phone: formData.phone.trim(),
        device_id: deviceFingerprint,
        device_model: formData.device_model,
        photos: photos
      };

      const result = await api.onboardStudent(payload);
      stopCamera();
      setRegisteredStudentResult(result.student);
      setCurrentStep('success');
      if (onComplete) onComplete();
    } catch (err) {
      setErrorMsg(err.message || 'Onboarding failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '850px', margin: '0 auto', padding: '0 20px 40px' }}>
      <div className="glass-panel" style={{ padding: '32px' }}>
        {/* Title */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{
            width: '52px',
            height: '52px',
            borderRadius: '16px',
            background: 'linear-gradient(135deg, #6366f1 0%, #10b981 100%)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '12px',
            boxShadow: '0 4px 20px rgba(99, 102, 241, 0.4)'
          }}>
            <UserCheck size={28} color="#ffffff" />
          </div>
          <h2 style={{ fontSize: '24px', fontWeight: '800', color: '#ffffff' }}>Student Onboarding & Face Registration</h2>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Phase 2: Bind pre-allotted student identity with 128D mathematical facial vector representations.
          </p>
        </div>

        {/* Step Indicator */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '32px' }}>
          {[
            { id: 'identity', label: '1. Identity Selection' },
            { id: 'academic', label: '2. Academic Details' },
            { id: 'camera', label: '3. Face Capture' }
          ].map((st, i) => (
            <div
              key={st.id}
              style={{
                padding: '6px 14px',
                borderRadius: '999px',
                fontSize: '12px',
                fontWeight: '700',
                background: currentStep === st.id ? 'var(--primary)' : 'rgba(255, 255, 255, 0.05)',
                color: currentStep === st.id ? '#ffffff' : 'var(--text-dim)',
                border: currentStep === st.id ? '1px solid #818cf8' : '1px solid transparent'
              }}
            >
              {st.label}
            </div>
          ))}
        </div>

        {errorMsg && (
          <div style={{
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
          }}>
            <AlertCircle size={18} /> {errorMsg}
          </div>
        )}

        {/* STEP 1: Identity Selection (Student CANNOT type name!) */}
        {currentStep === 'identity' && (
          <div>
            <div style={{
              background: 'rgba(99, 102, 241, 0.1)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              borderRadius: '12px',
              padding: '14px 18px',
              marginBottom: '20px',
              fontSize: '13px',
              color: '#c7d2fe'
            }}>
              💡 <strong>System Constraint Enforced:</strong> You cannot manually type your name. Select your pre-allotted profile from the hostel administration list below.
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label className="form-label">Search Pre-Allotted Students</label>
              <input
                className="form-input"
                type="text"
                placeholder="Type name or roll number to search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div style={{
              maxHeight: '260px',
              overflowY: 'auto',
              border: '1px solid var(--border-card)',
              borderRadius: '12px',
              background: 'rgba(10, 15, 28, 0.6)'
            }}>
              {filteredList.length > 0 ? (
                filteredList.map((st) => (
                  <div
                    key={st.id}
                    onClick={() => setSelectedStudent(st)}
                    style={{
                      padding: '12px 18px',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: selectedStudent?.id === st.id ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                      transition: 'background 0.15s ease'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: '700', color: selectedStudent?.id === st.id ? '#818cf8' : '#ffffff' }}>
                        {st.full_name}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        Roll No: {st.roll_number} | Room: {st.room_number} ({st.hostel_block})
                      </div>
                    </div>
                    {selectedStudent?.id === st.id ? (
                      <CheckCircle size={20} color="#10b981" />
                    ) : (
                      <span className="badge badge-indigo">Select</span>
                    )}
                  </div>
                ))
              ) : (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '13px' }}>
                  No unregistered students found. Please check Admin tab to upload or seed allotments.
                </div>
              )}
            </div>

            {selectedStudent && (
              <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={() => setCurrentStep('academic')} className="btn-primary">
                  Continue to Academic Details →
                </button>
              </div>
            )}
          </div>
        )}

        {/* STEP 2: Academic Details */}
        {currentStep === 'academic' && (
          <div>
            <div style={{
              padding: '16px',
              borderRadius: '12px',
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              <CheckCircle size={22} color="#10b981" />
              <div>
                <div style={{ fontWeight: '700', color: '#ffffff' }}>Selected Student: {selectedStudent.full_name}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  Roll Number: {selectedStudent.roll_number} | Room: {selectedStudent.room_number}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Course / Degree Program</label>
                <select
                  className="form-input"
                  value={formData.course}
                  onChange={(e) => setFormData({ ...formData, course: e.target.value })}
                >
                  <option value="B.Tech Computer Science">B.Tech Computer Science & Engineering</option>
                  <option value="B.Tech Information Technology">B.Tech Information Technology</option>
                  <option value="B.Tech Electronics & Comm">B.Tech Electronics & Communication</option>
                  <option value="B.Tech Mechanical Engineering">B.Tech Mechanical Engineering</option>
                  <option value="B.Tech Civil Engineering">B.Tech Civil Engineering</option>
                  <option value="M.Tech Computer Science">M.Tech Computer Science</option>
                  <option value="MCA">Master of Computer Applications (MCA)</option>
                </select>
              </div>

              <div>
                <label className="form-label">Admission Year</label>
                <input
                  className="form-input"
                  type="number"
                  min="2018"
                  max="2030"
                  value={formData.admission_year}
                  onChange={(e) => setFormData({ ...formData, admission_year: parseInt(e.target.value) || new Date().getFullYear() })}
                />
              </div>

              <div>
                <label className="form-label">Current Semester</label>
                <select
                  className="form-input"
                  value={formData.semester}
                  onChange={(e) => setFormData({ ...formData, semester: parseInt(e.target.value) || 1 })}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                    <option key={s} value={s}>
                      Semester {s}
                    </option>
                  ))}
                </select>
              </div>

              {/* Real OTP Contact Credentials */}
              <div style={{ gridColumn: '1 / -1', marginTop: '8px' }}>
                <div style={{
                  padding: '12px 16px',
                  borderRadius: '10px',
                  background: 'rgba(99, 102, 241, 0.08)',
                  border: '1px solid rgba(99, 102, 241, 0.25)',
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px'
                }}>
                  <Shield size={20} color="#818cf8" style={{ marginTop: '2px', flexShrink: 0 }} />
                  <div style={{ fontSize: '13px', color: '#c7d2fe', lineHeight: 1.5 }}>
                    <strong>Real OTP Security Verification:</strong> Enter your active email address and mobile number. Real OTP codes and password reset links will be securely dispatched to these coordinates via Phone.email and Email verification.
                  </div>
                </div>
              </div>

              <div>
                <label className="form-label">
                  <Mail size={14} style={{ display: 'inline', marginRight: '6px' }} />
                  Student Email Address <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  className="form-input"
                  type="email"
                  required
                  placeholder="e.g. yourname@student.college.edu"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Used for real Email OTPs & 1-click Magic Links</span>
              </div>

              <div>
                <label className="form-label">
                  <Phone size={14} style={{ display: 'inline', marginRight: '6px' }} />
                  Mobile Phone Number <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  className="form-input"
                  type="tel"
                  required
                  placeholder="e.g. +91 9876543210"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Used for Phone.email instant SMS/WhatsApp OTP</span>
              </div>
            </div>

            {errorMsg && (
              <div className="alert alert-danger d-flex align-items-center gap-2 mb-3">
                <AlertCircle size={18} />
                <span>{errorMsg}</span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '24px' }}>
              <button onClick={() => setCurrentStep('identity')} className="btn-secondary">
                ← Back
              </button>
              <button
                onClick={handleProceedToCamera}
                className="btn-primary"
              >
                Proceed to Facial Capture →
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Multi-Angle Face Capture */}
        {currentStep === 'camera' && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '16px' }}>
              <span className="badge badge-indigo">
                Angle {activeAngleIndex + 1} of {anglesToCapture.length}: {anglesToCapture[activeAngleIndex].replace('_', ' ')}
              </span>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '6px' }}>
                Look directly into the camera. Ensure your face is centered inside the guide oval.
              </p>
            </div>

            {/* Camera Viewport */}
            <div style={{
              position: 'relative',
              width: '100%',
              maxWidth: '480px',
              height: '340px',
              margin: '0 auto 20px',
              borderRadius: '16px',
              overflow: 'hidden',
              background: '#030712',
              border: '2px solid rgba(99, 102, 241, 0.4)',
              boxShadow: '0 10px 30px rgba(0, 0, 0, 0.6)'
            }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />

              {/* Face Guide Oval */}
              <div className="face-oval-guide" />
              <div className="scanline" />

              {!cameraActive && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(3, 7, 18, 0.9)',
                  padding: '20px',
                  textAlign: 'center'
                }}>
                  <Camera size={36} color="var(--text-dim)" style={{ marginBottom: '12px' }} />
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                    {cameraError || 'Camera is not active.'}
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

            {/* Capture & Submit Actions */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '14px', flexWrap: 'wrap' }}>
              <button onClick={captureFrame} className="btn-emerald" disabled={!cameraActive || loading}>
                <Camera size={18} /> Capture {anglesToCapture[activeAngleIndex].replace('_', ' ')}
              </button>

              {photos.length > 0 && (
                <button onClick={handleSubmitOnboarding} className="btn-primary" disabled={loading}>
                  {loading ? <RefreshCw className="animate-spin" size={18} /> : <Sparkles size={18} />}
                  {loading ? 'Generating Vectors...' : `Complete Onboarding (${photos.length} Captured)`}
                </button>
              )}
            </div>

            <div style={{ marginTop: '20px', textAlign: 'center' }}>
              <button
                onClick={() => {
                  stopCamera();
                  setCurrentStep('academic');
                }}
                className="btn-secondary"
                style={{ fontSize: '12px' }}
              >
                ← Back to Academic Details
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: Success Result Screen */}
        {currentStep === 'success' && registeredStudentResult && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{
              width: '68px',
              height: '68px',
              borderRadius: '50%',
              background: 'rgba(16, 185, 129, 0.15)',
              border: '2px solid #10b981',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '16px'
            }}>
              <CheckCircle size={38} color="#10b981" />
            </div>

            <h3 style={{ fontSize: '22px', fontWeight: '800', color: '#ffffff', marginBottom: '8px' }}>
              Registration & Facial Identity Created!
            </h3>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '24px' }}>
              Student profile has been bound to hardware device and 128D mathematical facial vector identity.
            </p>

            <div className="glass-panel" style={{ maxWidth: '440px', margin: '0 auto 24px', padding: '20px', textAlign: 'left' }}>
              <div style={{ marginBottom: '10px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)', textTransform: 'uppercase' }}>UNIQUE STUDENT ID</span>
                <div style={{ fontSize: '16px', fontWeight: '700', color: '#818cf8', fontFamily: 'var(--font-mono)' }}>
                  {registeredStudentResult.id}
                </div>
              </div>
              <div style={{ marginBottom: '10px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)', textTransform: 'uppercase' }}>STUDENT NAME</span>
                <div style={{ fontSize: '15px', fontWeight: '600', color: '#ffffff' }}>
                  {registeredStudentResult.fullName} ({registeredStudentResult.rollNumber})
                </div>
              </div>
              <div style={{ marginBottom: '10px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)', textTransform: 'uppercase' }}>ACADEMIC DETAILS</span>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  {registeredStudentResult.course} | Adm Year: {registeredStudentResult.admissionYear} | Sem: {registeredStudentResult.semester}
                </div>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)', textTransform: 'uppercase' }}>STORED FACE VECTORS</span>
                <div style={{ fontSize: '13px', color: '#34d399', fontWeight: '600' }}>
                  {registeredStudentResult.storedVectorCount} mathematical embeddings securely registered
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                setSelectedStudent(null);
                setPhotos([]);
                setCurrentStep('identity');
                loadAllotments();
              }}
              className="btn-primary"
            >
              Onboard Another Student
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
