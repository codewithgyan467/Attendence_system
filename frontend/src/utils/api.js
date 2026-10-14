import { Capacitor } from '@capacitor/core';

// Dynamically determine the API base URL:
// - Browser development uses relative '/api/v1' via Vite proxy
// - Android Native Emulator uses 'http://10.0.2.2:5000/api/v1'
// - Physical phone or custom network can set localStorage 'hg_backend_url'
export const getApiBaseUrl = () => {
  if (typeof window !== 'undefined') {
    const custom = localStorage.getItem('hg_backend_url');
    if (custom) return custom.replace(/\/+$/, '');
  }
  if (import.meta.env?.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '');
  }
  if (Capacitor.isNativePlatform()) {
    return 'https://hostelguard-backend-oimp.onrender.com/api/v1';
  }
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return 'https://hostelguard-backend-oimp.onrender.com/api/v1';
  }
  return '/api/v1';
};

export const getServerRootUrl = () => {
  const base = getApiBaseUrl();
  return base.replace(/\/api\/v1\/?$/, '');
};

// Token Management
export const authStorage = {
  getToken: () => localStorage.getItem('hg_token'),
  setToken: (token) => localStorage.setItem('hg_token', token),
  clearToken: () => localStorage.removeItem('hg_token'),
  getRefreshToken: () => localStorage.getItem('hg_refresh_token'),
  setRefreshToken: (token) => localStorage.setItem('hg_refresh_token', token),
  clearRefreshToken: () => localStorage.removeItem('hg_refresh_token'),
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
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers
  };

  const url = `${getApiBaseUrl()}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers
  });

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
    login: (credentials) => request('/auth/login', { method: 'POST', body: JSON.stringify(credentials) }),
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
    googleLogin: (data) => request('/auth/google-login', { method: 'POST', body: JSON.stringify(data) })
  },

  // Admin APIs
  admin: {
    getDashboardStats: () => request('/admin/dashboard-stats'),
    getCredentialsDirectory: () => request('/admin/credentials-directory'),
    resetStudentPassword: (id, data) => request(`/admin/students/${encodeURIComponent(id)}/reset-password`, { method: 'POST', body: JSON.stringify(data || {}) }),
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
    clearAllStudents: () => request('/admin/students/clear-all', { method: 'POST' }),
    getGeofence: () => request('/admin/geofence'),
    updateGeofence: (config) => request('/admin/geofence', { method: 'POST', body: JSON.stringify(config) }),
    getReports: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return request(`/admin/reports${q ? '?' + q : ''}`);
    },
    overrideAttendance: (data) => request('/admin/attendance/override', { method: 'POST', body: JSON.stringify(data) }),
    getCorrections: (status) => request(`/admin/corrections${status ? '?status=' + status : ''}`),
    reviewCorrection: (id, data) => request(`/admin/corrections/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify(data) }),
    getSecurityAlerts: () => request('/admin/security/alerts'),
    resetStrike: (data) => request('/admin/security/reset-strike', { method: 'POST', body: JSON.stringify(data) }),
    getAuditLogs: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return request(`/admin/audit-logs${q ? '?' + q : ''}`);
    },
    getFeedback: (status) => request(`/admin/feedback${status ? '?status=' + status : ''}`),
    resolveFeedback: (id, data) => request(`/admin/feedback/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: JSON.stringify(data) }),
    createBackup: () => request('/admin/backup/create', { method: 'POST' }),
    listBackups: () => request('/admin/backup/list'),
    restoreBackup: (data) => request('/admin/backup/restore', { method: 'POST', body: JSON.stringify(data) }),
    getSystemHealth: () => request('/admin/system-health')
  },

  // Warden APIs
  warden: {
    getOverview: () => request('/warden/overview'),
    getExceptions: () => request('/warden/exceptions'),
    getCorrections: (status) => request(`/warden/corrections${status ? '?status=' + status : ''}`),
    reviewCorrection: (id, data) => request(`/warden/corrections/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify(data) }),
    getFeedback: () => request('/warden/feedback'),
    respondFeedback: (id, data) => request(`/warden/feedback/${encodeURIComponent(id)}/respond`, { method: 'POST', body: JSON.stringify(data) })
  },

  // Student APIs
  student: {
    getAllotmentList: () => request('/students/allotment-list'),
    onboard: (data) => request('/students/onboard', { method: 'POST', body: JSON.stringify(data) }),
    getDashboard: () => request('/students/dashboard'),
    getHistory: () => request('/students/history'),
    submitCorrection: (data) => request('/students/corrections', { method: 'POST', body: JSON.stringify(data) }),
    getCorrections: () => request('/students/corrections'),
    submitFeedback: (data) => request('/students/feedback', { method: 'POST', body: JSON.stringify(data) }),
    getFeedback: () => request('/students/feedback')
  },

  // Daily Attendance APIs
  attendance: {
    verifyLocation: (data) => request('/attendance/verify-location', { method: 'POST', body: JSON.stringify(data) }),
    verifyFace: (data) => request('/attendance/verify-face', { method: 'POST', body: JSON.stringify(data) }),
    getStatus: (identifier) => request(`/attendance/status/${encodeURIComponent(identifier)}`)
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

