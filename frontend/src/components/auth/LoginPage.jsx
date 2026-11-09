import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Shield, Lock, User, ArrowRight, UserCheck, AlertTriangle, Key, CheckCircle2, Download, QrCode, Smartphone, RefreshCw, Settings, Wifi } from 'lucide-react';
import ForgotPasswordModal from './ForgotPasswordModal';
import GoogleSignInButton from './GoogleSignInButton';
import AppDownloadModal from './AppDownloadModal';
import { probeLocalWardenIp, clearLocalWardenUrl, getLocalWardenUrl, setLocalWardenUrl } from '../../utils/api';

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
  const [discoveringWarden, setDiscoveringWarden] = useState(false);
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [manualIp, setManualIp] = useState('');
  const [currentWardenUrl, setCurrentWardenUrl] = useState(() => getLocalWardenUrl());

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

  // Silently probe local Warden server on mount so phone auto-connects to live Warden laptop on Wi-Fi
  useEffect(() => {
    let active = true;
    probeLocalWardenIp().then((res) => {
      if (active && res.success) {
        setCurrentWardenUrl(res.url);
      }
    }).catch(() => {});
    return () => { active = false; };
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
      // If failed due to unreachable server / network glitch, probe local Warden server (e.g. 172.20.10.2:5000)
      if (err.message && (err.message.includes('unreachable') || err.message.toLowerCase().includes('failed to fetch') || err.message.includes('NetworkError') || err.message.includes('Offline'))) {
        try {
          const probeRes = await probeLocalWardenIp();
          if (probeRes.success) {
            setCurrentWardenUrl(probeRes.url);
            await login(username.trim(), password);
            return;
          }
        } catch (_) {}
        setErrorMsg('Unable to connect to server. If offline, ensure your phone is connected to the Hostel Wi-Fi / Hotspot and tap "Server Wi-Fi Settings" below to connect to the Warden PC.');
      } else {
        setErrorMsg(err.message || 'Invalid credentials or inactive account.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAutoDiscoverWarden = async () => {
    setDiscoveringWarden(true);
    setErrorMsg('');
    const res = await probeLocalWardenIp();
    setDiscoveringWarden(false);
    if (res.success) {
      setCurrentWardenUrl(res.url);
      setSuccessBanner(`Connected to Warden Server at ${res.url}! You can now sign in.`);
    } else {
      setErrorMsg('Could not auto-detect Warden laptop. Tap "Server Wi-Fi Settings" below to enter the IP from the Warden terminal (e.g. 172.20.10.2:5000) or switch to Cloud.');
    }
  };

  const handleUseCloudServer = () => {
    clearLocalWardenUrl();
    setCurrentWardenUrl(null);
    setErrorMsg('');
    setSuccessBanner('Switched to Cloud Server! You can now sign in.');
  };

  const handleSaveManualIp = (e) => {
    e.preventDefault();
    if (!manualIp.trim()) return;
    let clean = manualIp.trim();
    if (!clean.startsWith('http')) clean = `http://${clean}`;
    clean = clean.replace(/\/+$/, '');
    const full = clean.endsWith('/api/v1') ? clean : `${clean}/api/v1`;
    setLocalWardenUrl(full);
    setCurrentWardenUrl(full);
    setErrorMsg('');
    setSuccessBanner(`Server IP saved: ${full}. You can now sign in.`);
    setManualIp('');
    setShowServerSettings(false);
  };

  const handleGoogleSuccess = async (credential) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await loginWithGoogle(credential);
      setSuccessBanner(res.message || 'Google identity verified successfully! Welcome back.');
    } catch (err) {
      setErrorMsg(
        'Google authentication requires internet connection. On offline Hostel Wi-Fi, please sign in above using your Roll Number (e.g. 2023CS01) and Password.'
      );
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
          {/* Active Server Connection Status Pill */}
          <div className="d-flex align-items-center justify-content-between px-2.5 py-1.5 mb-2.5 rounded-3 bg-light border small">
            <div className="d-flex align-items-center gap-1.5 text-truncate" style={{ fontSize: '11px' }}>
              <span className={`badge rounded-pill p-1 ${currentWardenUrl ? 'bg-success' : 'bg-primary'}`}> </span>
              <span className="text-muted">Hostel Server:</span>
              <span className="fw-semibold text-dark text-truncate">
                {currentWardenUrl ? `Wi-Fi (${currentWardenUrl.replace('http://', '').replace('/api/v1', '')})` : 'Cloud / Auto'}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-link btn-sm p-0 text-decoration-none text-primary fw-medium"
              style={{ fontSize: '11px' }}
              onClick={() => setShowServerSettings(!showServerSettings)}
            >
              {showServerSettings ? 'Close' : 'Change'}
            </button>
          </div>

          {showServerSettings && (
            <div className="p-2.5 mb-2.5 bg-light border rounded-3 text-start shadow-xs">
              <div className="fw-bold small text-dark mb-1" style={{ fontSize: '11.5px' }}>
                Warden Server Connection
              </div>
              <div className="text-muted small mb-2" style={{ fontSize: '11px', lineHeight: '1.35' }}>
                Active: <code className="text-dark bg-white border px-1 py-0.5 rounded">{currentWardenUrl || 'Cloud Server'}</code>
              </div>

              <div className="d-flex gap-1.5 mb-2">
                <button
                  type="button"
                  className="btn btn-primary btn-sm flex-fill py-1 px-2 fw-semibold"
                  style={{ fontSize: '11px' }}
                  onClick={handleAutoDiscoverWarden}
                  disabled={discoveringWarden}
                >
                  <RefreshCw size={12} className={discoveringWarden ? 'spin' : ''} />
                  {discoveringWarden ? 'Detecting...' : '🔄 Auto-Detect on Wi-Fi'}
                </button>

                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm py-1 px-2"
                  style={{ fontSize: '11px' }}
                  onClick={handleUseCloudServer}
                >
                  Cloud
                </button>
              </div>

              <div className="d-flex flex-wrap gap-1 mb-2">
                <button
                  type="button"
                  className="btn btn-outline-dark btn-sm py-0.5 px-2"
                  style={{ fontSize: '10.5px' }}
                  onClick={() => {
                    const full = 'http://172.20.10.2:5000/api/v1';
                    setLocalWardenUrl(full);
                    setCurrentWardenUrl(full);
                    setErrorMsg('');
                    setSuccessBanner('Connected to Warden Server at 172.20.10.2:5000! You can now sign in.');
                    setShowServerSettings(false);
                  }}
                >
                  ⚡ iPhone Hotspot (172.20.10.2)
                </button>
                <button
                  type="button"
                  className="btn btn-outline-dark btn-sm py-0.5 px-2"
                  style={{ fontSize: '10.5px' }}
                  onClick={() => {
                    const full = 'http://192.168.137.1:5000/api/v1';
                    setLocalWardenUrl(full);
                    setCurrentWardenUrl(full);
                    setErrorMsg('');
                    setSuccessBanner('Connected to Warden Server at 192.168.137.1:5000! You can now sign in.');
                    setShowServerSettings(false);
                  }}
                >
                  💻 Laptop Hotspot (192.168.137.1)
                </button>
              </div>

              <form onSubmit={handleSaveManualIp} className="d-flex gap-1">
                <input
                  type="text"
                  className="form-control form-control-sm"
                  style={{ fontSize: '11px' }}
                  placeholder="e.g. 172.20.10.2:5000"
                  value={manualIp}
                  onChange={(e) => setManualIp(e.target.value)}
                />
                <button type="submit" className="btn btn-dark btn-sm px-2 fw-semibold" style={{ fontSize: '11px' }}>
                  Save
                </button>
              </form>
            </div>
          )}

          {successBanner && (
            <div className="alert alert-success d-flex align-items-center gap-2 py-1.5 px-3 small mb-2.5" role="alert">
              <CheckCircle2 size={15} className="text-success flex-shrink-0" />
              <div style={{ fontSize: '12px' }}>{successBanner}</div>
            </div>
          )}

          {errorMsg && (
            <div className="alert alert-danger py-2 px-3 small mb-2.5" role="alert">
              <div className="d-flex align-items-center gap-2 mb-1">
                <AlertTriangle size={16} className="text-danger flex-shrink-0" />
                <div style={{ fontSize: '12px', lineHeight: '1.4' }}>{errorMsg}</div>
              </div>

              {errorMsg.toLowerCase().includes('unreachable') && (
                <div className="mt-2 pt-2 border-top border-danger border-opacity-25">
                  <div className="d-flex flex-column gap-1.5">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm py-1.5 px-2 fw-bold d-flex align-items-center justify-content-center gap-1.5 shadow-sm text-white"
                      style={{ fontSize: '11.5px', background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)' }}
                      onClick={handleAutoDiscoverWarden}
                      disabled={discoveringWarden}
                    >
                      <RefreshCw size={13} className={discoveringWarden ? 'spin' : ''} />
                      {discoveringWarden ? 'Scanning Wi-Fi...' : '🔄 Auto-Connect to Warden on Current Wi-Fi'}
                    </button>
                    
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm py-1 px-2 fw-semibold d-flex align-items-center justify-content-center gap-1.5"
                      style={{ fontSize: '11px' }}
                      onClick={handleUseCloudServer}
                    >
                      🌐 Switch to Cloud Server
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Primary Credentials Form */}
          <form onSubmit={handleSubmit}>
            <div className="mb-2">
              <label className="form-label small fw-medium text-dark mb-1" style={{ fontSize: '12px' }}>Username / Roll Number</label>
              <div className="input-group input-group-sm">
                <span className="input-group-text bg-light border-end-0">
                  <User size={15} className="text-muted" />
                </span>
                <input
                  type="text"
                  className="form-control border-start-0 ps-0"
                  placeholder="username/rollno"
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
              onError={(err) => setErrorMsg('Google Sign-In requires internet. On offline Wi-Fi, sign in above with Roll No & Password.')}
              disabled={loading}
            />
            <div className="text-center text-muted small mt-1" style={{ fontSize: '10px' }}>
              💡 On offline Hostel Wi-Fi, sign in above using Roll No &amp; Password
            </div>
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
