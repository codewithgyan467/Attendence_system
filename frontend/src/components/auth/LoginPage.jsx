import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Lock, User, ArrowRight, UserCheck, AlertTriangle, Key, CheckCircle2, Smartphone, RefreshCw, Settings, Eye, EyeOff } from 'lucide-react';
import ForgotPasswordModal from './ForgotPasswordModal';
import GoogleSignInButton from './GoogleSignInButton';
import AppDownloadModal from './AppDownloadModal';
import { probeLocalWardenIp, verifyHostWifiConnection, clearLocalWardenUrl, getLocalWardenUrl, setLocalWardenUrl } from '../../utils/api';

export default function LoginPage({ onNavigateOnboarding }) {
  const { login, loginWithGoogle } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successBanner, setSuccessBanner] = useState('');
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [magicLinkToken, setMagicLinkToken] = useState(null);
  const [hostStatus, setHostStatus] = useState('scanning'); // 'scanning' | 'connected' | 'disconnected'
  const [showManualIp, setShowManualIp] = useState(false);
  const [manualIp, setManualIp] = useState('');
  const [currentWardenUrl, setCurrentWardenUrl] = useState(() => {
    const u = getLocalWardenUrl();
    if (u && (typeof window !== 'undefined' && (/iPad|iPhone|Android/i.test(navigator.userAgent) || window.location.protocol === 'https:') && (u.includes('localhost') || u.includes('127.0.0.1')))) {
      clearLocalWardenUrl();
      return null;
    }
    return u;
  });

  const syncHostConnection = useCallback(async ({ showScanning = false } = {}) => {
    if (showScanning) setHostStatus('scanning');
    try {
      const res = await verifyHostWifiConnection({ autoProbe: true });
      if (res.connected) {
        setCurrentWardenUrl(res.url);
        setHostStatus('connected');
      } else {
        setCurrentWardenUrl(null);
        setHostStatus('disconnected');
      }
      return res;
    } catch (_) {
      setHostStatus('disconnected');
      return { connected: false, url: null, wardenIp: null };
    }
  }, []);

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

  // Auto-detect host Wi-Fi server on mount, focus/network regain, and periodic heartbeat
  useEffect(() => {
    let active = true;
    const runCheck = async (showScanning = false) => {
      if (!active) return;
      await syncHostConnection({ showScanning });
    };

    runCheck(true);

    const handleReconnectEvent = () => runCheck(false);
    const handleVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        runCheck(false);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleReconnectEvent);
      window.addEventListener('focus', handleReconnectEvent);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }

    const intervalId = setInterval(() => runCheck(false), 10000);

    return () => {
      active = false;
      clearInterval(intervalId);
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleReconnectEvent);
        window.removeEventListener('focus', handleReconnectEvent);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, [syncHostConnection]);

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
      if (err.message && (err.message.includes('unreachable') || err.message.toLowerCase().includes('failed to fetch') || err.message.includes('NetworkError') || err.message.includes('Offline') || err.message.includes('Unable to reach'))) {
        try {
          const probeRes = await probeLocalWardenIp();
          if (probeRes.success) {
            setCurrentWardenUrl(probeRes.url);
            setHostStatus('connected');
            await login(username.trim(), password);
            return;
          }
        } catch (_) { }
        setHostStatus('disconnected');
        setErrorMsg('Host server unreachable. Connect your device to the same Hostel Wi-Fi as the Warden host.');
      } else {
        setErrorMsg(err.message || 'Invalid credentials or inactive account.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSaveManualIp = async (e) => {
    e.preventDefault();
    if (!manualIp.trim()) return;
    let clean = manualIp.trim().replace(/\/+$/, '');
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = `http://${clean}`;
    }
    const cleanNoApi = clean.replace(/\/api\/v1$/, '');
    const withDefaultPort = /^http:\/\/[^/:]+$/i.test(cleanNoApi) ? `${cleanNoApi}:5000` : cleanNoApi;
    const full = `${withDefaultPort}/api/v1`;

    setHostStatus('scanning');
    const res = await probeLocalWardenIp(withDefaultPort);

    if (res.success) {
      setCurrentWardenUrl(res.url);
      setHostStatus('connected');
      setErrorMsg('');
    } else {
      setLocalWardenUrl(full);
      setCurrentWardenUrl(full);
      setHostStatus('disconnected');
      const displayTarget = withDefaultPort.replace(/^https?:\/\//, '');
      setErrorMsg(`Could not reach ${displayTarget}. Ensure the host server is running and both devices are on a Wi-Fi allowing local traffic.`);
    }
    setManualIp('');
    setShowManualIp(false);
  };

  const handleGoogleSuccess = async (credential) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await loginWithGoogle(credential);
      setSuccessBanner(res.message || 'Google identity verified successfully! Welcome back.');
    } catch (err) {
      const msg = err?.message || '';
      if (/unreachable|failed to fetch|network/i.test(msg)) {
        setErrorMsg(
          'Google authentication requires internet access. On offline Hostel Wi-Fi, sign in with Username / Roll No & Password.'
        );
      } else {
        setErrorMsg(
          msg || 'Google authentication is unavailable on this server. Sign in using your Username & Password.'
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const hostIpLabel = currentWardenUrl
    ? currentWardenUrl.replace(/^https?:\/\//, '').replace(/\/api\/v1$/, '')
    : '';

  return (
    <div className="container d-flex justify-content-center my-auto py-2">
      <div className="card hg-card shadow-lg border-0 rounded-2" style={{ maxWidth: '410px', width: '100%', overflow: 'hidden' }}>
        {/* Card Header */}
        <div className="px-3 py-2.5 text-center text-white bg-dark border-bottom border-secondary">
          <img
            src="/icon-192.png"
            alt="ATTENDRA Logo"
            className="rounded-circle shadow mb-1.5 border border-2 border-primary border-opacity-50"
            style={{ width: '48px', height: '48px', objectFit: 'cover' }}
          />
          <h5 className="fw-bold mb-0 text-white" style={{ fontSize: '18px', letterSpacing: '0.5px' }}>ATTENDRA</h5>
          <p className="text-info small mb-0 fw-semibold" style={{ fontSize: '11px', letterSpacing: '0.2px' }}>
            Presence Powered by Intelligence.
          </p>
          <div className="text-white-50" style={{ fontSize: '9.5px', marginTop: '2px', letterSpacing: '0.8px' }}>
            GPS &bull; BLE &bull; SMART ATTENDANCE
          </div>
        </div>

        {/* Card Body */}
        <div className="card-body p-3 p-sm-3.5">
          {/* Single-Line Host Wi-Fi Connection Indicator (Blinking Green / Red LED) */}
          <div className="d-flex align-items-center justify-content-between px-2.5 py-1.5 mb-2.5 rounded-3 bg-light border">
            <div
              className="d-flex align-items-center gap-2 text-truncate"
              style={{ fontSize: '11.5px', cursor: 'pointer' }}
              onClick={() => syncHostConnection({ showScanning: true })}
              title={hostStatus === 'connected' ? `Connected to ${hostIpLabel}` : 'Tap to re-scan Host Wi-Fi'}
            >
              <span
                className={`hg-wifi-led ${
                  hostStatus === 'connected'
                    ? 'hg-wifi-led--green'
                    : hostStatus === 'scanning'
                      ? 'hg-wifi-led--scanning'
                      : 'hg-wifi-led--red'
                }`}
                aria-hidden="true"
              />
              <span className={`fw-semibold text-truncate ${hostStatus === 'connected' ? 'text-success' : hostStatus === 'scanning' ? 'text-warning-emphasis' : 'text-danger'}`}>
                {hostStatus === 'connected'
                  ? `Host Wi-Fi Connected${hostIpLabel ? ` · ${hostIpLabel}` : ''}`
                  : hostStatus === 'scanning'
                    ? 'Detecting Host Wi-Fi...'
                    : 'Not Connected to Host Wi-Fi'}
              </span>
            </div>

            <div className="d-flex align-items-center gap-1.5 flex-shrink-0 ms-2">
              <button
                type="button"
                className="btn btn-link btn-sm p-0 text-decoration-none text-secondary d-inline-flex align-items-center"
                onClick={() => syncHostConnection({ showScanning: true })}
                disabled={hostStatus === 'scanning'}
                title="Re-detect Host Wi-Fi"
                aria-label="Re-detect Host Wi-Fi"
              >
                <RefreshCw size={12} className={hostStatus === 'scanning' ? 'spin' : ''} />
              </button>
              <button
                type="button"
                className="btn btn-link btn-sm p-0 text-decoration-none text-muted d-inline-flex align-items-center"
                onClick={() => setShowManualIp((prev) => !prev)}
                title="Enter custom host IP"
                aria-label="Enter custom host IP"
              >
                <Settings size={12} />
              </button>
            </div>
          </div>

          {showManualIp && (
            <form onSubmit={handleSaveManualIp} className="d-flex gap-1.5 mb-2.5">
              <input
                type="text"
                className="form-control form-control-sm"
                style={{ fontSize: '11.5px' }}
                placeholder="Host IP (e.g. 172.20.10.2:5000)"
                value={manualIp}
                onChange={(e) => setManualIp(e.target.value)}
              />
              <button type="submit" className="btn btn-dark btn-sm px-2.5 fw-semibold" style={{ fontSize: '11.5px' }}>
                Connect
              </button>
            </form>
          )}

          {successBanner && (
            <div className="alert alert-success d-flex align-items-center gap-2 py-1.5 px-3 small mb-2.5" role="alert">
              <CheckCircle2 size={15} className="text-success flex-shrink-0" />
              <div style={{ fontSize: '12px' }}>{successBanner}</div>
            </div>
          )}

          {errorMsg && (
            <div className="alert alert-danger d-flex align-items-center gap-2 py-2 px-3 small mb-2.5" role="alert">
              <AlertTriangle size={15} className="text-danger flex-shrink-0" />
              <div style={{ fontSize: '12px', lineHeight: '1.35' }}>{errorMsg}</div>
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
                  <Key size={11} /> Reset Password?
                </button>
              </div>
              <div className="input-group input-group-sm">
                <span className="input-group-text bg-light border-end-0">
                  <Lock size={15} className="text-muted" />
                </span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="form-control border-start-0 border-end-0 ps-0"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  required
                />
                <button
                  type="button"
                  className="btn btn-outline-secondary border-start-0 bg-light px-2"
                  onClick={() => setShowPassword(!showPassword)}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={13} className="text-muted" /> : <Eye size={13} className="text-muted" />}
                </button>
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
          <div className="mb-2.5">
            <GoogleSignInButton
              onSuccess={handleGoogleSuccess}
              onError={(err) => setErrorMsg(typeof err === 'string' && err ? err : 'Google Sign-In is unavailable. Sign in above with Username / Roll No & Password.')}
              disabled={loading}
            />
          </div>

          {/* Footer Links: New Student Enrollment + Compact Mobile App Link */}
          <div className="d-flex align-items-center justify-content-between mt-2 pt-2 border-top">
            <button
              type="button"
              className="btn btn-link btn-sm text-decoration-none text-primary fw-semibold p-0 d-inline-flex align-items-center gap-1"
              style={{ fontSize: '12px' }}
              onClick={onNavigateOnboarding}
            >
              <UserCheck size={14} /> New Student Enrollment
            </button>

            <button
              type="button"
              className="btn btn-link btn-sm text-decoration-none text-success fw-semibold p-0 d-inline-flex align-items-center gap-1"
              style={{ fontSize: '11.5px' }}
              onClick={() => setShowDownloadModal(true)}
            >
              <Smartphone size={13} /> Mobile App
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
