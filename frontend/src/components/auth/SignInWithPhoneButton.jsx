import React, { useEffect, useRef } from 'react';

export default function SignInWithPhoneButton({
  onSuccess,
  onError,
  clientId = import.meta.env.VITE_PHONE_EMAIL_CLIENT_ID || '18664955320259466526',
  className = ''
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Load Phone.Email external script
    const script = document.createElement('script');
    script.src = 'https://www.phone.email/sign_in_button_v1.js';
    script.async = true;
    container.appendChild(script);

    // Define listener function for Phone.Email callback
    window.phoneEmailListener = function (userObj) {
      if (!userObj || !userObj.user_json_url) {
        if (onError) onError('Phone verification failed: invalid response from Phone.Email');
        return;
      }

      if (onSuccess) {
        onSuccess(userObj.user_json_url, userObj);
      }
    };

    return () => {
      window.phoneEmailListener = null;
      if (container && script.parentNode === container) {
        container.removeChild(script);
      }
    };
  }, [clientId, onSuccess, onError]);

  return (
    <div className={`phone-email-signin-wrapper ${className}`} style={{ minHeight: '44px' }}>
      <div
        ref={containerRef}
        className="pe_signin_button"
        data-client-id={clientId}
      ></div>
    </div>
  );
}
