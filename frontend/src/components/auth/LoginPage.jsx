import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Shield, Lock, User, ArrowRight, UserCheck, AlertTriangle, Key, Server, Check, CheckCircle2, Download, QrCode } from 'lucide-react';
import { getApiBaseUrl, authStorage } from '../../utils/api';
import ForgotPasswordModal from './ForgotPasswordModal';
import GoogleSignInButton from './GoogleSignInButton';
import AppDownloadModal from './AppDownloadModal';

export default function LoginPage({ onNavigateOnboarding }) {
  const { login, loginWithGoogle } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successBanner, setSuccessBanner] = useState('');
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [magicLinkToken, setMagicLinkToken] = useState(null);
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [customServerUrl, setCustomServerUrl] = useState(authStorage.getBackendUrl());
  const [serverSavedMsg, setServerSavedMsg] = useState(false);

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

  const handleGoogleSuccess = async (credential) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await loginWithGoogle(credential);
      setSuccessBanner(res.message || 'Google identity verified successfully! Welcome back.');
    } catch (err) {
      setErrorMsg(err.message || 'Google authentication failed. Please ensure your email is registered in the hostel system.');
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

          {/* Primary Credentials Form */}
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
              className="btn btn-primary w-100 py-2 d-flex align-items-center justify-content-center gap-2 fw-semibold mb-3 shadow-sm"
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

          {/* Sleek Modern Divider */}
          <div className="position-relative my-4 text-center">
            <hr className="text-secondary opacity-25 m-0" />
            <span
              className="position-absolute top-50 start-50 translate-middle bg-white px-3 text-muted fw-bold"
              style={{ fontSize: '11px', letterSpacing: '0.08em' }}
            >
              OR CONTINUE WITH
            </span>
          </div>

          {/* Modern Google JWT Authentication */}
          <div className="mb-3">
            <GoogleSignInButton
              onSuccess={handleGoogleSuccess}
              onError={(err) => setErrorMsg(err)}
              disabled={loading}
            />
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

          {/* Android Mobile App Direct Download & QR Code Link */}
          <div className="text-center mt-3 pt-3 border-top">
            <p className="text-muted small mb-2">Mark attendance from your Android phone:</p>
            <button
              type="button"
              className="btn btn-outline-success btn-sm w-100 py-2 d-inline-flex align-items-center justify-content-center gap-2 fw-semibold shadow-sm rounded-3"
              style={{ borderColor: '#10b981', color: '#047857', backgroundColor: '#ecfdf5' }}
              onClick={() => setShowDownloadModal(true)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#10b981" aria-hidden="true">
                <path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.551 0 .9993.4482.9993.9993.0001.5511-.4483.9997-.9993.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m11.4045-6.02l1.9973-3.4592a.416.416 0 00-.1521-.5676.416.416 0 00-.5676.1521l-2.0223 3.503C15.5902 8.4116 13.8533 8.0822 12 8.0822s-3.5902.3294-5.1368.8676L4.841 5.4468a.416.416 0 00-.5677-.1521.4157.4157 0 00-.152.5676l1.9972 3.4592C2.6889 11.1867.3432 14.6589 0 18.761h24c-.3432-4.1021-2.6889-7.5743-6.1185-9.4396" />
              </svg>
              <span>Download Android App (.APK)</span>
              <QrCode size={16} />
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

      {/* Android APK Download & QR Code Modal */}
      <AppDownloadModal
        isOpen={showDownloadModal}
        onClose={() => setShowDownloadModal(false)}
      />
    </div>
  );
}
