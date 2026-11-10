import { Capacitor } from '@capacitor/core';

// Dynamically determine the API base URL:
// - Browser environments use relative '/api/v1' via Vite proxy or reverse proxy (works on localhost, LAN IP, and domain)
// - Native Mobile (Capacitor) uses deployed backend or custom url
// - Physical phone or custom network can set localStorage 'hg_backend_url'
export const getActiveBleMode = () => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('hg_ble_mode') || 'STANDBY';
  }
  return 'STANDBY';
};

export const setActiveBleMode = (mode) => {
  if (typeof window !== 'undefined') {
    if (!mode) localStorage.removeItem('hg_ble_mode');
    else localStorage.setItem('hg_ble_mode', mode);
  }
};

export const getLocalWardenUrl = () => {
  if (typeof window !== 'undefined') {
    const url = localStorage.getItem('hg_local_warden_url');
    const isMobile = Capacitor.isNativePlatform() || (typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || ''));
    // On mobile devices / Capacitor, 'localhost' is the phone's internal WebView, never the Warden's PC
    if (url && (isMobile || window.location.protocol === 'https:') && (url.includes('localhost') || url.includes('127.0.0.1'))) {
      localStorage.removeItem('hg_local_warden_url');
      return null;
    }
    return url || null;
  }
  return null;
};

export const setLocalWardenUrl = (url) => {
  if (typeof window !== 'undefined') {
    if (!url) {
      localStorage.removeItem('hg_local_warden_url');
      return;
    }
    const clean = url.replace(/\/+$/, '');
    const isMobile = Capacitor.isNativePlatform() || (typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || ''));
    if ((isMobile || window.location.protocol === 'https:') && (clean.includes('localhost') || clean.includes('127.0.0.1'))) {
      localStorage.removeItem('hg_local_warden_url');
      return;
    }
    localStorage.setItem('hg_local_warden_url', clean);
  }
};

export const clearLocalWardenUrl = () => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('hg_local_warden_url');
    localStorage.removeItem('hg_backend_url');
  }
};

/**
 * Helper to ping /api/v1/ping-hostel with a strict AbortController timeout.
 * Validates genuine JSON response from a live Warden server.
 */
const verifyHostelPing = async (targetCandidate, timeoutMs = 1500) => {
  if (!targetCandidate) return null;
  const isNative = Capacitor.isNativePlatform();
  const isMobile = isNative || (typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || ''));
  let clean = targetCandidate.trim().replace(/\/+$/, '');
  if (!clean.startsWith('http')) clean = `http://${clean}`;

  // Block mobile clients from pinging mobile's own localhost (which is the phone itself)
  if ((isMobile || (typeof window !== 'undefined' && window.location.protocol === 'https:')) && 
      (clean.includes('localhost') || clean.includes('127.0.0.1') || clean.includes('10.0.2.2'))) {
    return null;
  }

  const baseOrigin = clean.replace(/\/api\/v1\/?$/, '');
  const pingUrl = `${baseOrigin}/api/v1/ping-hostel`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(pingUrl, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'Cache-Control': 'no-store' }
    });
    clearTimeout(timer);

    if (res && res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/html')) return null; // Ignore HTML fallback from Capacitor
      const data = await res.json().catch(() => null);
      if (data && (data.status === 'ok' || data.wardenIp)) {
        const fullApi = `${baseOrigin}/api/v1`;
        return { fullApi, wardenIp: data.wardenIp, port: data.port || 5000 };
      }
    }
  } catch (_) {}
  return null;
};

/**
 * Frontend Auto-Healing LAN Discovery & Subnet Scanner
 * Resolution Order:
 * 1. Fast Health Verification of cached localStorage IP (strict 1500ms timeout)
 * 2. Auto-Eviction: If cached IP fails, immediately clear it from localStorage
 * 3. Step A (Direct Local Host): If window.location.hostname is a private LAN IP, use it
 * 4. Step B (Cloud Discovery Sync): Fetch latest published Warden LAN IP from Cloud Registry
 * 5. Step C (Fast Parallel Subnet Sweep): Probe common gateway & hotspot subnets in parallel
 */
