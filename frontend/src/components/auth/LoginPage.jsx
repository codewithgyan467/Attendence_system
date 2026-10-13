import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Shield, Lock, User, ArrowRight, UserCheck, AlertTriangle, Key, Server, Check } from 'lucide-react';
import { getApiBaseUrl, authStorage } from '../../utils/api';

export default function LoginPage({ onNavigateOnboarding }) {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [customServerUrl, setCustomServerUrl] = useState(authStorage.getBackendUrl());
  const [serverSavedMsg, setServerSavedMsg] = useState(false);

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

  const handleQuickLogin = (u, p) => {
    setUsername(u);
    setPassword(p);
    setErrorMsg('');
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
          {errorMsg && (
            <div className="alert alert-danger d-flex align-items-center gap-2 py-2 px-3 small mb-4" role="alert">
              <AlertTriangle size={16} className="flex-shrink-0" />
              <div>{errorMsg}</div>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label small fw-medium text-dark">Username or Roll Number</label>
              <div className="input-group">
                <span className="input-group-text bg-light border-end-0">
                  <User size={16} className="text-muted" />
                </span>
                <input
                  type="text"
                  className="form-control border-start-0 ps-0"
                  placeholder="e.g. admin or 2024CS001"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="form-label small fw-medium text-dark">Account Password</label>
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

          {/* Quick Demo Access Buttons */}
          <div className="border-top pt-3 mt-3">
            <div className="text-uppercase text-muted fw-bold mb-2 text-center" style={{ fontSize: '11px', letterSpacing: '0.8px' }}>
              Quick Evaluator Credentials
            </div>
            <div className="d-grid gap-2">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary d-flex align-items-center justify-content-between px-3"
                onClick={() => handleQuickLogin('admin', 'Admin@12345')}
              >
                <span>👑 System Administrator</span>
                <code className="text-primary small">admin</code>
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary d-flex align-items-center justify-content-between px-3"
                onClick={() => handleQuickLogin('warden', 'Warden@12345')}
              >
                <span>🏢 Hostel Warden</span>
                <code className="text-primary small">warden</code>
              </button>
            </div>
          </div>

          {/* Student Onboarding Action */}
          <div className="text-center mt-4 pt-2 border-top">
            <p className="text-muted small mb-2">New resident not enrolled yet?</p>
            <button
              type="button"
              className="btn btn-outline-primary btn-sm px-3 d-inline-flex align-items-center gap-1"
              onClick={onNavigateOnboarding}
            >
              <UserCheck size={14} /> Student Self-Registration (Phase 2)
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
    </div>
  );
}
