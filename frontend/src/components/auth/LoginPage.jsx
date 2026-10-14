import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Shield, Lock, User, ArrowRight, UserCheck, AlertTriangle, Key, Server, Check, CheckCircle2, Smartphone, Mail, Send } from 'lucide-react';
import { getApiBaseUrl, authStorage, api } from '../../utils/api';
import ForgotPasswordModal from './ForgotPasswordModal';
import SignInWithPhoneButton from './SignInWithPhoneButton';

export default function LoginPage({ onNavigateOnboarding }) {
  const { login, loginWithPhone, loginWithOtp } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successBanner, setSuccessBanner] = useState('');
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [magicLinkToken, setMagicLinkToken] = useState(null);
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [customServerUrl, setCustomServerUrl] = useState(authStorage.getBackendUrl());
  const [serverSavedMsg, setServerSavedMsg] = useState(false);
  const [otpVerifyMode, setOtpVerifyMode] = useState('phone'); // 'phone' | 'email'

  // Direct OTP State (Takes ONLY 6-digit OTP from user, no first/last name)
  const [directOtpIdentifier, setDirectOtpIdentifier] = useState('');
  const [directOtpCode, setDirectOtpCode] = useState('');
  const [directOtpSent, setDirectOtpSent] = useState(false);
  const [directOtpLoading, setDirectOtpLoading] = useState(false);
  const [directOtpDestination, setDirectOtpDestination] = useState('');
  const [directOtpCountdown, setDirectOtpCountdown] = useState(0);
  const [showPhoneEmailWidget, setShowPhoneEmailWidget] = useState(false);

  // Check URL query parameters (e.g. ?mode=reset or ?token=... or ?roll=2023CS01)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token');
      if (token) {
        setMagicLinkToken(token);
        setShowForgotModal(true);
      } else if (params.get('mode') === 'reset' || params.get('reset') === 'true' || window.location.hash === '#reset') {
        setShowForgotModal(true);
      }
      if (params.get('roll')) {
        setUsername(params.get('roll'));
      }
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setErrorMsg('Please enter both username and password.');
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      await login(username.trim(), password);
    } catch (err) {
      setErrorMsg(err.message || 'Invalid credentials or inactive account.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let timer;
    if (directOtpCountdown > 0) {
      timer = setTimeout(() => setDirectOtpCountdown(directOtpCountdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [directOtpCountdown]);

  const handlePhoneLoginSuccess = async (userJsonUrl) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await loginWithPhone(userJsonUrl);
      setSuccessBanner(res.message || 'Identity verified successfully! Welcome back.');
    } catch (err) {
      setErrorMsg(err.message || 'Verification sign-in failed. Please ensure your mobile/email is registered.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendDirectOtp = async (e) => {
    e?.preventDefault();
    if (!directOtpIdentifier.trim()) {
      setErrorMsg('Please enter your mobile number, roll number, or registered email.');
      return;
    }
    setDirectOtpLoading(true);
    setErrorMsg('');
    try {
      const res = await api.auth.requestLoginOtp({
        identifier: directOtpIdentifier.trim(),
        method: otpVerifyMode === 'email' ? 'EMAIL' : 'SMS'
      });
      if (res.success) {
        setDirectOtpSent(true);
        setDirectOtpDestination(res.maskedDestination || directOtpIdentifier.trim());
        setDirectOtpCountdown(60);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to dispatch OTP code. Please check your number.');
    } finally {
      setDirectOtpLoading(false);
    }
  };

  const handleVerifyDirectOtp = async (e) => {
    e?.preventDefault();
    if (!directOtpCode.trim() || directOtpCode.trim().length !== 6) {
      setErrorMsg('Please enter the full 6-digit OTP verification code.');
      return;
    }
    setDirectOtpLoading(true);
    setErrorMsg('');
    try {
      const res = await loginWithOtp(directOtpIdentifier.trim(), directOtpCode.trim());
      setSuccessBanner(res.message || 'Signed in successfully via 6-digit OTP!');
    } catch (err) {
      setErrorMsg(err.message || 'Incorrect or expired OTP verification code.');
    } finally {
      setDirectOtpLoading(false);
    }
  };

  const handleSaveServer = (e) => {
    e.preventDefault();
    authStorage.setBackendUrl(customServerUrl);
    setServerSavedMsg(true);
    setTimeout(() => {
      setServerSavedMsg(false);
      setShowServerConfig(false);
    }, 1200);
  };

  return (
    <div className="container d-flex align-items-center justify-content-center" style={{ minHeight: '85vh' }}>
      <div className="card shadow-lg border-0 rounded-4" style={{ maxWidth: '440px', width: '100%', overflow: 'hidden' }}>
        {/* Card Header */}
        <div className="p-4 text-center text-white" style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)' }}>
          <div className="d-inline-flex p-3 rounded-circle bg-primary bg-opacity-25 mb-3">
            <Shield size={36} className="text-primary" />
          </div>
          <h4 className="fw-bold mb-1">HostelGuard Portal</h4>
          <p className="text-muted small mb-0">
            Open-Source Biometric & Geofenced Attendance Management
          </p>
        </div>

        {/* Card Body */}
        <div className="card-body p-4 p-sm-5">
          {successBanner && (
            <div className="alert alert-success d-flex align-items-center gap-2 py-2 px-3 small mb-4" role="alert">
              <CheckCircle2 size={16} className="text-success flex-shrink-0" />
              <div>{successBanner}</div>
            </div>
          )}

          {errorMsg && (
            <div className="alert alert-danger d-flex align-items-center gap-2 py-2 px-3 small mb-4" role="alert">
              <AlertTriangle size={16} className="flex-shrink-0" />
              <div>{errorMsg}</div>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label small fw-medium text-dark">Username, Roll Number, or Email</label>
              <div className="input-group">
                <span className="input-group-text bg-light border-end-0">
                  <User size={16} className="text-muted" />
                </span>
                <input
                  type="text"
                  className="form-control border-start-0 ps-0"
                  placeholder="e.g. 2024CS001, admin, or student@hostel.local"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>
            </div>

            <div className="mb-4">
              <div className="d-flex align-items-center justify-content-between mb-1">
                <label className="form-label small fw-medium text-dark mb-0">Account Password</label>
                <button
                  type="button"
                  className="btn btn-link btn-sm text-decoration-none p-0 text-primary small fw-semibold d-inline-flex align-items-center gap-1"
                  style={{ fontSize: '12px' }}
                  onClick={() => setShowForgotModal(true)}
                >
                  <Key size={12} /> Forgot Password?
                </button>
              </div>
              <div className="input-group">
                <span className="input-group-text bg-light border-end-0">
                  <Lock size={16} className="text-muted" />
                </span>
                <input
                  type="password"
                  className="form-control border-start-0 ps-0"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary w-100 py-2 d-flex align-items-center justify-content-center gap-2 fw-semibold mb-3"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner-border spinner-border-sm" role="status"></span>
                  Verifying Credentials...
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          {/* Direct 6-Digit OTP Sign In (Takes ONLY the OTP code, no first/last name required) */}
          <div className="position-relative my-3 text-center">
            <hr className="text-secondary opacity-25" />
            <span className="position-absolute top-50 start-50 translate-middle bg-white px-2 small text-muted fw-semibold" style={{ fontSize: '11px' }}>
              OR SIGN IN WITH 6-DIGIT OTP
            </span>
          </div>

          <div className="card bg-light border-0 p-3 rounded-3 mb-3">
            {!directOtpSent ? (
              <form onSubmit={handleSendDirectOtp}>
                <div className="mb-2">
                  <div className="d-flex justify-content-between align-items-center mb-1">
                    <label className="form-label small fw-medium text-dark mb-0">Mobile or Roll Number</label>
                    <div className="btn-group btn-group-sm" role="group">
                      <button
                        type="button"
                        className={`btn btn-xs py-0 px-2 rounded-start-pill ${otpVerifyMode === 'phone' ? 'btn-primary text-white fw-bold' : 'btn-light border'}`}
                        style={{ fontSize: '10px' }}
                        onClick={() => setOtpVerifyMode('phone')}
                      >
                        SMS OTP
                      </button>
                      <button
                        type="button"
                        className={`btn btn-xs py-0 px-2 rounded-end-pill ${otpVerifyMode === 'email' ? 'btn-primary text-white fw-bold' : 'btn-light border'}`}
                        style={{ fontSize: '10px' }}
                        onClick={() => setOtpVerifyMode('email')}
                      >
                        Email OTP
                      </button>
                    </div>
                  </div>
                  <div className="input-group input-group-sm">
                    <span className="input-group-text bg-white">
                      {otpVerifyMode === 'email' ? <Mail size={14} className="text-muted" /> : <Smartphone size={14} className="text-muted" />}
                    </span>
                    <input
                      type="text"
                      className="form-control"
                      placeholder={otpVerifyMode === 'email' ? 'e.g. student@hostel.local' : 'e.g. +919127155033 or 2024CS001'}
                      value={directOtpIdentifier}
                      onChange={(e) => setDirectOtpIdentifier(e.target.value)}
                      disabled={directOtpLoading}
                      required
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="btn btn-outline-primary btn-sm w-100 fw-semibold d-flex align-items-center justify-content-center gap-1"
                  disabled={directOtpLoading}
                >
                  {directOtpLoading ? (
                    <>
                      <span className="spinner-border spinner-border-sm" role="status"></span>
                      Sending Code...
                    </>
                  ) : (
                    <>
                      <Send size={13} />
                      <span>Send 6-Digit Code</span>
                    </>
                  )}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyDirectOtp}>
                <div className="text-center mb-2">
                  <span className="badge bg-success bg-opacity-10 text-success small mb-1">
                    Code Sent to {directOtpDestination}
                  </span>
                  <div className="text-muted small" style={{ fontSize: '11px' }}>
                    Enter the 6-digit OTP code:
                  </div>
                </div>

                <div className="mb-3">
                  <input
                    type="text"
                    maxLength={6}
                    autoFocus
                    className="form-control form-control-lg text-center font-monospace fw-bold border-primary shadow-xs"
                    placeholder="• • • • • •"
                    style={{ letterSpacing: '0.4em', fontSize: '1.3rem' }}
                    value={directOtpCode}
                    onChange={(e) => setDirectOtpCode(e.target.value.replace(/[^0-9]/g, ''))}
                    disabled={directOtpLoading}
                    required
                  />
                </div>

                <div className="d-flex gap-2">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm flex-grow-1"
                    onClick={() => {
                      setDirectOtpSent(false);
                      setDirectOtpCode('');
                    }}
                    disabled={directOtpLoading}
                  >
                    Change
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary btn-sm flex-grow-1 fw-semibold d-flex align-items-center justify-content-center gap-1"
                    disabled={directOtpLoading || directOtpCode.length !== 6}
                  >
                    {directOtpLoading ? (
                      <span className="spinner-border spinner-border-sm" role="status"></span>
                    ) : (
                      <>
                        <CheckCircle2 size={14} />
                        Verify & Sign In
                      </>
                    )}
                  </button>
                </div>

                <div className="text-center mt-2">
                  <button
                    type="button"
                    className="btn btn-link btn-sm text-decoration-none text-muted p-0"
                    style={{ fontSize: '11px' }}
                    onClick={handleSendDirectOtp}
                    disabled={directOtpLoading || directOtpCountdown > 0}
                  >
                    {directOtpCountdown > 0 ? `Resend code in ${directOtpCountdown}s` : 'Resend code'}
                  </button>
                </div>
              </form>
            )}

            {/* Optional Phone.Email third-party popup widget */}
            <div className="text-center mt-2 pt-2 border-top">
              <button
                type="button"
                className="btn btn-link btn-sm text-decoration-none text-muted p-0"
                style={{ fontSize: '11px' }}
                onClick={() => setShowPhoneEmailWidget(!showPhoneEmailWidget)}
              >
                {showPhoneEmailWidget ? 'Hide Phone.Email Widget ▲' : 'Or use Phone.Email Widget ▼'}
              </button>

              {showPhoneEmailWidget && (
                <div className="d-flex flex-column align-items-center justify-content-center mt-2 pt-1">
                  <SignInWithPhoneButton
                    key={otpVerifyMode}
                    mode={otpVerifyMode}
                    onSuccess={handlePhoneLoginSuccess}
                    onError={(err) => setErrorMsg(err)}
                  />
                  <div className="text-muted mt-1" style={{ fontSize: '10px' }}>
                    Opens Phone.Email verification window
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Student Onboarding Action */}
          <div className="text-center mt-4 pt-3 border-top">
            <p className="text-muted small mb-2">New resident student not enrolled yet?</p>
            <button
              type="button"
              className="btn btn-outline-primary btn-sm px-3 d-inline-flex align-items-center gap-1 shadow-sm"
              onClick={onNavigateOnboarding}
            >
              <UserCheck size={14} /> Student Registration & Biometrics
            </button>
          </div>

          {/* Server Connection Config (Especially helpful for Native Mobile & Emulator) */}
          <div className="text-center mt-3 pt-2">
            <button
              type="button"
              className="btn btn-link btn-sm text-decoration-none text-muted p-0 d-inline-flex align-items-center gap-1"
              style={{ fontSize: '11px' }}
              onClick={() => setShowServerConfig(!showServerConfig)}
            >
              <Server size={11} /> Server: <span className="text-truncate font-monospace" style={{ maxWidth: '210px' }}>{getApiBaseUrl()}</span>
            </button>

            {showServerConfig && (
              <div className="card mt-2 p-3 text-start bg-light border-0 shadow-sm rounded-3">
                <div className="d-flex align-items-center justify-content-between mb-2">
                  <span className="small fw-bold text-dark">Backend API Endpoint</span>
                  {serverSavedMsg && <span className="badge bg-success small"><Check size={10} /> Saved</span>}
                </div>
                <div className="input-group input-group-sm mb-2">
                  <input
                    type="text"
                    className="form-control"
                    placeholder="http://10.0.2.2:5000/api/v1"
                    value={customServerUrl}
                    onChange={(e) => setCustomServerUrl(e.target.value)}
                  />
                  <button className="btn btn-primary" type="button" onClick={handleSaveServer}>
                    Save
                  </button>
                </div>
                <div className="small text-muted" style={{ fontSize: '11px', lineHeight: 1.3 }}>
                  • <strong>Android Emulator:</strong> <code>http://10.0.2.2:5000/api/v1</code><br />
                  • <strong>Physical Phone:</strong> <code>http://&lt;your-pc-ip&gt;:5000/api/v1</code><br />
                  • <strong>Web Browser:</strong> <code>/api/v1</code>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Forgot / Reset Password Modal */}
      <ForgotPasswordModal
        isOpen={showForgotModal}
        initialRollNumber={username}
        initialToken={magicLinkToken}
        onClose={() => {
          setShowForgotModal(false);
          setMagicLinkToken(null);
        }}
        onPasswordResetSuccess={(resetRoll) => {
          setShowForgotModal(false);
          setMagicLinkToken(null);
          setUsername(resetRoll);
          setPassword('');
          setSuccessBanner(`Password successfully reset for ${resetRoll}! Please sign in with your new password.`);
          setErrorMsg('');
        }}
      />
    </div>
  );
}