export const probeLocalWardenIp = async (manualIp = null) => {
  const isNative = Capacitor.isNativePlatform();
  const isMobileClient = isNative || (typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || ''));

  // If a manual IP was submitted by the user in the UI, verify it immediately
  if (manualIp) {
    const verified = await verifyHostelPing(manualIp, 2000);
    if (verified) {
      setLocalWardenUrl(verified.fullApi);
      return { success: true, url: verified.fullApi, wardenIp: verified.wardenIp };
    }
    return { success: false, reason: 'MANUAL_IP_UNREACHABLE' };
  }

  // 1. Fast Health Verification of cached IP
  const cachedUrl = getLocalWardenUrl();
  if (cachedUrl) {
    const pingRes = await verifyHostelPing(cachedUrl, 1500);
    if (pingRes) {
      return { success: true, url: pingRes.fullApi, wardenIp: pingRes.wardenIp };
    }
    // Auto-Eviction: Cached IP is stale / router changed -> Immediately clear from localStorage
    clearLocalWardenUrl();
  }

  // 2. Step A: Direct Local Host (if browser opened directly on Warden LAN IP, e.g. http://172.20.10.4:5000)
  if (!isNative && typeof window !== 'undefined' && window.location.hostname) {
    const host = window.location.hostname;
    const isPrivate = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(host);
    if (isPrivate && !window.location.hostname.endsWith('onrender.com') && !window.location.hostname.endsWith('vercel.app')) {
      const port = window.location.port || 5000;
      const directCandidate = `http://${host}:${port}`;
      const verified = await verifyHostelPing(directCandidate, 1500);
      if (verified) {
        setLocalWardenUrl(verified.fullApi);
        return { success: true, url: verified.fullApi, wardenIp: verified.wardenIp };
      }
    }
  }

  // 3. Step B: Cloud Discovery Sync (Query cloud registry for latest Warden laptop LAN IP)
  try {
    const cloudEndpoints = [
      'https://hostelguard-backend-oimp.onrender.com/api/v1/lan-discovery',
      'https://hostelguard-backend-oimp.onrender.com/api/v1/attendance/time-window'
    ];

    for (const endpoint of cloudEndpoints) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const cloudRes = await fetch(endpoint, { signal: controller.signal });
        clearTimeout(timeout);

        if (cloudRes && cloudRes.ok) {
          const cloudData = await cloudRes.json().catch(() => ({}));
          const publishedUrl = cloudData?.wardenLanApiUrl || cloudData?.local_warden_url || (cloudData?.wardenIp ? `http://${cloudData.wardenIp}:${cloudData.port || 5000}/api/v1` : null);

          if (publishedUrl) {
            const verified = await verifyHostelPing(publishedUrl, 1500);
            if (verified) {
              setLocalWardenUrl(verified.fullApi);
              return { success: true, url: verified.fullApi, wardenIp: verified.wardenIp };
            }
          }
        }
      } catch (_) {}
    }
  } catch (_) {}

  // 4. Step C: Fast Parallel Subnet Sweep across common gateway & hotspot candidates
  const sweepCandidates = [
    // iPhone & iOS Personal Hotspot default range
    'http://172.20.10.1:5000',
    'http://172.20.10.2:5000',
    'http://172.20.10.3:5000',
    'http://172.20.10.4:5000',
    'http://172.20.10.5:5000',
    // Windows Laptop Mobile Hotspot default gateway
    'http://192.168.137.1:5000',
    // Android Mobile Hotspot default gateway
    'http://192.168.43.1:5000',
    // Standard Hostel Wi-Fi router Class C subnets
    'http://192.168.1.100:5000',
    'http://192.168.1.1:5000',
    'http://192.168.1.2:5000',
    'http://192.168.0.100:5000',
    'http://192.168.0.1:5000',
    'http://192.168.0.2:5000',
    'http://192.168.29.1:5000',
    'http://192.168.29.100:5000',
    // Class A subnets
    'http://10.0.0.1:5000',
    'http://10.0.0.100:5000'
  ];

  if (!isMobileClient) {
    sweepCandidates.push('http://localhost:5000');
  }

  try {
    const sweepPromises = sweepCandidates.map(async (cand) => {
      const res = await verifyHostelPing(cand, 1500);
      if (res) return res;
      throw new Error('Unreachable');
    });

    const winner = await Promise.any(sweepPromises);
    if (winner && winner.fullApi) {
      setLocalWardenUrl(winner.fullApi);
      return { success: true, url: winner.fullApi, wardenIp: winner.wardenIp };
    }
  } catch (_) {}

  return { success: false, reason: 'WIFI_ROUTER_CHANGED' };
};

