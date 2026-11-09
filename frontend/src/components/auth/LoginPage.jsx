import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Shield, Lock, User, ArrowRight, UserCheck, AlertTriangle, Key, CheckCircle2, Download, QrCode, Smartphone, RefreshCw, Settings, Wifi } from 'lucide-react';
import ForgotPasswordModal from './ForgotPasswordModal';
import GoogleSignInButton from './GoogleSignInButton';
import AppDownloadModal from './AppDownloadModal';
import { probeLocalWardenIp, clearLocalWardenUrl, getLocalWardenUrl, setLocalWardenUrl } from '../../utils/api';
import ShinyText from '../ShinyText';
import ClickSpark from '../ClickSpark';
import SpotlightCard from '../SpotlightCard';
import BorderBeam from '../BorderBeam';
import Particles from '../Particles';

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
      // If failed due to unreachable local server, auto-clear local IP and retry via Cloud
      if (err.message && (err.message.includes('unreachable') || err.message.toLowerCase().includes('failed to fetch') || err.message.includes('NetworkError'))) {
        clearLocalWardenUrl();
        setCurrentWardenUrl(null);
        try {
          await login(username.trim(), password);
          return;
        } catch (retryErr) {
          setErrorMsg(retryErr.message || 'Invalid credentials or inactive account.');
        }
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
      setErrorMsg(err.message || 'Google authentication failed. Please ensure your email is registered in the hostel system.');
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="position-relative min-vh-100 d-flex flex-column justify-content-center overflow-hidden">
      {/* Background ambient particle aura (auto-pauses on reduced-motion or offscreen) */}
      <Particles
        particleCount={20}
        particleColors={['#6366f1', '#3b82f6', '#06b6d4']}
        speed={0.05}
        particleBaseSize={60}
        moveParticlesOnHover={false}
        alphaParticles={true}
        disableRotation={true}
        style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}
      />
      <ClickSpark sparkColor={['#6366f1', '#3b82f6', '#10b981']} sparkSize={10} sparkRadius={22}>
        <div className="container d-flex justify-content-center my-auto py-2 position-relative" style={{ zIndex: 1 }}>
          <SpotlightCard
            theme="light"
            spotlightColor="rgba(99, 102, 241, 0.16)"
            className="card shadow-lg border-0 rounded-4 position-relative"
            style={{ maxWidth: '420px', width: '100%', padding: 0, overflow: 'hidden' }}
          >
            <BorderBeam colorFrom="#3b82f6" colorTo="#6366f1" duration={6} borderWidth={1.5} />
            {/* Card Header */}
          <div className="px-3 py-2.5 text-center text-white" style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)' }}>
            <img
              src="/icon-192.png"
              alt="HostelGuard Security Mascot"
              className="rounded-circle shadow mb-1.5 border border-2 border-primary border-opacity-50"
              style={{ width: '46px', height: '46px', objectFit: 'cover' }}
            />
            <div>
              <ShinyText text="HostelGuard Portal" color="#ffffff" shineColor="#60a5fa" speed={2.5} className="fw-bold mb-0 text-white d-block" style={{ fontSize: '16px' }} />
            </div>
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

          {/* Server Settings (Wi-Fi LAN IP / Cloud) */}
          <div className="text-center mt-2 pt-1 border-top">
            <button
              type="button"
              className="btn btn-link btn-sm text-decoration-none text-muted p-0 d-inline-flex align-items-center gap-1"
              style={{ fontSize: '10.5px' }}
              onClick={() => setShowServerSettings(!showServerSettings)}
            >
              <Wifi size={11} />
              <span>Hostel Server: {currentWardenUrl ? `Wi-Fi (${currentWardenUrl.replace('http://', '').replace('/api/v1', '')})` : 'Cloud (Default)'}</span>
              <Settings size={10} className="ms-0.5" />
            </button>

            {showServerSettings && (
              <div className="p-2.5 mt-2 bg-light border rounded-3 text-start shadow-xs">
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
          </div>
        </div>
        </SpotlightCard>
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
    </ClickSpark>
    </div>
  );
}
