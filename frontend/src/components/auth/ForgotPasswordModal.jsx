import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../utils/api';
import {
  Shield,
  Mail,
  Smartphone,
  KeyRound,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Eye,
  EyeOff,
  Clock,
  Sparkles,
  Lock,
  ExternalLink,
  Zap,
  Check,
  X
} from 'lucide-react';

export default function ForgotPasswordModal({
  isOpen,
  onClose,
  onPasswordResetSuccess,
  initialRollNumber = '',
  initialToken = null
}) {
  const [step, setStep] = useState(initialToken ? 3 : 1); // 1: Request, 2: OTP/Verify, 3: New Password, 4: Success
  const [identifier, setIdentifier] = useState(initialRollNumber);
  const [method, setMethod] = useState('EMAIL'); // 'EMAIL' or 'PHONE'
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successInfo, setSuccessInfo] = useState(null);
  const [resetToken, setResetToken] = useState(initialToken);
  const [resolvedUsername, setResolvedUsername] = useState('');

  // Resend countdown timer
  const [countdown, setCountdown] = useState(0);

  // Phone.Email Client ID (can be configured in admin dashboard or defaults to official public demo ID)
  const phoneEmailClientId = import.meta.env.VITE_PHONE_EMAIL_CLIENT_ID || '18080824987747806509';
  const phoneEmailContainerRef = useRef(null);

  useEffect(() => {
    if (initialRollNumber) {
      setIdentifier(initialRollNumber);
    }
  }, [initialRollNumber]);

  useEffect(() => {
    if (initialToken) {
      setResetToken(initialToken);
      setStep(3);
    }
  }, [initialToken]);

  useEffect(() => {
    let timer;
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [countdown]);

  // Set up Phone.Email Global Listener when on Step 2 with Phone method
  useEffect(() => {
    if (!isOpen || step !== 2 || method !== 'PHONE') return;

    window.phoneEmailListener = async function (userObj) {
      console.log('Phone.Email callback triggered:', userObj);
      if (!userObj || !userObj.user_json_url) {
        setErrorMsg('Phone.Email returned invalid verification response.');
        return;
      }

      setLoading(true);
      setErrorMsg('');

      try {
        const res = await api.auth.verifyPhoneEmail({
          user_json_url: userObj.user_json_url,
          identifier: resolvedUsername || identifier.trim()
        });

        if (res.success) {
          setResetToken(res.resetToken);
          setResolvedUsername(res.identifier || identifier.trim());
          setStep(3);
        }
      } catch (err) {
        setErrorMsg(err.message || 'Phone.Email verification failed.');
      } finally {
        setLoading(false);
      }
    };

    // Inject Phone.Email automated script
    const scriptId = 'phone-email-script';
    let script = document.getElementById(scriptId);
    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://auth.phone.email/login_automated_v1_3.js';
      script.async = true;
      document.body.appendChild(script);
    }

    return () => {
      delete window.phoneEmailListener;
    };
  }, [isOpen, step, method, resolvedUsername, identifier]);

  if (!isOpen) return null;

  // Step 1: Request Verification / Send Code
  const handleRequestOtp = async (e) => {
    e?.preventDefault();
    if (!identifier.trim()) {
      setErrorMsg('Please enter your Roll Number, registered Email, or Phone number.');
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      const res = await api.auth.requestPasswordResetOtp({
        identifier: identifier.trim(),
        method
      });

      if (res.success) {
        setSuccessInfo(res);
        setResolvedUsername(res.identifier || identifier.trim());
        setStep(2);
        setCountdown(60); // 60s cooldown for resend
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to dispatch reset verification. Please check your details.');
    } finally {
      setLoading(false);
    }
  };

  // Step 2A: Verify 6-Digit OTP Code
  const handleVerifyOtp = async (e) => {
    e?.preventDefault();
    if (!otp.trim() || otp.trim().length !== 6) {
      setErrorMsg('Please enter the full 6-digit verification code.');
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      const res = await api.auth.verifyPasswordResetOtp({
        identifier: resolvedUsername || identifier.trim(),
        otp: otp.trim()
      });

      if (res.success) {
        setResetToken(res.resetToken);
        setStep(3);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Invalid or expired OTP code.');
    } finally {
      setLoading(false);
    }
  };

  // Step 2B: 1-Click Magic Link Instant Verification (Email Authentication Model)
  const handleActivateMagicLink = async () => {
    if (!successInfo?.magicLinkUrl) return;

    // Extract token from magicLinkUrl
    try {
      const url = new URL(successInfo.magicLinkUrl);
      const token = url.searchParams.get('token');
      if (!token) throw new Error('Missing token in magic link.');

      setLoading(true);
      setErrorMsg('');

      const res = await api.auth.verifyMagicLink(token);
      if (res.success) {
        setResetToken(res.resetToken);
        setStep(3);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to verify magic link token.');
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Complete Reset with New Password
  const handleResetPassword = async (e) => {
    e?.preventDefault();
    if (!newPassword || newPassword.length < 8) {
      setErrorMsg('New password must be at least 8 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      const res = await api.auth.resetPasswordWithOtp({
        resetToken,
        identifier: resolvedUsername || identifier.trim(),
        otp: otp.trim(),
        new_password: newPassword,
        confirm_password: confirmPassword
      });

      if (res.success) {
        setStep(4);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to update password.');
    } finally {
      setLoading(false);
    }
  };

  // Resend OTP handler
  const handleResendOtp = async () => {
    if (countdown > 0 || loading) return;
    setOtp('');
    setErrorMsg('');
    await handleRequestOtp();
  };

  return (
    <div
      className="modal show d-block"
      style={{ backgroundColor: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)', zIndex: 1060 }}
    >
      <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: '500px' }}>
        <div className="modal-content border-0 shadow-2xl rounded-4 overflow-hidden">
          {/* Header */}
          <div
            className="p-4 text-white position-relative"
            style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)' }}
          >
            <button
              type="button"
              className="btn-close btn-close-white position-absolute top-0 end-0 m-3"
              onClick={onClose}
              aria-label="Close"
            ></button>
            <div className="d-flex align-items-center gap-3">
              <div
                className="p-2 rounded-circle bg-primary bg-opacity-25 text-primary border border-primary border-opacity-25"
                style={{ width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <KeyRound size={24} />
              </div>
              <div>
                <h5 className="fw-bold mb-0 text-white">Student Password Recovery</h5>
                <span className="text-muted small">
                  {step === 1 && 'Choose Phone.Email or Email Authentication'}
                  {step === 2 && (method === 'PHONE' ? 'Verify via Phone.Email OTP' : 'Verify via Email OTP')}
                  {step === 3 && 'Create new secure password'}
                  {step === 4 && 'Password successfully updated'}
                </span>
              </div>
            </div>

            {/* Stepper Dots */}
            <div className="d-flex align-items-center justify-content-between mt-3 pt-2 border-top border-secondary border-opacity-25">
              {[1, 2, 3].map((num) => (
                <div key={num} className="d-flex align-items-center flex-grow-1">
                  <div
                    className={`rounded-circle d-flex align-items-center justify-content-center fw-bold small ${
                      step === num
                        ? 'bg-primary text-white'
                        : step > num
                        ? 'bg-success text-white'
                        : 'bg-secondary bg-opacity-25 text-muted'
                    }`}
                    style={{ width: '24px', height: '24px', fontSize: '11px' }}
                  >
                    {step > num ? '✓' : num}
                  </div>
                  {num < 3 && (
                    <div
                      className={`flex-grow-1 mx-2 ${
                        step > num ? 'bg-success' : 'bg-secondary bg-opacity-25'
                      }`}
                      style={{ height: '2px' }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="modal-body p-4">
            {errorMsg && (
              <div className="alert alert-danger d-flex align-items-center gap-2 py-2 px-3 small mb-3 rounded-3" role="alert">
                <AlertTriangle size={16} className="flex-shrink-0" />
                <div style={{ wordBreak: 'break-word' }}>{errorMsg}</div>
              </div>
            )}

            {/* STEP 1: SELECT CHANNEL & IDENTIFIER */}
            {step === 1 && (
              <form onSubmit={handleRequestOtp}>
                <div className="mb-3">
                  <label className="form-label small fw-semibold text-dark">
                    Student Roll Number, Email, or Mobile
                  </label>
                  <input
                    type="text"
                    className="form-control form-control-lg rounded-3 fs-6"
                    placeholder="e.g. 2024CS001 or student@hostel.local"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    disabled={loading}
                    autoFocus
                  />
                  <div className="form-text small" style={{ fontSize: '11px' }}>
                    Enter your official university Roll Number or registered Email Address.
                  </div>
                </div>

                <label className="form-label small fw-semibold text-dark mb-2">
                  Select Authentication Model
                </label>
                <div className="row g-2 mb-4">
                  {/* Option 1: Phone.Email */}
                  <div className="col-6">
                    <div
                      onClick={() => setMethod('PHONE')}
                      className={`card p-3 text-center cursor-pointer border rounded-3 h-100 transition-all ${
                        method === 'PHONE'
                          ? 'border-primary bg-primary bg-opacity-10 text-primary shadow-sm'
                          : 'border-light-subtle bg-light text-muted'
                      }`}
                      style={{ cursor: 'pointer' }}
                    >
                      <Smartphone size={24} className="mx-auto mb-1 text-primary" />
                      <div className="fw-semibold small">Phone.Email (Free)</div>
                      <div className="small text-muted" style={{ fontSize: '10px' }}>
                        Open-source Phone OTP
                      </div>
                      <span className="badge bg-primary bg-opacity-25 text-primary mt-1" style={{ fontSize: '9px' }}>
                        phone.email SDK
                      </span>
                    </div>
                  </div>

                  {/* Option 2: Email Authentication Model */}
                  <div className="col-6">
                    <div
                      onClick={() => setMethod('EMAIL')}
                      className={`card p-3 text-center cursor-pointer border rounded-3 h-100 transition-all ${
                        method === 'EMAIL'
                          ? 'border-primary bg-primary bg-opacity-10 text-primary shadow-sm'
                          : 'border-light-subtle bg-light text-muted'
                      }`}
                      style={{ cursor: 'pointer' }}
                    >
                      <Mail size={24} className="mx-auto mb-1 text-primary" />
                      <div className="fw-semibold small">Email Auth Model</div>
                      <div className="small text-muted" style={{ fontSize: '10px' }}>
                        OTP & Magic Link
                      </div>
                      <span className="badge bg-success bg-opacity-25 text-success mt-1" style={{ fontSize: '9px' }}>
                        Dual-Mode
                      </span>
                    </div>
                  </div>
                </div>

                <div className="d-flex align-items-center justify-content-between pt-2">
                  <button type="button" className="btn btn-outline-secondary btn-sm px-3" onClick={onClose}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary d-inline-flex align-items-center gap-2 fw-semibold px-4"
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <span className="spinner-border spinner-border-sm" role="status"></span>
                        Connecting...
                      </>
                    ) : (
                      <>
                        <span>Continue to Verify</span>
                        <ArrowRight size={16} />
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* STEP 2: VERIFICATION (PHONE.EMAIL OR EMAIL MODEL) */}
            {step === 2 && (
              <div>
                {/* METHOD A: PHONE.EMAIL VERIFICATION */}
                {method === 'PHONE' ? (
                  <div>
                    <div className="text-center mb-3">
                      <span className="badge bg-primary bg-opacity-10 text-primary p-2 mb-2 font-mono" style={{ fontSize: '12px' }}>
                        📱 Phone.Email Free Verification
                      </span>
                      <p className="text-muted small mb-1">
                        Verifying phone for <strong className="text-dark">{resolvedUsername || identifier}</strong>.
                      </p>
                      <div className="small text-muted" style={{ fontSize: '11px' }}>
                        Click the button below to verify via Phone.Email's secure SMS OTP dialog:
                      </div>
                    </div>

                    {/* Official Phone.Email Widget Container */}
                    <div className="p-4 bg-light rounded-3 text-center mb-4 border">
                      <div
                        id="phone-email-widget-container"
                        className="pe_signin_button d-inline-block"
                        data-client-id={phoneEmailClientId}
                        ref={phoneEmailContainerRef}
                      >
                        <button
                          type="button"
                          className="btn btn-dark d-inline-flex align-items-center gap-2 py-2 px-3 fw-semibold shadow-sm"
                          onClick={() => {
                            if (window.phoneEmailListener) {
                              const btn = document.querySelector('.pe_signin_button button');
                              if (btn) btn.click();
                            }
                          }}
                        >
                          <Smartphone size={16} className="text-warning" />
                          <span>Verify with Phone.Email (SMS / WhatsApp)</span>
                        </button>
                      </div>
                      <div className="mt-2 text-muted" style={{ fontSize: '11px' }}>
                        Secured by Phone.Email Free Global Verification Service
                      </div>
                    </div>

                    <div className="d-flex align-items-center justify-content-between pt-2">
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-1"
                        onClick={() => {
                          setStep(1);
                          setErrorMsg('');
                        }}
                      >
                        <ArrowLeft size={14} /> Back
                      </button>
                    </div>
                  </div>
                ) : (
                  /* METHOD B: EMAIL AUTHENTICATION MODEL (OTP + MAGIC LINK) */
                  <form onSubmit={handleVerifyOtp}>
                    <div className="text-center mb-3">
                      <div className="badge bg-light text-dark p-2 mb-2 font-mono" style={{ fontSize: '12px' }}>
                        📧 Email Auth sent to: <strong>{successInfo?.maskedDestination || identifier}</strong>
                      </div>
                      <p className="text-muted small mb-0">
                        Check your inbox for the 6-digit verification code.
                      </p>
                    </div>

                    {/* Standard 6-Digit OTP Input */}
                    <div className="mb-4">
                      <label className="form-label small fw-semibold text-dark text-center d-block">
                        Or Enter 6-Digit Verification Code
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        className="form-control form-control-lg text-center font-mono fw-bold fs-3 letter-spacing-lg"
                        style={{ letterSpacing: '8px' }}
                        placeholder="000000"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                        required
                        disabled={loading}
                        autoFocus
                      />
                      <div className="d-flex align-items-center justify-content-between mt-2">
                        <span className="text-muted small d-inline-flex align-items-center gap-1" style={{ fontSize: '11px' }}>
                          <Clock size={12} /> Code expires in 10 mins
                        </span>
                        <button
                          type="button"
                          className="btn btn-link btn-sm text-decoration-none p-0"
                          style={{ fontSize: '12px' }}
                          onClick={handleResendOtp}
                          disabled={countdown > 0 || loading}
                        >
                          {countdown > 0 ? `Resend in ${countdown}s` : 'Resend Code'}
                        </button>
                      </div>
                    </div>

                    <div className="d-flex align-items-center justify-content-between pt-2">
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-1"
                        onClick={() => {
                          setStep(1);
                          setErrorMsg('');
                        }}
                      >
                        <ArrowLeft size={14} /> Back
                      </button>
                      <button
                        type="submit"
                        className="btn btn-primary d-inline-flex align-items-center gap-2 fw-semibold px-4"
                        disabled={loading || otp.length !== 6}
                      >
                        {loading ? (
                          <>
                            <span className="spinner-border spinner-border-sm" role="status"></span>
                            Verifying...
                          </>
                        ) : (
                          <>
                            <span>Verify Code</span>
                            <ArrowRight size={16} />
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {/* STEP 3: CREATE NEW PASSWORD */}
            {step === 3 && (
              <form onSubmit={handleResetPassword}>
                <div className="alert alert-success py-2 px-3 small d-flex align-items-center gap-2 mb-3 rounded-3">
                  <Check size={16} className="text-success flex-shrink-0" />
                  <div>
                    Identity verified for <strong className="font-mono">{resolvedUsername || identifier}</strong>. Enter your new password below.
                  </div>
                </div>

                <div className="mb-3">
                  <label className="form-label small fw-semibold text-dark">New Password</label>
                  <div className="input-group">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className="form-control rounded-start-3"
                      placeholder="At least 8 characters"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      minLength={8}
                      disabled={loading}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="mb-4">
                  <label className="form-label small fw-semibold text-dark">Confirm New Password</label>
                  <div className="input-group">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      className="form-control rounded-start-3"
                      placeholder="Re-enter new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      minLength={8}
                      disabled={loading}
                    />
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    >
                      {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {newPassword && confirmPassword && (
                    <div className="mt-1" style={{ fontSize: '11px' }}>
                      {newPassword === confirmPassword ? (
                        <span className="text-success fw-semibold">✓ Passwords match</span>
                      ) : (
                        <span className="text-danger fw-semibold">✗ Passwords do not match</span>
                      )}
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  className="btn btn-success w-100 py-2 d-flex align-items-center justify-content-center gap-2 fw-semibold"
                  disabled={loading || newPassword.length < 8 || newPassword !== confirmPassword}
                >
                  {loading ? (
                    <>
                      <span className="spinner-border spinner-border-sm" role="status"></span>
                      Updating Password...
                    </>
                  ) : (
                    <>
                      <Lock size={16} />
                      <span>Save New Password</span>
                    </>
                  )}
                </button>
              </form>
            )}

            {/* STEP 4: SUCCESS */}
            {step === 4 && (
              <div className="text-center py-3">
                <div
                  className="rounded-circle bg-success bg-opacity-10 text-success p-3 mx-auto mb-3"
                  style={{ width: '64px', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <CheckCircle2 size={36} />
                </div>
                <h5 className="fw-bold text-dark mb-1">Password Reset Successful!</h5>
                <p className="text-muted small mb-4">
                  Your account password for <strong className="font-mono text-primary">{resolvedUsername || identifier}</strong> has been updated. You can now log into HostelGuard with your new password.
                </p>

                <button
                  type="button"
                  className="btn btn-primary w-100 py-2 fw-semibold d-inline-flex align-items-center justify-content-center gap-2"
                  onClick={() => {
                    onClose();
                    if (onPasswordResetSuccess) {
                      onPasswordResetSuccess(resolvedUsername || identifier);
                    }
                  }}
                >
                  <span>Return to Sign In</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
