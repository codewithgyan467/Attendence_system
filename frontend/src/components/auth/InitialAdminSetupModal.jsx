import React, { useState } from 'react';
import { api, authStorage } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import {
  ShieldAlert,
  Key,
  Lock,
  User,
  Mail,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  ArrowRight,
  ShieldCheck
} from 'lucide-react';

export default function InitialAdminSetupModal({ isOpen, user, onSetupComplete }) {
  const { setAuthenticatedStudent } = useAuth();
  const [username, setUsername] = useState(user?.username || 'admin');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('Admin@12345');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [generatedMasterKey, setGeneratedMasterKey] = useState(null);
  const [copiedKey, setCopiedKey] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    if (generatedMasterKey) {
      navigator.clipboard.writeText(generatedMasterKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2500);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (!username.trim() || !email.trim() || !newPassword || !currentPassword) {
      setErrorMsg('All fields are required.');
      return;
    }

    if (email.trim().toLowerCase().endsWith('@hostelguard.local')) {
      setErrorMsg('Please provide a real institution or personal email, not the default placeholder.');
      return;
    }

    if (newPassword.length < 8) {
      setErrorMsg('New password must be at least 8 characters long.');
      return;
    }

    if (newPassword === 'Admin@12345') {
      setErrorMsg('New password cannot be the default Admin@12345.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('New password and confirm password do not match.');
      return;
    }

    setLoading(true);

    try {
      const res = await api.auth.initialAdminSetup({
        new_username: username.trim(),
        new_email: email.trim().toLowerCase(),
        new_password: newPassword,
        current_password: currentPassword
      });

      if (res.success) {
        if (res.token && res.user) {
          authStorage.setToken(res.token);
          authStorage.setUser(res.user);
          if (res.refreshToken) authStorage.setRefreshToken(res.refreshToken);
        }
        setGeneratedMasterKey(res.masterRecoveryKey);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to complete initial security setup.');
    } finally {
      setLoading(false);
    }
  };

  const handleFinish = () => {
    if (onSetupComplete) {
      onSetupComplete();
    }
  };

  return (
    <div
      className="modal fade show d-block hg-modal-backdrop"
      tabIndex="-1"
      style={{ zIndex: 1060 }}
    >
      <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: '520px' }}>
        <div className="modal-content hg-card border-0 shadow-lg rounded-2 overflow-hidden">
          {/* Header */}
          <div
            className="px-3 py-2.5 text-white bg-dark border-bottom border-secondary"
          >
            <div className="d-flex align-items-center gap-2 mb-1">
              <div className="p-2 rounded-3 bg-danger bg-opacity-20 text-danger border border-danger border-opacity-30">
                <ShieldAlert size={20} />
              </div>
              <div>
                <h5 className="modal-title fw-bold mb-0 text-white" style={{ fontSize: '16px' }}>
                  Mandatory Security Setup
                </h5>
                <span className="text-muted small" style={{ fontSize: '11.5px' }}>
                  Default Administrator Credentials Detected
                </span>
              </div>
            </div>
          </div>

          <div className="modal-body p-4">
            {generatedMasterKey ? (
              // Step 2: Show Master Recovery Key
              <div>
                <div className="text-center mb-3">
                  <div className="mx-auto d-inline-flex p-3 rounded-circle bg-success bg-opacity-10 text-success mb-2">
                    <ShieldCheck size={36} />
                  </div>
                  <h6 className="fw-bold text-dark mb-1">Security Setup Completed!</h6>
                  <p className="text-muted small mb-0">
                    Your official email and new password are now active. Below is your single-use <strong>Emergency Master Recovery Key</strong>.
                  </p>
                </div>

                <div className="alert alert-warning border-warning border-opacity-40 p-3 mb-3" style={{ fontSize: '12.5px' }}>
                  <strong>⚠️ Critical Notice:</strong> If future wardens change, or if login credentials are forgotten, this Master Recovery Key allows resetting the administrator account without data loss.
                </div>

                <label className="form-label small fw-semibold text-secondary mb-1">
                  Emergency Master Recovery Key
                </label>
                <div className="input-group mb-3">
                  <input
                    type="text"
                    className="form-control font-monospace fw-bold text-primary bg-light"
                    value={generatedMasterKey}
                    readOnly
                    style={{ fontSize: '14px', letterSpacing: '1px' }}
                  />
                  <button
                    className={`btn ${copiedKey ? 'btn-success' : 'btn-outline-primary'} d-flex align-items-center gap-1 px-3`}
                    onClick={handleCopy}
                    type="button"
                  >
                    {copiedKey ? <Check size={16} /> : <Copy size={16} />}
                    <span>{copiedKey ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>

                <button
                  type="button"
                  className="btn btn-primary w-100 py-2.5 fw-semibold d-flex align-items-center justify-content-center gap-2 shadow-sm rounded-3 mt-4"
                  onClick={handleFinish}
                >
                  <span>I Have Stored My Master Key — Enter Portal</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              // Step 1: Input New Credentials
              <form onSubmit={handleSubmit}>
                <div className="alert alert-light border d-flex gap-2 p-2.5 mb-3" style={{ fontSize: '12px' }}>
                  <AlertTriangle size={18} className="text-warning flex-shrink-0 mt-0.5" />
                  <div>
                    This hostel attendance system holds sensitive biometric and geo-fenced logs. You must replace the default <code>admin</code> / <code>Admin@12345</code> account before proceeding.
                  </div>
                </div>

                {errorMsg && (
                  <div className="alert alert-danger py-2 px-3 small d-flex align-items-center gap-2 mb-3">
                    <AlertTriangle size={15} />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <div className="mb-2.5">
                  <label className="form-label small fw-semibold text-dark mb-1">Administrator Username</label>
                  <div className="input-group input-group-sm">
                    <span className="input-group-text bg-light"><User size={15} className="text-muted" /></span>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="e.g. warden_main or admin"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="mb-2.5">
                  <label className="form-label small fw-semibold text-dark mb-1">Official College / Warden Email</label>
                  <div className="input-group input-group-sm">
                    <span className="input-group-text bg-light"><Mail size={15} className="text-muted" /></span>
                    <input
                      type="email"
                      className="form-control"
                      placeholder="e.g. warden.hostel@college.edu"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-text" style={{ fontSize: '11px' }}>
                    Password recovery codes and security notifications will be delivered to this email.
                  </div>
                </div>

                <div className="mb-2.5">
                  <label className="form-label small fw-semibold text-dark mb-1">Current Password</label>
                  <div className="input-group input-group-sm">
                    <span className="input-group-text bg-light"><Lock size={15} className="text-muted" /></span>
                    <input
                      type="password"
                      className="form-control"
                      placeholder="Admin@12345"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="row g-2 mb-3">
                  <div className="col-12 col-sm-6">
                    <label className="form-label small fw-semibold text-dark mb-1">New Secure Password</label>
                    <div className="input-group input-group-sm">
                      <span className="input-group-text bg-light"><Key size={15} className="text-muted" /></span>
                      <input
                        type="password"
                        className="form-control"
                        placeholder="Min 8 characters"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <div className="col-12 col-sm-6">
                    <label className="form-label small fw-semibold text-dark mb-1">Confirm New Password</label>
                    <div className="input-group input-group-sm">
                      <span className="input-group-text bg-light"><CheckCircle2 size={15} className="text-muted" /></span>
                      <input
                        type="password"
                        className="form-control"
                        placeholder="Repeat new password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary w-100 py-2 fw-semibold d-flex align-items-center justify-content-center gap-2 shadow-sm rounded-3 mt-3"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <span className="spinner-border spinner-border-sm" role="status"></span>
                      <span>Configuring Security Profile...</span>
                    </>
                  ) : (
                    <>
                      <span>Save Credentials &amp; Generate Master Key</span>
                      <ArrowRight size={15} />
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
