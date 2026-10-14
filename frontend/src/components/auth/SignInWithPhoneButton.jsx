import React, { useEffect, useRef } from 'react';

export default function SignInWithPhoneButton({
  onSuccess,
  onError,
  clientId = import.meta.env.VITE_PHONE_EMAIL_CLIENT_ID || '18664955320259466526',
  className = '',
  mode = 'phone' // 'phone' | 'email'
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clear previous children/buttons to prevent duplicate injections on re-render
    container.innerHTML = '';

    // Load appropriate Phone.Email external script as documented by Phone.Email
    const script = document.createElement('script');
    script.src = mode === 'email'
      ? 'https://www.phone.email/verify_email_v1.js'
      : 'https://www.phone.email/sign_in_button_v1.js';
    script.async = true;
    container.appendChild(script);

    // Common handler for both phoneEmailListener and phoneEmailReceiver
    const handleSuccess = function (userObj) {
      if (!userObj || !userObj.user_json_url) {
        if (onError) onError(`${mode === 'email' ? 'Email' : 'Phone'} verification failed: invalid response from Phone.Email`);
        return;
      }
      if (onSuccess) {
        onSuccess(userObj.user_json_url, userObj);
      }
    };

    // Register global listener callbacks for Phone.Email
    window.phoneEmailListener = handleSuccess;
    window.phoneEmailReceiver = handleSuccess;

    return () => {
      window.phoneEmailListener = null;
      window.phoneEmailReceiver = null;
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [clientId, mode, onSuccess, onError]);

  return (
    <div className={`phone-email-signin-wrapper ${className}`} style={{ minHeight: '44px' }}>
      <div
        ref={containerRef}
        className={mode === 'email' ? 'pe_verify_email' : 'pe_signin_button'}
        data-client-id={clientId}
      ></div>
    </div>
  );
}
