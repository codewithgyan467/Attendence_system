import React, { createContext, useContext, useState, useEffect } from 'react';
import { api, authStorage } from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const initialUser = authStorage.getUser();
  const initialToken = authStorage.getToken();

  const [user, setUser] = useState(initialUser);
  const [token, setToken] = useState(initialToken);
  // Instant App Opening: If we already have stored user credentials, DO NOT block the UI.
  // Only wait if there is a raw token without a stored user profile.
  const [loading, setLoading] = useState(Boolean(initialToken && !initialUser));

  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      setToken(null);
      authStorage.clearToken();
      authStorage.clearRefreshToken();
      authStorage.clearUser();
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);

    // Revalidate stored token with server in the background (stale-while-revalidate)
    if (token) {
      api.auth.getMe()
        .then((res) => {
          if (res?.user) {
            setUser(res.user);
            authStorage.setUser(res.user);
          }
        })
        .catch((err) => {
          const errMsg = (err?.message || '').toLowerCase();
          // Only clear session if token was rejected by server (401 / unauthorized / forbidden / invalid)
          if (
            errMsg.includes('401') ||
            errMsg.includes('unauthorized') ||
            errMsg.includes('forbidden') ||
            errMsg.includes('token expired') ||
            errMsg.includes('invalid token')
          ) {
            handleUnauthorized();
          } else {
            // Temporary network glitch or Render free-tier waking up: keep cached session alive
            console.warn('[Auth] Server revalidation deferred:', err.message);
          }
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      setLoading(false);
    }

    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  const login = async (username, password) => {
    const res = await api.auth.login({ username, password });
    if ((res.accessToken || res.token) && res.user) {
      const access = res.accessToken || res.token;
      authStorage.setToken(access);
      if (res.refreshToken) {
        authStorage.setRefreshToken(res.refreshToken);
      }
      authStorage.setUser(res.user);
      setToken(access);
      setUser(res.user);
      return res.user;
    }
    throw new Error(res?.error || res?.message || 'Authentication failed: Server returned an invalid response.');
  };

  const logout = async () => {
    try {
      const rt = authStorage.getRefreshToken();
      await api.auth.logout({ refreshToken: rt });
    } catch (_) {}
    authStorage.clearToken();
    authStorage.clearRefreshToken();
    authStorage.clearUser();
    setToken(null);
    setUser(null);
  };

  const logoutAll = async () => {
    try {
      await api.auth.logoutAll();
    } catch (_) {}
    authStorage.clearToken();
    authStorage.clearRefreshToken();
    authStorage.clearUser();
    setToken(null);
    setUser(null);
  };

  const changePassword = async (currentPassword, newPassword) => {
    return await api.auth.changePassword({ current_password: currentPassword, new_password: newPassword });
  };

  const setAuthenticatedStudent = (userObj, tokenStr) => {
    authStorage.setToken(tokenStr);
    authStorage.setUser(userObj);
    setToken(tokenStr);
    setUser(userObj);
  };

  const loginWithPhone = async (userJsonUrl) => {
    const res = await api.auth.phoneEmailLogin({ user_json_url: userJsonUrl });
    if ((res.accessToken || res.token) && res.user) {
      const access = res.accessToken || res.token;
      authStorage.setToken(access);
      if (res.refreshToken) {
        authStorage.setRefreshToken(res.refreshToken);
      }
      authStorage.setUser(res.user);
      setToken(access);
      setUser(res.user);
      return res;
    }
    throw new Error('Phone authentication failed');
  };

  const loginWithOtp = async (identifier, otp) => {
    const res = await api.auth.verifyLoginOtp({ identifier, otp });
    if ((res.accessToken || res.token) && res.user) {
      const access = res.accessToken || res.token;
      authStorage.setToken(access);
      if (res.refreshToken) {
        authStorage.setRefreshToken(res.refreshToken);
      }
      authStorage.setUser(res.user);
      setToken(access);
      setUser(res.user);
      return res;
    }
    throw new Error('OTP verification failed');
  };

  const loginWithGoogle = async (credentialOrPayload) => {
    const payload = typeof credentialOrPayload === 'string'
      ? { credential: credentialOrPayload }
      : credentialOrPayload;

    const res = await api.auth.googleLogin(payload);
    if ((res.accessToken || res.token) && res.user) {
      const access = res.accessToken || res.token;
      authStorage.setToken(access);
      if (res.refreshToken) {
        authStorage.setRefreshToken(res.refreshToken);
      }
      authStorage.setUser(res.user);
      setToken(access);
      setUser(res.user);
      return res;
    }
    throw new Error('Google authentication failed');
  };

  const value = {
    user,
    token,
    role: user?.role || null,
    isAuthenticated: Boolean(user && token),
    loading,
    login,
    loginWithPhone,
    loginWithOtp,
    loginWithGoogle,
    logout,
    logoutAll,
    changePassword,
    setAuthenticatedStudent
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
