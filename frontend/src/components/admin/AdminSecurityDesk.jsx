import React, { useState, useEffect } from 'react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { formatDateIST } from '../../utils/timeUtils';
import {
  Shield,
  Key,
  Lock,
  User,
  Mail,
  CheckCircle2,
  AlertTriangle,
  RotateCw,
  Copy,
  Check,
  ShieldAlert,
  LogOut,
  Save,
  Info,
  Wifi,
  Radio,
  RefreshCw
} from 'lucide-react';

export default function AdminSecurityDesk() {
  const { user, logoutAll } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Profile Edit State
  const [editUsername, setEditUsername] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [profileCurrentPassword, setProfileCurrentPassword] = useState('');
  const [updatingProfile, setUpdatingProfile] = useState(false);

  // Password Change State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);

  // Master Recovery Key State
  const [showRegenModal, setShowRegenModal] = useState(false);
  const [regenCurrentPassword, setRegenCurrentPassword] = useState('');
  const [regeneratingKey, setRegeneratingKey] = useState(false);
  const [newlyGeneratedKey, setNewlyGeneratedKey] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);

  // Multi-Router Wi-Fi Cluster State (Strict Lock)
  const [wifiCluster, setWifiCluster] = useState(null);
  const [loadingCluster, setLoadingCluster] = useState(false);

  const loadClusterStatus = async () => {
    try {
      setLoadingCluster(true);
      const res = await fetch('/api/admin/wifi-cluster/status');
      if (res.ok) {
        const data = await res.json();
        setWifiCluster(data);
      }
    } catch (_) {
      // Non-blocking
    } finally {
      setLoadingCluster(false);
    }
  };

  const loadProfile = async () => {
    try {
      setLoading(true);
      setErrorMsg('');
      const res = await api.admin.getSecurityProfile();
      if (res.success) {
        setProfile(res);
        setEditUsername(res.user?.username || '');
        setEditEmail(res.user?.email || '');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to load security profile.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
    loadClusterStatus();
  }, []);

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!editUsername.trim() || !editEmail.trim() || !profileCurrentPassword) {
      setErrorMsg('Please enter your username, email, and current password.');
      return;
    }

    setUpdatingProfile(true);
    try {
      const res = await api.admin.updateSecurityProfile({
        username: editUsername.trim(),
        email: editEmail.trim(),
        current_password: profileCurrentPassword
      });

      if (res.success) {
        setSuccessMsg(res.message || 'Profile updated successfully.');
        setProfileCurrentPassword('');
        loadProfile();
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to update administrator profile.');
    } finally {
      setUpdatingProfile(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setErrorMsg('All password fields are required.');
      return;
    }

    if (newPassword.length < 8) {
      setErrorMsg('New password must be at least 8 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('New password and confirmation password do not match.');
      return;
    }

    setUpdatingPassword(true);
    try {
      const res = await api.auth.changePassword({
        current_password: currentPassword,
        new_password: newPassword
      });

      if (res.success) {
        setSuccessMsg('Administrator password changed successfully! Prior sessions have been revoked.');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to change password.');
    } finally {
      setUpdatingPassword(false);
    }
  };

  const handleRegenerateMasterKey = async (e) => {
    e.preventDefault();
    if (!regenCurrentPassword) {
      setErrorMsg('Current password is required to regenerate master recovery key.');
      return;
    }

    setRegeneratingKey(true);
    setErrorMsg('');
    try {
      const res = await api.admin.regenerateMasterKey({
        current_password: regenCurrentPassword
      });

      if (res.success && res.masterRecoveryKey) {
        setNewlyGeneratedKey(res.masterRecoveryKey);
        setRegenCurrentPassword('');
        loadProfile();
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to regenerate Master Recovery Key.');
    } finally {
      setRegeneratingKey(false);
    }
  };

  const handleCopyKey = () => {
    if (newlyGeneratedKey) {
      navigator.clipboard.writeText(newlyGeneratedKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2500);
    }
  };

  if (loading && !profile) {
    return (
      <div className="p-4 text-center">
        <div className="spinner-border text-primary" role="status"></div>
        <div className="text-muted mt-2">Loading security desk...</div>
      </div>
    );
  }

  const u = profile?.user || user;
  const rk = profile?.recoveryKey;

  return (
    <div className="container-fluid px-0">
      {/* Header */}
      <div className="d-flex align-items-center justify-content-between mb-4 flex-wrap gap-2">
        <div>
          <h4 className="fw-bold mb-1 d-flex align-items-center gap-2">
            <Shield className="text-primary" size={24} />
            <span>Administrator Security &amp; Master Keys</span>
          </h4>
          <p className="text-muted mb-0" style={{ fontSize: '13px' }}>
            Manage root administrator credentials, recovery email, and emergency handover keys.
          </p>
        </div>
        <button onClick={loadProfile} className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1">
          <RotateCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Alerts */}
      {errorMsg && (
        <div className="alert alert-danger py-2 px-3 small d-flex align-items-center gap-2 mb-3">
          <AlertTriangle size={16} className="flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="alert alert-success py-2 px-3 small d-flex align-items-center gap-2 mb-3">
          <CheckCircle2 size={16} className="flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      <div className="row g-4">
        {/* Left Column: Profile & Email */}
        <div className="col-12 col-lg-6">
          <div className="hg-card p-4 h-100" style={{ borderRadius: '12px' }}>
            <div className="d-flex align-items-center gap-2 mb-3">
              <User className="text-primary" size={18} />
              <h6 className="fw-bold mb-0">Administrator Identity &amp; Email</h6>
            </div>
            <p className="text-muted small mb-3">
              Update the official administrator contact email. This email receives OTPs for standard password resets.
            </p>

            <form onSubmit={handleUpdateProfile}>
              <div className="mb-3">
                <label className="form-label small fw-semibold text-dark">Administrator Username</label>
                <div className="input-group input-group-sm">
                  <span className="input-group-text bg-light"><User size={14} className="text-muted" /></span>
                  <input
                    type="text"
                    className="form-control"
                    value={editUsername}
                    onChange={(e) => setEditUsername(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="mb-3">
                <label className="form-label small fw-semibold text-dark">Registered College / Warden Email</label>
                <div className="input-group input-group-sm">
                  <span className="input-group-text bg-light"><Mail size={14} className="text-muted" /></span>
                  <input
                    type="email"
                    className="form-control"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    placeholder="e.g. chiefwarden@institution.edu"
                    required
                  />
                </div>
                {u?.email?.endsWith('@hostelguard.local') && (
                  <div className="text-danger small mt-1 d-flex align-items-center gap-1" style={{ fontSize: '11px' }}>
                    <AlertTriangle size={12} />
                    <span>Currently using placeholder email. Update to your official email to enable OTP recovery.</span>
                  </div>
                )}
              </div>

              <div className="mb-3">
                <label className="form-label small fw-semibold text-dark">Confirm With Current Password</label>
                <div className="input-group input-group-sm">
                  <span className="input-group-text bg-light"><Lock size={14} className="text-muted" /></span>
                  <input
                    type="password"
                    className="form-control"
                    placeholder="Enter current password to save"
                    value={profileCurrentPassword}
                    onChange={(e) => setProfileCurrentPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-sm d-flex align-items-center gap-1.5 px-3 py-1.5"
                disabled={updatingProfile}
              >
                {updatingProfile ? (
                  <>
                    <span className="spinner-border spinner-border-sm" role="status"></span>
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Save size={14} />
                    <span>Save Administrator Profile</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Right Column: Password Rotation */}
        <div className="col-12 col-lg-6">
          <div className="hg-card p-4 h-100" style={{ borderRadius: '12px' }}>
            <div className="d-flex align-items-center gap-2 mb-3">
              <Lock className="text-primary" size={18} />
              <h6 className="fw-bold mb-0">Rotate Administrator Password</h6>
            </div>
            <p className="text-muted small mb-3">
              Changing the administrator password immediately revokes active tokens on all other devices.
            </p>

            <form onSubmit={handlePasswordChange}>
              <div className="mb-3">
                <label className="form-label small fw-semibold text-dark">Current Password</label>
                <div className="input-group input-group-sm">
                  <span className="input-group-text bg-light"><Lock size={14} className="text-muted" /></span>
                  <input
                    type="password"
                    className="form-control"
                    placeholder="Enter current password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="mb-3">
                <label className="form-label small fw-semibold text-dark">New Password</label>
                <div className="input-group input-group-sm">
                  <span className="input-group-text bg-light"><Key size={14} className="text-muted" /></span>
                  <input
                    type="password"
                    className="form-control"
                    placeholder="Minimum 8 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="mb-3">
                <label className="form-label small fw-semibold text-dark">Confirm New Password</label>
                <div className="input-group input-group-sm">
                  <span className="input-group-text bg-light"><CheckCircle2 size={14} className="text-muted" /></span>
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

              <button
                type="submit"
                className="btn btn-outline-primary btn-sm d-flex align-items-center gap-1.5 px-3 py-1.5"
                disabled={updatingPassword}
              >
                {updatingPassword ? (
                  <>
                    <span className="spinner-border spinner-border-sm" role="status"></span>
                    <span>Updating...</span>
                  </>
                ) : (
                  <>
                    <Key size={14} />
                    <span>Update Password</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Bottom Section: Emergency Master Recovery Key */}
        <div className="col-12">
          <div className="hg-card p-4 border border-warning border-opacity-40" style={{ borderRadius: '12px', background: 'linear-gradient(180deg, #ffffff 0%, #fffdf8 100%)' }}>
            <div className="d-flex align-items-start justify-content-between flex-wrap gap-3 mb-3">
              <div>
                <div className="d-flex align-items-center gap-2 mb-1">
                  <ShieldAlert className="text-warning" size={20} />
                  <h6 className="fw-bold mb-0">Emergency Master Recovery Key (Disaster Handover System)</h6>
                  <span className="badge bg-success bg-opacity-10 text-success border border-success border-opacity-20 small">Active</span>
                </div>
                <p className="text-muted small mb-0" style={{ maxWidth: '750px' }}>
                  If wardens resign, leave without handing over credentials, or lose email access, this cryptographic Master Key restores root administrator control directly from the Login page without wiping attendance records or student face templates.
                </p>
              </div>

              <button
                type="button"
                className="btn btn-outline-warning btn-sm d-flex align-items-center gap-1 text-dark fw-semibold"
                onClick={() => {
                  setNewlyGeneratedKey('');
                  setShowRegenModal(true);
                }}
              >
                <RotateCw size={13} />
                <span>Regenerate Master Key</span>
              </button>
            </div>

            <div className="p-3 bg-light rounded-3 d-flex align-items-center justify-content-between flex-wrap gap-2">
              <div className="d-flex align-items-center gap-3">
                <div className="p-2 bg-white rounded-2 shadow-sm border">
                  <Key size={20} className="text-primary" />
                </div>
                <div>
                  <div className="fw-semibold text-dark small">Active Key Identifier: <span className="font-monospace text-primary">{rk?.hint ? `HG-MASTER-${rk.hint}` : 'Configured on Server'}</span></div>
                  <div className="text-muted" style={{ fontSize: '11px' }}>
                    Created: {rk?.createdAt ? formatDateIST(rk.createdAt) : 'Active'} • Cryptographically hashed (SHA-256 / bcrypt)
                  </div>
                </div>
              </div>

              <div className="d-flex align-items-center gap-2">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-danger d-flex align-items-center gap-1"
                  onClick={logoutAll}
                >
                  <LogOut size={13} />
                  <span>Revoke All Active Device Sessions</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Section 4: Multi-Router Wi-Fi Cluster & Multitasking Floor Gateways */}
        <div className="card border-0 shadow-sm rounded-4 overflow-hidden mt-4">
          <div className="card-header bg-white border-bottom py-3 px-4 d-flex align-items-center justify-content-between flex-wrap gap-2">
            <div className="d-flex align-items-center gap-2">
              <div className="p-2 bg-primary-subtle text-primary rounded-3">
                <Wifi size={18} />
              </div>
              <div>
                <h6 className="fw-bold mb-0 text-dark">Multi-Router Wi-Fi Cluster Gateways</h6>
                <p className="text-muted small mb-0">Floor ESP32 multitasking anchors providing local Wi-Fi verification & BLE coverage</p>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2">
              <span className={`badge ${wifiCluster?.isStrictLock ? 'bg-danger' : 'bg-primary'} px-2.5 py-1.5`}>
                Mode: {wifiCluster?.mode || 'STANDBY_OPTIONAL'}
              </span>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1"
                onClick={loadClusterStatus}
                disabled={loadingCluster}
              >
                <RefreshCw size={12} className={loadingCluster ? 'spin' : ''} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          <div className="card-body p-4">
            <div className="row g-3 mb-4">
              <div className="col-md-4">
                <div className="p-3 bg-light rounded-3 border">
                  <div className="text-muted small fw-medium">Active Floor Gateways</div>
                  <div className="h4 fw-bold mb-0 text-dark mt-1">
                    {wifiCluster?.onlineGateways ?? 0} <span className="text-muted fs-6 fw-normal">/ {wifiCluster?.totalGateways ?? 0}</span>
                  </div>
                </div>
              </div>
              <div className="col-md-4">
                <div className="p-3 bg-light rounded-3 border">
                  <div className="text-muted small fw-medium">Cluster Strict Lock</div>
                  <div className={`h5 fw-bold mb-0 mt-1 ${wifiCluster?.isStrictLock ? 'text-danger' : 'text-success'}`}>
                    {wifiCluster?.isStrictLock ? 'ENFORCED (Floor Wi-Fi / BLE Required)' : 'STANDBY (Cloud Online)'}
                  </div>
                </div>
              </div>
              <div className="col-md-4">
                <div className="p-3 bg-light rounded-3 border">
                  <div className="text-muted small fw-medium">Known WAN Subnets</div>
                  <div className="h6 fw-semibold mb-0 text-dark mt-1 font-monospace">
                    {wifiCluster?.clusterWanIps?.length ? wifiCluster.clusterWanIps.join(', ') : 'Dynamic (Render Cloud)'}
                  </div>
                </div>
              </div>
            </div>

            {wifiCluster?.gateways && wifiCluster.gateways.length > 0 ? (
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0" style={{ fontSize: '13px' }}>
                  <thead className="table-light">
                    <tr>
                      <th>Beacon ID</th>
                      <th>Floor</th>
                      <th>Router SSID</th>
                      <th>Local Gateway IP</th>
                      <th>Status</th>
                      <th>Last Heartbeat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wifiCluster.gateways.map((gw) => (
                      <tr key={gw.beaconId}>
                        <td>
                          <div className="d-flex align-items-center gap-2">
                            <Radio size={14} className="text-primary" />
                            <span className="fw-semibold font-monospace">{gw.beaconId}</span>
                            <span className="badge bg-secondary-subtle text-secondary" style={{ fontSize: '10px' }}>{gw.shortName}</span>
                          </div>
                        </td>
                        <td>Floor {gw.floor}</td>
                        <td><span className="fw-medium text-dark">{gw.ssid}</span></td>
                        <td><code className="text-primary">{gw.localIp}</code></td>
                        <td>
                          <span className={`badge ${gw.status === 'ONLINE' ? 'bg-success' : 'bg-secondary'}`}>
                            {gw.status}
                          </span>
                        </td>
                        <td className="text-muted">{gw.lastSeenSecondsAgo}s ago</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="alert alert-light border d-flex align-items-center gap-3 py-3 px-4 mb-0">
                <Info size={24} className="text-primary flex-shrink-0" />
                <div className="small text-muted">
                  <strong className="text-dark">Zero-Cost Setup:</strong> Flash floor ESP32 boards with <code>hardware/HostelGuard_Beacon.ino</code>.
                  Each board connects to its floor router and automatically registers live in this cluster table every 60 seconds.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal: Regenerate Master Recovery Key */}
      {showRegenModal && (
        <div
          className="modal fade show d-block hg-modal-backdrop"
          tabIndex="-1"
          style={{ zIndex: 1050 }}
        >
          <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: '480px' }}>
            <div className="modal-content hg-card border-0 shadow-lg rounded-2 overflow-hidden">
              <div className="modal-header bg-dark text-white py-2.5 px-3">
                <h6 className="modal-title fw-bold text-white mb-0 d-flex align-items-center gap-2">
                  <Key size={18} className="text-warning" />
                  <span>Regenerate Master Recovery Key</span>
                </h6>
                <button
                  type="button"
                  className="btn-close btn-close-white"
                  onClick={() => setShowRegenModal(false)}
                ></button>
              </div>

              <div className="modal-body p-4">
                {newlyGeneratedKey ? (
                  <div>
                    <div className="alert alert-success d-flex align-items-center gap-2 py-2 px-3 small mb-3">
                      <CheckCircle2 size={16} />
                      <span>New Master Key generated! The old key has been invalidated.</span>
                    </div>

                    <label className="form-label small fw-semibold text-dark">Save Your New Master Key:</label>
                    <div className="input-group mb-3">
                      <input
                        type="text"
                        className="form-control font-monospace fw-bold text-primary bg-light"
                        value={newlyGeneratedKey}
                        readOnly
                        style={{ letterSpacing: '1px' }}
                      />
                      <button
                        className={`btn ${copiedKey ? 'btn-success' : 'btn-outline-primary'} d-flex align-items-center gap-1`}
                        onClick={handleCopyKey}
                        type="button"
                      >
                        {copiedKey ? <Check size={14} /> : <Copy size={14} />}
                        <span>{copiedKey ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>

                    <p className="text-muted small mb-3">
                      Print or write down this key and store it in an institution safe.
                    </p>

                    <button
                      type="button"
                      className="btn btn-primary w-100 py-2 fw-semibold"
                      onClick={() => setShowRegenModal(false)}
                    >
                      I Have Stored This Key Safely
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleRegenerateMasterKey}>
                    <p className="text-muted small mb-3">
                      Regenerating a new Master Recovery Key will <strong>immediately deactivate</strong> any previously issued key. Please confirm with your current administrator password:
                    </p>

                    <div className="mb-3">
                      <label className="form-label small fw-semibold text-dark">Administrator Password</label>
                      <input
                        type="password"
                        className="form-control form-control-sm"
                        placeholder="Enter current password"
                        value={regenCurrentPassword}
                        onChange={(e) => setRegenCurrentPassword(e.target.value)}
                        required
                      />
                    </div>

                    <div className="d-flex justify-content-end gap-2 mt-4">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => setShowRegenModal(false)}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn btn-sm btn-warning text-dark fw-semibold"
                        disabled={regeneratingKey}
                      >
                        {regeneratingKey ? 'Regenerating...' : 'Generate New Key'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