// Dynamically determine the API base URL:
// - If browser opened from Warden LAN IP (e.g. http://172.20.10.2:5000), use relative '/api/v1' directly (100% offline support)
// - If enforcement mode is STRICT / STRICT_LOCK, point to Warden's local hostel server IP
// - Native Mobile (Capacitor) uses local warden IP if set, or Cloud URL when off-campus
export const getApiBaseUrl = () => {
  if (typeof window !== 'undefined') {
    const custom = localStorage.getItem('hg_backend_url');
    if (custom) return custom.replace(/\/+$/, '');

    const isNative = Capacitor.isNativePlatform();
    // Direct LAN Web browser access on Warden laptop IP (e.g. http://172.20.10.2:5000 or localhost)
    if (!isNative && window.location.hostname && 
        !window.location.hostname.endsWith('onrender.com') && 
        !window.location.hostname.endsWith('vercel.app')) {
      return '/api/v1';
    }

    const bleMode = localStorage.getItem('hg_ble_mode') || 'STANDBY';
    const localWarden = localStorage.getItem('hg_local_warden_url');

    // In STRICT mode or if local warden server is configured, route to local warden server
    if ((bleMode === 'STRICT' || bleMode === 'STRICT_LOCK' || bleMode === 'STRICT_REQUIRED' || isNative) && localWarden) {
      const cleanWarden = localWarden.replace(/\/+$/, '');
      return cleanWarden.endsWith('/api/v1') ? cleanWarden : `${cleanWarden}/api/v1`;
    }
  }

  if (import.meta.env?.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '');
  }

  // Capacitor Native App: use local warden if on hostel Wi-Fi, otherwise Cloud
  if (Capacitor.isNativePlatform()) {
    const localWarden = typeof window !== 'undefined' ? localStorage.getItem('hg_local_warden_url') : null;
    if (localWarden) {
      const cleanWarden = localWarden.replace(/\/+$/, '');
      return cleanWarden.endsWith('/api/v1') ? cleanWarden : `${cleanWarden}/api/v1`;
    }
    return 'https://hostelguard-backend-oimp.onrender.com/api/v1';
  }

  if (typeof window !== 'undefined' && window.location.hostname.endsWith('onrender.com')) {
    return 'https://hostelguard-backend-oimp.onrender.com/api/v1';
  }

  return '/api/v1';
};

export const getServerRootUrl = () => {
  const base = getApiBaseUrl();
  return base.replace(/\/api\/v1\/?$/, '');
};

// Token Management & Stable Persistent Device ID (UUIDv4)
export const getDeviceId = () => {
  if (typeof window === 'undefined') return 'DEV-SERVER';
  let devId = localStorage.getItem('hg_device_id');
  if (!devId) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      devId = crypto.randomUUID();
    } else {
      devId = 'dev-' + Math.random().toString(36).substring(2, 15) + '-' + Date.now().toString(36);
    }
    localStorage.setItem('hg_device_id', devId);
  }
  return devId;
};

export const authStorage = {
  getToken: () => localStorage.getItem('hg_token'),
  setToken: (token) => localStorage.setItem('hg_token', token),
  clearToken: () => localStorage.removeItem('hg_token'),
  getRefreshToken: () => localStorage.getItem('hg_refresh_token'),
  setRefreshToken: (token) => localStorage.setItem('hg_refresh_token', token),
  clearRefreshToken: () => localStorage.removeItem('hg_refresh_token'),
  getDeviceId: () => getDeviceId(),
  getUser: () => {
    try {
      const u = localStorage.getItem('hg_user');
      return u ? JSON.parse(u) : null;
    } catch {
      return null;
    }
  },
  setUser: (user) => localStorage.setItem('hg_user', JSON.stringify(user)),
  clearUser: () => localStorage.removeItem('hg_user'),
  getBackendUrl: () => localStorage.getItem('hg_backend_url') || getApiBaseUrl(),
  setBackendUrl: (url) => {
    if (!url) localStorage.removeItem('hg_backend_url');
    else localStorage.setItem('hg_backend_url', url.trim());
  }
};

