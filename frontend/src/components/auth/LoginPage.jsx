import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Shield, Lock, User, ArrowRight, UserCheck, AlertTriangle, Key, Server, Check, CheckCircle2, Smartphone, Mail } from 'lucide-react';
import { getApiBaseUrl, authStorage } from '../../utils/api';
import ForgotPasswordModal from './ForgotPasswordModal';
import SignInWithPhoneButton from './SignInWithPhoneButton';

export default function LoginPage({ onNavigateOnboarding }) {
  const { login, loginWithPhone } = useAuth();
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

          {/* Sign in with Phone or Email (Phone.Email Free Global OTP) */}
          <div className="position-relative my-3 text-center">
            <hr className="text-secondary opacity-25" />
            <span className="position-absolute top-50 start-50 translate-middle bg-white px-2 small text-muted fw-semibold" style={{ fontSize: '11px' }}>
              OR SIGN IN WITH INSTANT OTP
            </span>
          </div>

          <div className="d-flex flex-column align-items-center justify-content-center mb-3">
            {/* Mode Selector Pill */}
            <div className="btn-group btn-group-sm mb-3 p-1 bg-light rounded-pill border" role="group">
              <button
                type="button"
                className={`btn btn-sm rounded-pill px-3 py-1 fw-semibold d-inline-flex align-items-center gap-1 transition-all ${
                  otpVerifyMode === 'phone'
                    ? 'btn-primary text-white shadow-sm'
                    : 'btn-light text-muted border-0'
                }`}
                style={{ fontSize: '11px' }}
                onClick={() => setOtpVerifyMode('phone')}
              >
                <Smartphone size={12} /> Mobile OTP
              </button>
              <button
                type="button"
                className={`btn btn-sm rounded-pill px-3 py-1 fw-semibold d-inline-flex align-items-center gap-1 transition-all ${
                  otpVerifyMode === 'email'
                    ? 'btn-primary text-white shadow-sm'
                    : 'btn-light text-muted border-0'
                }`}
                style={{ fontSize: '11px' }}
                onClick={() => setOtpVerifyMode('email')}
              >
                <Mail size={12} /> Email OTP
              </button>
            </div>

            <SignInWithPhoneButton
              key={otpVerifyMode}
              mode={otpVerifyMode}
              onSuccess={handlePhoneLoginSuccess}
              onError={(err) => setErrorMsg(err)}
            />
            <div className="text-center text-muted mt-2" style={{ fontSize: '11px' }}>
              {otpVerifyMode === 'phone'
                ? 'Sign in instantly with your verified mobile number OTP.'
                : 'Sign in instantly with your verified email address OTP.'}
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
