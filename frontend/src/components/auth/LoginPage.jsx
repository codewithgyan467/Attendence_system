import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Shield, Lock, User, ArrowRight, UserCheck, AlertTriangle, Key, CheckCircle2, Download, QrCode, Smartphone } from 'lucide-react';
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


  return (
    <div className="container d-flex justify-content-center my-auto py-2">
      <div className="card shadow-lg border-0 rounded-4" style={{ maxWidth: '420px', width: '100%', overflow: 'hidden' }}>
        {/* Card Header */}
        <div className="px-3 py-2.5 text-center text-white" style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)' }}>
          <img
            src="/icon-192.png"
            alt="HostelGuard Security Mascot"
            className="rounded-circle shadow mb-1.5 border border-2 border-primary border-opacity-50"
            style={{ width: '46px', height: '46px', objectFit: 'cover' }}
          />
          <h5 className="fw-bold mb-0 text-white" style={{ fontSize: '16px' }}>HostelGuard Portal</h5>
          <p className="text-muted small mb-0" style={{ fontSize: '11px' }}>
            Biometric &amp; Geofenced Attendance Management
          </p>
        </div>

        {/* Card Body */}
        <div className="card-body p-3 p-sm-3.5">
          {successBanner && (
            <div className="alert alert-success d-flex align-items-center gap-2 py-1.5 px-3 small mb-2.5" role="alert">
              <CheckCircle2 size={15} className="text-success flex-shrink-0" />
              <div style={{ fontSize: '12px' }}>{successBanner}</div>
            </div>
          )}

          {errorMsg && (
            <div className="alert alert-danger d-flex align-items-center gap-2 py-1.5 px-3 small mb-2.5" role="alert">
              <AlertTriangle size={15} className="flex-shrink-0" />
              <div style={{ fontSize: '12px' }}>{errorMsg}</div>
            </div>
          )}

          {/* Primary Credentials Form */}
          <form onSubmit={handleSubmit}>
            <div className="mb-2">
              <label className="form-label small fw-medium text-dark mb-1" style={{ fontSize: '12px' }}>Roll Number, Email, or Username</label>
              <div className="input-group input-group-sm">
                <span className="input-group-text bg-light border-end-0">
                  <User size={15} className="text-muted" />
                </span>
                <input
                  type="text"
                  className="form-control border-start-0 ps-0"
                  placeholder="e.g. 2024CS001 or admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>
            </div>

            <div className="mb-2.5">
              <div className="d-flex align-items-center justify-content-between mb-1">
                <label className="form-label small fw-medium text-dark mb-0" style={{ fontSize: '12px' }}>Account Password</label>
                <button
                  type="button"
                  className="btn btn-link btn-sm text-decoration-none p-0 text-primary small fw-semibold d-inline-flex align-items-center gap-1"
                  style={{ fontSize: '11.5px' }}
                  onClick={() => setShowForgotModal(true)}
                >
                  <Key size={11} /> Forgot?
                </button>
              </div>
              <div className="input-group input-group-sm">
                <span className="input-group-text bg-light border-end-0">
                  <Lock size={15} className="text-muted" />
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
              className="btn btn-primary w-100 py-1.5 d-flex align-items-center justify-content-center gap-2 fw-semibold mb-2 shadow-sm"
              style={{ fontSize: '13px' }}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner-border spinner-border-sm" role="status"></span>
                  Verifying...
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          </form>

          {/* Sleek Modern Divider */}
          <div className="position-relative my-2 text-center">
            <hr className="text-secondary opacity-25 m-0" />
            <span
              className="position-absolute top-50 start-50 translate-middle bg-white px-2 text-muted fw-bold"
              style={{ fontSize: '10px', letterSpacing: '0.06em' }}
            >
              OR
            </span>
          </div>

          {/* Modern Google JWT Authentication */}
          <div className="mb-2">
            <GoogleSignInButton
              onSuccess={handleGoogleSuccess}
              onError={(err) => setErrorMsg(err)}
              disabled={loading}
            />
          </div>

          {/* Mobile App Download & QR Code Modal Link (Android & iOS) */}
          <div className="text-center mt-2 pt-2 border-top">
            <button
              type="button"
              className="btn btn-outline-success btn-sm w-100 py-1.5 d-inline-flex align-items-center justify-content-center gap-2 fw-semibold shadow-sm rounded-3"
              style={{ borderColor: '#10b981', color: '#047857', backgroundColor: '#ecfdf5', fontSize: '12.5px' }}
              onClick={() => setShowDownloadModal(true)}
            >
              <Smartphone size={15} className="text-success" />
              <span>Get Mobile App (Android &amp; iOS)</span>
              <QrCode size={14} />
            </button>
          </div>

          {/* Student Onboarding Link */}
          <div className="text-center mt-2 pt-2 border-top">
            <button
              type="button"
              className="btn btn-link btn-sm text-decoration-none text-primary p-0 d-inline-flex align-items-center gap-1"
              style={{ fontSize: '11.5px' }}
              onClick={onNavigateOnboarding}
            >
              <UserCheck size={13} /> New Student Enrollment
            </button>
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