// Central fetch helper with automatic Authorization header and transparent refresh token rotation
async function request(endpoint, options = {}, isRetry = false) {
  const token = authStorage.getToken();
  const deviceId = getDeviceId();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'X-Device-Id': deviceId,
    ...options.headers
  };

  const bleMode = typeof window !== 'undefined' ? (localStorage.getItem('hg_ble_mode') || 'STANDBY') : 'STANDBY';
  const isStrictMode = bleMode === 'STRICT' || bleMode === 'STRICT_LOCK' || bleMode === 'STRICT_REQUIRED';
  const localWarden = typeof window !== 'undefined' ? localStorage.getItem('hg_local_warden_url') : null;

  const primaryUrl = `${getApiBaseUrl()}${endpoint}`;
  let response;

  const performFetch = async (targetUrl, timeoutMs) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(targetUrl, {
        ...options,
        signal: options.signal || controller.signal,
        headers
      });
      clearTimeout(timeoutId);
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  };

  const cloudBase = 'https://hostelguard-backend-oimp.onrender.com/api/v1';

  // For authentication endpoints:
  // - Direct browser access on LAN (e.g. http://172.20.10.2:5000): Authenticate directly with local server (100% offline support)
  // - Native app with local warden IP: Use local warden server
  // - Otherwise: Authenticate with Cloud API (with seamless offline fallback)
  let activeUrl = primaryUrl;
  const isAuthEndpoint = endpoint.startsWith('/auth');
  const isNative = Capacitor.isNativePlatform();
  const isDirectLan = !isNative && typeof window !== 'undefined' && 
    window.location.hostname && 
    !window.location.hostname.endsWith('onrender.com') && 
    !window.location.hostname.endsWith('vercel.app');

  if (isAuthEndpoint) {
    if (localWarden) {
      const cleanWarden = localWarden.replace(/\/+$/, '');
      const wardenBase = cleanWarden.endsWith('/api/v1') ? cleanWarden : `${cleanWarden}/api/v1`;
      activeUrl = `${wardenBase}${endpoint}`;
    } else if (isDirectLan) {
      activeUrl = primaryUrl;
    } else {
      activeUrl = `${cloudBase}${endpoint}`;
    }
  }

  try {
    // 15-second standard timeout for local Wi-Fi and mobile networks to avoid premature aborts
    const defaultTimeout = options.timeout || (endpoint === '/auth/me' ? 8000 : 15000);
    response = await performFetch(activeUrl, defaultTimeout);
  } catch (networkErr) {
    // Bidirectional resilient failover between Local Warden Server and Cloud:
    if (localWarden && activeUrl.includes(localWarden)) {
      // 1. Fast parallel probe for active Warden LAN server (e.g. 172.20.10.2:5000, 192.168.137.1:5000)
      const probeRes = await probeLocalWardenIp();
      if (probeRes.success) {
        try {
          const recoveredUrl = `${probeRes.url}${endpoint}`;
          response = await performFetch(recoveredUrl, options.timeout || 15000);
        } catch (_) {}
      }

      if (!response) {
        // Try Cloud fallback if internet is available
        try {
          const fallbackUrl = `${cloudBase}${endpoint}`;
          response = await performFetch(fallbackUrl, options.timeout || 15000);
        } catch (cloudErr) {
          throw new Error(
            `Unable to reach Warden server (${localWarden}) or Cloud. Please verify your phone is on the same Wi-Fi as the Warden laptop (e.g. http://172.20.10.2:5000).`
          );
        }
      }
    } else if (activeUrl.startsWith(cloudBase)) {
      // 2. Cloud failed (Hostel has NO INTERNET): Failover automatically to local Warden server on LAN!
      const probeRes = await probeLocalWardenIp();
      if (probeRes.success) {
        try {
          const recoveredUrl = `${probeRes.url}${endpoint}`;
          response = await performFetch(recoveredUrl, options.timeout || 15000);
        } catch (_) {}
      }
      if (!response) {
        throw new Error(
          `Offline: Unable to connect to Warden server or Cloud. Please ensure your phone is connected to the Hostel Wi-Fi / Hotspot (e.g. http://172.20.10.2:5000).`
        );
      }
    } else {
      throw networkErr;
    }
  }

  const contentType = (response && response.headers && typeof response.headers.get === 'function') 
    ? (response.headers.get('content-type') || '') 
    : '';

  if (response.ok && contentType && !contentType.includes('application/json')) {
    throw new Error('Hostel server connection error: received HTML instead of API response. Please verify the Warden Server IP (e.g. http://172.20.10.2:5000).');
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    // If access token expired and we have a refresh token, rotate and retry once
    if (
      response.status === 401 &&
      !isRetry &&
      !endpoint.startsWith('/auth/login') &&
      !endpoint.startsWith('/auth/refresh') &&
      !endpoint.startsWith('/auth/phone-login')
    ) {
      const refreshToken = authStorage.getRefreshToken();
      if (refreshToken) {
        try {
          const refreshRes = await fetch(`${getApiBaseUrl()}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken })
          });
          const refreshData = await refreshRes.json();
          if (refreshRes.ok && (refreshData.accessToken || refreshData.token)) {
            const newAccess = refreshData.accessToken || refreshData.token;
            authStorage.setToken(newAccess);
            if (refreshData.refreshToken) {
              authStorage.setRefreshToken(refreshData.refreshToken);
            }
            // Retry the original request with new rotated access token
            return request(endpoint, options, true);
          }
        } catch (refreshErr) {
          console.warn('Automatic token refresh failed:', refreshErr);
        }
      }

      authStorage.clearToken();
      authStorage.clearRefreshToken();
      authStorage.clearUser();
      window.dispatchEvent(new Event('auth:unauthorized'));
    }
    throw new Error(data.error || data.message || `Request failed with status ${response.status}`);
  }

  return data;
}

export const api = {
  // System Health
  async getHealth() {
    const root = getServerRootUrl();
    const res = await fetch(`${root || ''}/health`);
    return res.json();
  },

  // Authentication
  auth: {
    login: (credentials) => request('/auth/login', { method: 'POST', body: JSON.stringify({ device_id: getDeviceId(), ...credentials }) }),
    refreshToken: (refreshToken) => request('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
    getMe: () => request('/auth/me'),
    changePassword: (data) => request('/auth/change-password', { method: 'POST', body: JSON.stringify(data) }),
    logout: (data = {}) => request('/auth/logout', { method: 'POST', body: JSON.stringify(data) }),
    logoutAll: () => request('/auth/logout-all', { method: 'POST' }),
    requestPasswordResetOtp: (data) => request('/auth/forgot-password/request-otp', { method: 'POST', body: JSON.stringify(data) }),
    verifyPasswordResetOtp: (data) => request('/auth/forgot-password/verify-otp', { method: 'POST', body: JSON.stringify(data) }),
    resetPasswordWithOtp: (data) => request('/auth/forgot-password/reset', { method: 'POST', body: JSON.stringify(data) }),
    verifyPhoneEmail: (data) => request('/auth/forgot-password/phone-email-verify', { method: 'POST', body: JSON.stringify(data) }),
    verifyMagicLink: (token) => request('/auth/forgot-password/verify-magic-link', { method: 'POST', body: JSON.stringify({ token }) }),
    phoneEmailLogin: (data) => request('/auth/phone-login', { method: 'POST', body: JSON.stringify(data) }),
    requestLoginOtp: (data) => request('/auth/otp-login/request', { method: 'POST', body: JSON.stringify(data) }),
    verifyLoginOtp: (data) => request('/auth/otp-login/verify', { method: 'POST', body: JSON.stringify(data) }),
    googleLogin: (data) => request('/auth/google-login', { method: 'POST', body: JSON.stringify(data) }),
    initialAdminSetup: (data) => request('/auth/initial-admin-setup', { method: 'POST', body: JSON.stringify(data) }),
    masterRecoveryVerify: (data) => request('/auth/master-recovery/verify', { method: 'POST', body: JSON.stringify(data) }),
    masterRecoveryReset: (data) => request('/auth/master-recovery/reset', { method: 'POST', body: JSON.stringify(data) })
  },

  // Admin APIs
  admin: {
    getDashboardStats: () => request('/admin/dashboard-stats'),
    getTodayRoster: (date) => request(`/admin/today-roster${date ? '?date=' + encodeURIComponent(date) : ''}`),
    getCredentialsDirectory: () => request('/admin/credentials-directory'),
    getSecurityProfile: () => request('/admin/security/profile'),
    updateSecurityProfile: (data) => request('/admin/security/update-profile', { method: 'POST', body: JSON.stringify(data) }),
    regenerateMasterKey: (data) => request('/admin/security/regenerate-master-key', { method: 'POST', body: JSON.stringify(data) }),
    resetStudentPassword: (id, data) => request(`/admin/students/${encodeURIComponent(id)}/reset-password`, { method: 'POST', body: JSON.stringify(data || {}) }),
    resetStudentDevice: (id) => request(`/admin/students/${encodeURIComponent(id)}/reset-device`, { method: 'POST' }),
    getStudents: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return request(`/admin/students${q ? '?' + q : ''}`);
    },
    getStudentDetails: (id) => request(`/admin/students/${encodeURIComponent(id)}`),
    updateStudent: (id, data) => request(`/admin/students/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
    getBlocks: () => request('/admin/blocks'),
    previewRosterUpload: (formDataOrJson) => {
      const token = authStorage.getToken();
      if (formDataOrJson instanceof FormData) {
        return fetch(`${getApiBaseUrl()}/admin/allotment/upload-preview`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formDataOrJson
        }).then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || 'Preview failed');
          return d;
        });
      }
      return request('/admin/allotment/upload-preview', { method: 'POST', body: JSON.stringify(formDataOrJson) });
    },
    commitRosterUpload: (validRecords, preCreateLogins = true) =>
      request('/admin/allotment/upload-commit', { method: 'POST', body: JSON.stringify({ validRecords, preCreateLogins }) }),
    manualAddStudent: (data) => request('/admin/students/manual-add', { method: 'POST', body: JSON.stringify(data) }),
    deleteStudent: (id) => request(`/admin/students/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    clearAllStudents: () => request('/admin/students/clear-all', { method: 'POST' }),
    getGeofence: () => request('/admin/geofence'),
    updateGeofence: (config) => request('/admin/geofence', { method: 'POST', body: JSON.stringify(config) }),
    getBleConfig: () => request('/admin/ble/config'),
    updateBleMode: (ble_mode) => request('/admin/ble/mode', { method: 'POST', body: JSON.stringify({ ble_mode }) }),
    triggerTemporaryRelax: (minutes = 15) => request('/admin/ble/temporary-relax', { method: 'POST', body: JSON.stringify({ minutes }) }),
    generateBleSecret: () => request('/admin/ble/generate-secret', { method: 'POST' }),
    saveBleBeacon: (data) => request('/admin/ble/beacons', { method: 'POST', body: JSON.stringify(data) }),
    deleteBleBeacon: (id) => request(`/admin/ble/beacons/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    toggleBleBeacon: (id) => request(`/admin/ble/beacons/${encodeURIComponent(id)}/toggle`, { method: 'POST' }),
    downloadBeaconSketchUrl: (id) => `${getApiBaseUrl()}/admin/ble/beacons/${encodeURIComponent(id)}/sketch`,
    verifyBleToken: (data) => request('/admin/ble/verify-token', { method: 'POST', body: JSON.stringify(data) }),
    getStrictVaultStatus: () => request('/admin/strict-vault/status'),
    prepareStrictVaultOffline: () => request('/admin/strict-vault/prepare-offline', { method: 'POST' }),
    syncStrictVaultToCloud: () => request('/admin/strict-vault/sync-to-cloud', { method: 'POST' }),
    authorizeCurrentWifi: (label) => request('/admin/wifi/authorize-current', { method: 'POST', body: JSON.stringify({ label }) }),
    getAuthorizedWifi: () => request('/admin/wifi/authorized'),
    deleteAuthorizedWifi: (ip) => request(`/admin/wifi/authorized/${encodeURIComponent(ip)}`, { method: 'DELETE' }),
    unlockAllStrikes: () => request('/admin/strikes/unlock-all', { method: 'POST' }),
    getReports: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return request(`/admin/reports${q ? '?' + q : ''}`);
    },
    overrideAttendance: (data) => request('/admin/attendance/override', { method: 'POST', body: JSON.stringify(data) }),
    deleteAttendanceRecord: (id) => request(`/admin/attendance/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    clearAttendanceRecords: (date) => request(`/admin/attendance${date ? '?date=' + encodeURIComponent(date) : ''}`, { method: 'DELETE' }),
    getCorrections: (status) => request(`/admin/corrections${status ? '?status=' + status : ''}`),
    reviewCorrection: (id, data) => request(`/admin/corrections/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify(data) }),
    deleteCorrection: (id) => request(`/admin/corrections/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    clearAllCorrections: (status) => request(`/admin/corrections${status ? '?status=' + encodeURIComponent(status) : ''}`, { method: 'DELETE' }),
    getSecurityAlerts: () => request('/admin/security/alerts'),
    deleteSecurityAlert: (id) => request(`/admin/security/alerts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    clearAllSecurityAlerts: () => request('/admin/security/alerts', { method: 'DELETE' }),
    resetStrike: (data) => request('/admin/security/reset-strike', { method: 'POST', body: JSON.stringify(data) }),
    approveManualReview: (data) => request('/admin/security/approve-manual-review', { method: 'POST', body: JSON.stringify(data) }),
    resetAllStrikes: (data = {}) => request('/admin/security/reset-all-strikes', { method: 'POST', body: JSON.stringify(data) }),
    getAuditLogs: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return request(`/admin/audit-logs${q ? '?' + q : ''}`);
    },
    deleteAuditLog: (id) => request(`/admin/audit-logs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    clearAllAuditLogs: () => request('/admin/audit-logs', { method: 'DELETE' }),
    getFeedback: (status) => request(`/admin/feedback${status ? '?status=' + status : ''}`),
    resolveFeedback: (id, data) => request(`/admin/feedback/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: JSON.stringify(data) }),
    deleteFeedbackTicket: (id) => request(`/admin/feedback/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    clearAllFeedbackTickets: (status) => request(`/admin/feedback${status ? '?status=' + encodeURIComponent(status) : ''}`, { method: 'DELETE' }),
    getAttendanceSchedule: () => request('/admin/attendance-schedule'),
    updateAttendanceSchedule: (data) => request('/admin/attendance-schedule', { method: 'POST', body: JSON.stringify(data) }),
    saveScheduleOverride: (data) => request('/admin/attendance-schedule/overrides', { method: 'POST', body: JSON.stringify(data) }),
    deleteScheduleOverride: (id) => request(`/admin/attendance-schedule/overrides/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    uploadHolidayList: (formDataOrJson) => {
      const token = authStorage.getToken();
      if (formDataOrJson instanceof FormData) {
        return fetch(`${getApiBaseUrl()}/admin/attendance-schedule/upload-holidays`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formDataOrJson
        }).then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || 'Holiday upload failed');
          return d;
        });
      }
      return request('/admin/attendance-schedule/upload-holidays', { method: 'POST', body: JSON.stringify(formDataOrJson) });
    },
    createBackup: () => request('/admin/backup/create', { method: 'POST' }),
    listBackups: () => request('/admin/backup/list'),
    restoreBackup: (data) => request('/admin/backup/restore', { method: 'POST', body: JSON.stringify(data) }),
    getSystemHealth: () => request('/admin/system-health'),
    getAttendanceLedger: (params = {}) => request(`/admin/attendance-ledger${params.year || params.month ? '?' + new URLSearchParams(params).toString() : ''}`)
  },

  // Warden APIs
  warden: {
    getOverview: () => request('/warden/overview'),
    getExceptions: () => request('/warden/exceptions'),
    getCorrections: (status) => request(`/warden/corrections${status ? '?status=' + status : ''}`),
    reviewCorrection: (id, data) => request(`/warden/corrections/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify(data) }),
    getFeedback: () => request('/warden/feedback'),
    respondFeedback: (id, data) => request(`/warden/feedback/${encodeURIComponent(id)}/respond`, { method: 'POST', body: JSON.stringify(data) }),
    getAttendanceLedger: (params = {}) => request(`/warden/attendance-ledger${params.year || params.month ? '?' + new URLSearchParams(params).toString() : ''}`),
    getStudentLedger: (studentId, year) => request(`/warden/student-ledger/${encodeURIComponent(studentId)}${year ? '?year=' + year : ''}`)
  },

  // Student APIs
  student: {
    getAllotmentList: () => request('/students/allotment-list'),
    onboard: (data) => request('/students/onboard', { method: 'POST', body: JSON.stringify(data) }),
    lookupOnboarding: (query) => request('/students/onboarding/lookup', { method: 'POST', body: JSON.stringify({ query }) }),
    sendOnboardingOtp: (data) => request('/students/onboarding/send-otp', { method: 'POST', body: JSON.stringify(data) }),
    verifyOnboardingOtp: (data) => request('/students/onboarding/verify-otp', { method: 'POST', body: JSON.stringify(data) }),
    getDashboard: () => request('/students/dashboard'),
    getHistory: () => request('/students/history'),
    getAttendanceLedger: (year) => request(`/students/attendance-ledger${year ? '?year=' + year : ''}`),
    submitCorrection: (data) => request('/students/corrections', { method: 'POST', body: JSON.stringify(data) }),
    getCorrections: () => request('/students/corrections'),
    submitFeedback: (data) => request('/students/feedback', { method: 'POST', body: JSON.stringify(data) }),
    getFeedback: () => request('/students/feedback'),
    registerFace: (data) => request('/students/register-face', { method: 'POST', body: JSON.stringify(data) }),
    lookup: (query) => request('/students/onboarding/lookup', { method: 'POST', body: JSON.stringify({ query }) }),
    sendOtp: (data) => request('/students/onboarding/send-otp', { method: 'POST', body: JSON.stringify(data) }),
    verifyOtp: (data) => request('/students/onboarding/verify-otp', { method: 'POST', body: JSON.stringify(data) }),
    submitFaceBiometrics: (payload) => request('/students/onboard', { method: 'POST', body: JSON.stringify(payload) })
  },

  // Student Self-Onboarding & Biometric Verification
  studentOnboarding: {
    lookup: (query) => request('/students/onboarding/lookup', { method: 'POST', body: JSON.stringify({ query }) }),
    sendOtp: (data) => request('/students/onboarding/send-otp', { method: 'POST', body: JSON.stringify(data) }),
    verifyOtp: (data) => request('/students/onboarding/verify-otp', { method: 'POST', body: JSON.stringify(data) }),
    submitFaceBiometrics: (payload) => request('/students/onboard', { method: 'POST', body: JSON.stringify(payload) })
  },

  // Daily Attendance APIs
  attendance: {
    verifyLocation: (data) => request('/attendance/verify-location', { method: 'POST', body: JSON.stringify({ device_id: getDeviceId(), ...data }) }),
    verifyFace: (data) => request('/attendance/verify-face', { method: 'POST', body: JSON.stringify({ device_id: getDeviceId(), ...data }) }),
    mark: (data) => request('/attendance/mark', { method: 'POST', body: JSON.stringify({ device_id: getDeviceId(), ...data }) }),
    getStatus: (identifier) => request(`/attendance/status/${encodeURIComponent(identifier)}`),
    offlineSync: (data) => request('/attendance/offline-sync', { method: 'POST', body: JSON.stringify({ device_id: getDeviceId(), ...data }) }),
    getSchedule: () => request('/attendance/schedule'),
    requestPhysicalVerification: (data) => request('/attendance/request-physical-verification', { method: 'POST', body: JSON.stringify({ device_id: getDeviceId(), ...data }) })
  },

  // Onboarding Privacy-Preserving OTP Helpers
  lookupOnboarding(query) {
    return request('/students/onboarding/lookup', { method: 'POST', body: JSON.stringify({ query }) });
  },
  sendOnboardingOtp(data) {
    return request('/students/onboarding/send-otp', { method: 'POST', body: JSON.stringify(data) });
  },
  verifyOnboardingOtp(data) {
    return request('/students/onboarding/verify-otp', { method: 'POST', body: JSON.stringify(data) });
  },
  submitFaceBiometrics(payload) {
    return request('/students/onboard', { method: 'POST', body: JSON.stringify(payload) });
  },

  // Backward-compatibility aliases for legacy / simulator components
  async getUnregisteredAllotments() {
    const res = await request('/students/allotment-list');
    return res.allotments || [];
  },
  onboardStudent(data) {
    return request('/students/onboard', { method: 'POST', body: JSON.stringify(data) });
  },
  verifyLocation(data) {
    return request('/attendance/verify-location', { method: 'POST', body: JSON.stringify(data) });
  },
  verifyFace(data) {
    return request('/attendance/verify-face', { method: 'POST', body: JSON.stringify(data) });
  },
  getAttendanceStatus(roll) {
    return request(`/attendance/status/${encodeURIComponent(roll)}`);
  },
  getGeofenceConfig() {
    return request('/admin/geofence');
  },
  async getRegisteredStudents() {
    try {
      const res = await request('/admin/students?limit=200');
      return res.students || [];
    } catch {
      return [];
    }
  }
};

