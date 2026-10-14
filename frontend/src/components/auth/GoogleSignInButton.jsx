import React, { useEffect, useRef, useState } from 'react';

export default function GoogleSignInButton({
  onSuccess,
  onError,
  clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
  className = '',
  disabled = false
}) {
  const gsiBtnRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [gsiLoaded, setGsiLoaded] = useState(false);
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [demoEmail, setDemoEmail] = useState('');

  // 1. Initialize Google Identity Services (GSI) if client ID is configured
  useEffect(() => {
    if (!clientId) return;

    const loadGsiScript = () => {
      if (window.google?.accounts?.id) {
        initGsi();
        return;
      }

      const existingScript = document.getElementById('google-gsi-client');
      if (existingScript) {
        existingScript.addEventListener('load', initGsi);
        return;
      }

      const script = document.createElement('script');
      script.id = 'google-gsi-client';
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = initGsi;
      script.onerror = () => {
        console.warn('Google Identity Services script failed to load.');
      };
      document.body.appendChild(script);
    };

    const initGsi = () => {
      try {
        if (!window.google?.accounts?.id) return;

        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            if (response?.credential) {
              setLoading(true);
              if (onSuccess) {
                Promise.resolve(onSuccess(response.credential))
                  .catch((err) => {
                    if (onError) onError(err?.message || 'Google authentication failed.');
                  })
                  .finally(() => setLoading(false));
              }
            } else if (onError) {
              onError('No Google credential returned.');
            }
          },
          auto_select: false,
          cancel_on_tap_outside: true
        });

        if (gsiBtnRef.current) {
          gsiBtnRef.current.innerHTML = '';
          window.google.accounts.id.renderButton(gsiBtnRef.current, {
            theme: 'outline',
            size: 'large',
            type: 'standard',
            text: 'continue_with',
            shape: 'rectangular',
            logo_alignment: 'left',
            width: 350
          });
          setGsiLoaded(true);
        }
      } catch (err) {
        console.warn('Error initializing Google Sign-In:', err);
      }
    };

    loadGsiScript();
  }, [clientId, onSuccess, onError]);

  const handleCustomButtonClick = () => {
    if (disabled || loading) return;

    if (clientId && window.google?.accounts?.id) {
      try {
        window.google.accounts.id.prompt();
        return;
      } catch (err) {
        console.warn('Prompt error:', err);
      }
    }

    // If client ID is not configured in .env yet, show simulated Google Login dialog
    setShowDemoModal(true);
  };

  const handleDemoSubmit = (e) => {
    e.preventDefault();
    if (!demoEmail.trim()) return;

    setLoading(true);
    setShowDemoModal(false);

    if (onSuccess) {
      Promise.resolve(onSuccess(`demo:${demoEmail.trim()}`))
        .catch((err) => {
          if (onError) onError(err?.message || 'Authentication failed.');
        })
        .finally(() => setLoading(false));
    }
  };

  return (
    <div className={`google-auth-container w-100 ${className}`}>
      {/* Hidden GSI container if Google renders native iframe button */}
      {clientId && (
        <div
          ref={gsiBtnRef}
          className={`d-flex justify-content-center ${gsiLoaded ? 'mb-1' : 'd-none'}`}
          style={{ minHeight: '44px' }}
        />
      )}

      {/* Styled Modern Google Button */}
      {(!clientId || !gsiLoaded) && (
        <button
          type="button"
          onClick={handleCustomButtonClick}
          disabled={disabled || loading}
          className="btn btn-white w-100 py-2 border shadow-sm rounded-3 d-flex align-items-center justify-content-center gap-3 bg-white text-dark fw-medium"
          style={{
            borderColor: '#dadce0',
            transition: 'all 0.2s ease',
            height: '44px'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8f9fa')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#ffffff')}
        >
          {loading ? (
            <span className="spinner-border spinner-border-sm text-primary" role="status" />
          ) : (
            <svg width="18" height="18" viewBox="0 0 48 48">
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.79l7.97-6.2z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
              <path fill="none" d="M0 0h48v48H0z" />
            </svg>
          )}
          <span style={{ fontSize: '14px', letterSpacing: '0.2px' }}>
            {loading ? 'Authenticating with Google...' : 'Continue with Google'}
          </span>
        </button>
      )}

      {/* Development / Demo Quick Connect Modal */}
      {showDemoModal && (
        <div
          className="modal fade show d-block"
          style={{ backgroundColor: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(3px)', zIndex: 1060 }}
        >
          <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: '400px' }}>
            <div className="modal-content border-0 shadow-lg rounded-4">
              <div className="modal-header border-0 pb-0">
                <div className="d-flex align-items-center gap-2">
                  <svg width="22" height="22" viewBox="0 0 48 48">
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.79l7.97-6.2z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                  </svg>
                  <h6 className="modal-title fw-bold text-dark">Google Authentication</h6>
                </div>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setShowDemoModal(false)}
                />
              </div>
              <div className="modal-body p-4">
                <p className="text-muted small mb-3">
                  Sign in instantly using your Google account email registered in the hostel system:
                </p>

                <form onSubmit={handleDemoSubmit}>
                  <div className="mb-3">
                    <label className="form-label small fw-medium text-dark">Google Email Address</label>
                    <input
                      type="email"
                      className="form-control"
                      placeholder="e.g. aarav.sharma@student.hostel.local"
                      value={demoEmail}
                      onChange={(e) => setDemoEmail(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>

                  <div className="d-flex flex-column gap-2 mb-3">
                    <span className="text-muted small" style={{ fontSize: '11px' }}>
                      Or select a test student account:
                    </span>
                    <div className="d-flex flex-wrap gap-1">
                      <button
                        type="button"
                        className="btn btn-sm btn-light border py-1 px-2 text-primary small"
                        style={{ fontSize: '11px' }}
                        onClick={() => setDemoEmail('aarav.sharma@student.hostel.local')}
                      >
                        Aarav Sharma
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-light border py-1 px-2 text-primary small"
                        style={{ fontSize: '11px' }}
                        onClick={() => setDemoEmail('ananya.patel@student.hostel.local')}
                      >
                        Ananya Patel
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-light border py-1 px-2 text-primary small"
                        style={{ fontSize: '11px' }}
                        onClick={() => setDemoEmail('admin@hostel.local')}
                      >
                        Admin
                      </button>
                    </div>
                  </div>

                  <div className="d-flex justify-content-end gap-2 pt-2 border-top">
                    <button
                      type="button"
                      className="btn btn-sm btn-light"
                      onClick={() => setShowDemoModal(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn btn-sm btn-primary px-3 fw-semibold"
                    >
                      Sign In with Google
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
