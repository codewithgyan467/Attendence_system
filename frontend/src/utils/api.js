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
    return localStorage.getItem('hg_local_warden_url') || null;
  }
  return null;
};

export const setLocalWardenUrl = (url) => {
  if (typeof window !== 'undefined') {
    if (!url) localStorage.removeItem('hg_local_warden_url');
    else localStorage.setItem('hg_local_warden_url', url.replace(/\/+$/, ''));
  }
};

export const clearLocalWardenUrl = () => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('hg_local_warden_url');
    localStorage.removeItem('hg_backend_url');
  }
};

export const probeLocalWardenIp = async (manualIp = null) => {
  const candidates = manualIp
    ? [manualIp.startsWith('http') ? manualIp : `http://${manualIp}`]
    : [
        'http://172.20.10.2:5000',
        'http://192.168.137.1:5000',
        'http://192.168.1.100:5000',
        'http://192.168.0.100:5000',
        'http://localhost:5000'
      ];

  for (let cand of candidates) {
    const cleanCand = cand.replace(/\/+$/, '');
    const probeUrl = cleanCand.endsWith('/api/v1') ? `${cleanCand}/health` : `${cleanCand}/api/v1/health`;
    try {
      const res = await fetch(probeUrl, { signal: AbortSignal.timeout(1500) });
      if (res && res.ok) {
        const fullApi = cleanCand.endsWith('/api/v1') ? cleanCand : `${cleanCand}/api/v1`;
        setLocalWardenUrl(fullApi);
        return { success: true, url: fullApi };
      }
    } catch (_) {}
  }
  return { success: false };
};

// Dynamically determine the API base URL:
// - If enforcement mode is STRICT / STRICT_LOCK, point to Warden's local hostel server IP
// - If enforcement mode is STANDBY or SOFT_ANCHOR, point to Cloud URL
// - Native Mobile (Capacitor) switches seamlessly between local Wi-Fi and Cloud
export const getApiBaseUrl = () => {
  if (typeof window !== 'undefined') {
    const custom = localStorage.getItem('hg_backend_url');
    if (custom) return custom.replace(/\/+$/, '');

    const bleMode = localStorage.getItem('hg_ble_mode') || 'STANDBY';
    const localWarden = localStorage.getItem('hg_local_warden_url');

    // In STRICT mode, point API calls directly to the Warden's local office server
    if ((bleMode === 'STRICT' || bleMode === 'STRICT_LOCK' || bleMode === 'STRICT_REQUIRED') && localWarden) {
      const cleanWarden = localWarden.replace(/\/+$/, '');
      return cleanWarden.endsWith('/api/v1') ? cleanWarden : `${cleanWarden}/api/v1`;
    }
  }

  if (import.meta.env?.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '');
  }

  // Capacitor Native App in STANDBY / SOFT_ANCHOR mode routes to Cloud
  if (Capacitor.isNativePlatform()) {
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

  try {
    const isLocalRequest = Boolean(localWarden && primaryUrl.includes(localWarden));
    const defaultTimeout = isLocalRequest ? 2500 : (options.timeout || (endpoint === '/auth/me' ? 8000 : 35000));
    response = await performFetch(primaryUrl, defaultTimeout);
  } catch (networkErr) {
    // If primary was an unreachable local warden IP, probe current LAN hotspot IPs and Cloud fallback
    if (localWarden && primaryUrl.includes(localWarden)) {
      // 1. Fast local probe for common host/hotspot IPs (e.g. iPhone hotspot 172.20.10.2, Windows hotspot 192.168.137.1)
      const candidateIps = [
        'http://172.20.10.2:5000/api/v1',
        'http://192.168.137.1:5000/api/v1',
        'http://192.168.1.100:5000/api/v1',
        'http://192.168.0.100:5000/api/v1'
      ].filter(u => u !== localWarden && `${u}${endpoint}` !== primaryUrl);

      let probedSuccess = false;
      for (const cand of candidateIps) {
        try {
          const candUrl = `${cand}${endpoint}`;
          const candRes = await performFetch(candUrl, 1500);
          if (candRes && (candRes.ok || candRes.status === 401 || candRes.status === 403 || candRes.status === 400)) {
            response = candRes;
            probedSuccess = true;
            setLocalWardenUrl(cand);
            break;
          }
        } catch (_) {}
      }

      if (probedSuccess && response) {
        // Recovered via auto-discovered local LAN IP!
      } else {
        // 2. Fall back to Cloud API
        try {
          const fallbackUrl = `${cloudBase}${endpoint}`;
          response = await performFetch(fallbackUrl, options.timeout || 15000);
          // If cloud succeeds, check if we can refresh the latest warden LAN IP from cloud
          performFetch(`${cloudBase}/attendance/time-window`, 5000).then(async (twRes) => {
            if (twRes && twRes.ok) {
              const twData = await twRes.json().catch(() => ({}));
              if (twData?.wardenLanApiUrl) setLocalWardenUrl(twData.wardenLanApiUrl);
            }
          }).catch(() => {});
        } catch (cloudErr) {
          if (isStrictMode && endpoint.startsWith('/attendance')) {
            throw new Error(
              `Warden's local hostel server (${localWarden}) is unreachable on Wi-Fi. Please ensure the Warden's laptop is powered on and connected to the same Wi-Fi ("iPhone").`
            );
          }
          throw cloudErr;
        }
      }
    } else if (!primaryUrl.startsWith(cloudBase)) {
      try {
        const fallbackUrl = `${cloudBase}${endpoint}`;
        response = await performFetch(fallbackUrl, options.timeout || 35000);
      } catch (_) {
        throw new Error(
          `Unable to reach server (${networkErr.message || 'Connection failed'}). Please check your connection.`
        );
      }
    } else {
      throw new Error(
        `Unable to reach server (${networkErr.message || 'Connection failed'}). Please check your connection.`
      );
    }
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
    verifyLocation: (data) => request('/attendance/verify-location', { method: 'POST', body: JSON.stringify(data) }),
    verifyFace: (data) => request('/attendance/verify-face', { method: 'POST', body: JSON.stringify(data) }),
    getStatus: (identifier) => request(`/attendance/status/${encodeURIComponent(identifier)}`),
    offlineSync: (data) => request('/attendance/offline-sync', { method: 'POST', body: JSON.stringify(data) }),
    getSchedule: () => request('/attendance/schedule'),
    requestPhysicalVerification: (data) => request('/attendance/request-physical-verification', { method: 'POST', body: JSON.stringify(data) })
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

