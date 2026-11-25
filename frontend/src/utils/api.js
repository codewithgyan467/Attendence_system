import { Capacitor } from '@capacitor/core';
import { discoverLocalNetworkInfo, verifyNativeServerUrl } from './nativeHardware';

const DEFAULT_CLOUD_API_BASE = 'https://hostelguard-backend-oimp.onrender.com/api/v1';

const getConfiguredCloudBase = () => {
  const envUrl = import.meta.env?.VITE_API_BASE_URL;
  return (envUrl && envUrl.trim()) ? envUrl.trim().replace(/\/+$/, '') : DEFAULT_CLOUD_API_BASE;
};

const isPrivateLanHost = (hostname = '') => {
  const clean = hostname.replace(/^https?:\/\//, '').split(':')[0].trim();
  if (!clean) return false;
  return /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(clean);
};

const normalizeWardenBaseOrigin = (targetCandidate = '') => {
  let clean = String(targetCandidate || '').trim().replace(/\/+$/, '');
  if (!clean) return '';
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    clean = `http://${clean}`;
  }
  clean = clean.replace(/\/api\/v1\/?$/, '');
  if (/^http:\/\/(\d{1,3}(?:\.\d{1,3}){3}|localhost|[a-z0-9-]+(?:\.local)?)$/i.test(clean)) {
    return `${clean}:5000`;
  }
  return clean;
};

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
  const baseOrigin = normalizeWardenBaseOrigin(targetCandidate);
  if (!baseOrigin) return null;

  // Block mobile clients from pinging mobile's own localhost (which is the phone itself)
  if ((isMobile || (typeof window !== 'undefined' && window.location.protocol === 'https:')) && 
      (baseOrigin.includes('localhost') || baseOrigin.includes('127.0.0.1') || baseOrigin.includes('10.0.2.2'))) {
    return null;
  }

  // On Android/iOS native Capacitor, always probe over native Wi-Fi-bound sockets
  // so dead LAN IPs never queue behind WebViewLocalServer's HTTP proxy threads.
  if (isNative) {
    const nativeHit = await verifyNativeServerUrl(baseOrigin, timeoutMs);
    return nativeHit || null;
  }

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
        let reachableHost = '';
        try { reachableHost = new URL(baseOrigin).hostname; } catch (_) {}
        return {
          fullApi,
          wardenIp: reachableHost || data.wardenIp,
          port: data.port || 5000,
          hostname: data.hostname || ''
        };
      }
    }
  } catch (_) {}
  return null;
};

const racePingCandidates = async (candidates, timeoutMs = 1100, batchSize = 8) => {
  if (!candidates || candidates.length === 0) return null;
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    try {
      const winner = await Promise.any(
        batch.map(async (cand) => {
          const res = await verifyHostelPing(cand, timeoutMs);
          if (res) return res;
          throw new Error('Unreachable');
        })
      );
      if (winner) return winner;
    } catch (_) {}
  }
  return null;
};

const fetchCloudPublishedWardenUrl = async () => {
  try {
    const cloudApiBase = getConfiguredCloudBase();
    const cloudEndpoints = cloudApiBase ? [
      `${cloudApiBase}/lan-discovery`,
      `${cloudApiBase}/attendance/time-window`
    ] : [];

    for (const endpoint of cloudEndpoints) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        const cloudRes = await fetch(endpoint, { signal: controller.signal });
        clearTimeout(timeout);

        if (cloudRes && cloudRes.ok) {
          const cloudData = await cloudRes.json().catch(() => ({}));
          const publishedUrl = cloudData?.wardenLanApiUrl || cloudData?.local_warden_url || (cloudData?.wardenIp ? `http://${cloudData.wardenIp}:${cloudData.port || 5000}/api/v1` : null);
          if (publishedUrl) {
            const verified = await verifyHostelPing(publishedUrl, 1600);
            if (verified) return verified;
          }
        }
      } catch (_) {}
    }
  } catch (_) {}
  return null;
};

const buildPriorityLanCandidates = (netInfo, isMobileClient) => {
  const seen = new Set();
  const candidates = [];
  const add = (urlOrHost) => {
    if (!urlOrHost) return;
    let url = String(urlOrHost).trim().replace(/\/+$/, '');
    if (!url.startsWith('http')) url = `http://${url}:5000`;
    if (!seen.has(url)) {
      seen.add(url);
      candidates.push(url);
    }
  };

  if (Array.isArray(netInfo?.discoveredUrls)) {
    netInfo.discoveredUrls.forEach(add);
  }
  if (netInfo?.gatewayIp) {
    add(`http://${netInfo.gatewayIp}:5000`);
  }

  // Dynamic /24 high-probability offsets around the phone's detected Wi-Fi subnet
  if (netInfo?.subnetPrefix) {
    const p = netInfo.subnetPrefix;
    const priorityOctets = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 25, 50, 100, 101, 102, 103, 105, 110, 150, 200, 250, 254];
    const deviceLast = parseInt((netInfo.deviceIp || '').split('.')[3] || '0', 10);
    if (deviceLast > 0) {
      for (let d = Math.max(1, deviceLast - 8); d <= Math.min(254, deviceLast + 8); d++) {
        if (d !== deviceLast) add(`http://${p}.${d}:5000`);
      }
    }
    priorityOctets.forEach((o) => {
      if (o !== deviceLast) add(`http://${p}.${o}:5000`);
    });
  }

  // Standard Hotspot & Hostel Router fallback defaults
  for (let i = 1; i <= 14; i++) add(`http://172.20.10.${i}:5000`); // iOS Hotspot (/28)
  for (let i = 1; i <= 5; i++) add(`http://192.168.137.${i}:5000`); // Windows Hotspot
  for (let i = 1; i <= 5; i++) add(`http://192.168.43.${i}:5000`); // Android Hotspot
  [1, 2, 3, 4, 5, 10, 100, 101, 102, 105].forEach((o) => {
    add(`http://192.168.1.${o}:5000`);
    add(`http://192.168.0.${o}:5000`);
    add(`http://192.168.29.${o}:5000`);
    add(`http://10.0.0.${o}:5000`);
  });

  if (!isMobileClient) {
    add('http://localhost:5000');
  }

  return { candidates, testedSet: seen };
};

let activeProbePromise = null;

/**
 * Frontend Auto-Healing LAN Discovery & Subnet Scanner
 * Resolution Order:
 * 1. Manual IP verification (if user provided)
 * 2. Cached localStorage IP check + auto-eviction if stale
 * 3. Direct LAN browser origin (if opened directly from Warden IP/hostname)
 * 4. Native Capacitor UDP discovery (port 45678) + Wi-Fi subnet detection (100% offline)
 * 5. Parallel race across native UDP hits + device subnet priority hosts + hotspots + Cloud Registry
 * 6. Full /24 device subnet batched scan when UDP/cloud are blocked (e.g. strict offline router)
 */
export const probeLocalWardenIp = async (manualIp = null) => {
  if (manualIp) {
    const verified = await verifyHostelPing(manualIp, 2000);
    if (verified) {
      setLocalWardenUrl(verified.fullApi);
      return { success: true, url: verified.fullApi, wardenIp: verified.wardenIp };
    }
    return { success: false, reason: 'MANUAL_IP_UNREACHABLE' };
  }

  if (activeProbePromise) {
    return activeProbePromise;
  }

  activeProbePromise = (async () => {
    const isNative = Capacitor.isNativePlatform();
    const isMobileClient = isNative || (typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || ''));

    // 1. Fast Health Verification of cached IP
    const cachedUrl = getLocalWardenUrl();
    if (cachedUrl) {
      const pingRes = await verifyHostelPing(cachedUrl, 1200);
      if (pingRes) {
        return { success: true, url: pingRes.fullApi, wardenIp: pingRes.wardenIp };
      }
      // Auto-Eviction: Cached IP is stale / router changed -> Immediately clear
      clearLocalWardenUrl();
    }

    // 2. Direct Local Host (browser opened directly on Warden LAN URL, e.g. http://172.20.10.2:5000)
    if (!isNative && typeof window !== 'undefined' && window.location.hostname) {
      const host = window.location.hostname;
      if (isPrivateLanHost(host) && !(isMobileClient && (host === 'localhost' || host === '127.0.0.1'))) {
        const originCandidate = window.location.port
          ? `${window.location.protocol}//${host}:${window.location.port}`
          : `${window.location.protocol}//${host}`;
        const directRes = await verifyHostelPing(originCandidate, 1200)
          || await verifyHostelPing(`http://${host}:5000`, 1200);
        if (directRes) {
          setLocalWardenUrl(directRes.fullApi);
          return { success: true, url: directRes.fullApi, wardenIp: directRes.wardenIp };
        }
      }
    }

    // 3. Native Capacitor Path: Run UDP + Wi-Fi-bound Java/Swift socket scan in parallel with Cloud Registry
    //    NEVER floods WebViewLocalServer with dead fetch() probes!
    if (isNative) {
      const nativeDiscoveryPromise = discoverLocalNetworkInfo({ udpPort: 45678, httpPort: 5000, timeoutMs: 4800 })
        .then(async (netInfo) => {
          if (netInfo?.verifiedServer?.fullApi) {
            return netInfo.verifiedServer;
          }
          if (Array.isArray(netInfo?.discoveredUrls) && netInfo.discoveredUrls.length > 0) {
            return await racePingCandidates(netInfo.discoveredUrls, 1400, 3);
          }
          return null;
        });

      const cloudPromise = fetchCloudPublishedWardenUrl();
      try {
        const winner = await Promise.any([
          nativeDiscoveryPromise.then((r) => (r && r.fullApi ? r : Promise.reject(new Error('Miss')))),
          cloudPromise.then((r) => (r && r.fullApi ? r : Promise.reject(new Error('Miss'))))
        ]);
        if (winner?.fullApi) {
          setLocalWardenUrl(winner.fullApi);
          return { success: true, url: winner.fullApi, wardenIp: winner.wardenIp };
        }
      } catch (_) {}

      return { success: false, reason: 'WIFI_ROUTER_CHANGED' };
    }

    // 4. Web Browser Path: Parallel Race between Cloud Registry & capped-concurrency priority LAN probes
    const { candidates: priorityCandidates } = buildPriorityLanCandidates({}, isMobileClient);
    const localPriorityPromise = racePingCandidates(priorityCandidates, 900, 8);
    const cloudPromise = fetchCloudPublishedWardenUrl();

    try {
      const fastWinner = await Promise.any([
        cloudPromise.then((r) => (r ? r : Promise.reject(new Error('Miss')))),
        localPriorityPromise.then((r) => (r ? r : Promise.reject(new Error('Miss'))))
      ]);
      if (fastWinner?.fullApi) {
        setLocalWardenUrl(fastWinner.fullApi);
        return { success: true, url: fastWinner.fullApi, wardenIp: fastWinner.wardenIp };
      }
    } catch (_) {}

    return { success: false, reason: 'WIFI_ROUTER_CHANGED' };
  })();

  try {
    return await activeProbePromise;
  } finally {
    activeProbePromise = null;
  }
};

/**
 * Verifies live reachability to the Hostel Wi-Fi host server (triggers auto-detect if needed).
 */
export const verifyHostWifiConnection = async ({ autoProbe = true } = {}) => {
  const cached = getLocalWardenUrl();
  if (cached) {
    const hit = await verifyHostelPing(cached, 1100);
    if (hit) {
      return { connected: true, url: hit.fullApi, wardenIp: hit.wardenIp };
    }
  }

  if (!Capacitor.isNativePlatform() && typeof window !== 'undefined' && isPrivateLanHost(window.location.hostname)) {
    const directHit = await verifyHostelPing(window.location.origin, 1100)
      || await verifyHostelPing(`http://${window.location.hostname}:5000`, 1100);
    if (directHit) {
      setLocalWardenUrl(directHit.fullApi);
      return { connected: true, url: directHit.fullApi, wardenIp: directHit.wardenIp };
    }
  }

  if (!autoProbe) {
    return { connected: false, url: null, wardenIp: null };
  }

  const probe = await probeLocalWardenIp();
  return probe.success
    ? { connected: true, url: probe.url, wardenIp: probe.wardenIp }
    : { connected: false, url: null, wardenIp: null };
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

  // Capacitor Native App: use local warden if on hostel Wi-Fi, otherwise Cloud fallback
  if (Capacitor.isNativePlatform()) {
    const localWarden = typeof window !== 'undefined' ? localStorage.getItem('hg_local_warden_url') : null;
    if (localWarden) {
      const cleanWarden = localWarden.replace(/\/+$/, '');
      return cleanWarden.endsWith('/api/v1') ? cleanWarden : `${cleanWarden}/api/v1`;
    }
    return getConfiguredCloudBase();
  }

  if (typeof window !== 'undefined' && window.location.hostname.endsWith('onrender.com')) {
    return getConfiguredCloudBase();
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

let activeRefreshPromise = null;

async function performRefreshToken(refreshUrl, refreshToken) {
  if (!activeRefreshPromise) {
    activeRefreshPromise = (async () => {
      try {
        const refreshRes = await fetch(refreshUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken })
        });
        const refreshData = await refreshRes.json().catch(() => ({}));
        if (refreshRes.ok && (refreshData.accessToken || refreshData.token)) {
          const newAccess = refreshData.accessToken || refreshData.token;
          authStorage.setToken(newAccess);
          if (refreshData.refreshToken) {
            authStorage.setRefreshToken(refreshData.refreshToken);
          }
          return true;
        }
        return false;
      } finally {
        activeRefreshPromise = null;
      }
    })();
  }
  return activeRefreshPromise;
}

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

  const cloudBase = getConfiguredCloudBase();

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
      if (isNative) {
        // Verify cached LAN IP via fast native socket first so switched Wi-Fi never stalls WebViewLocalServer
        const liveCheck = await verifyHostelPing(wardenBase, 1200).catch(() => null);
        if (liveCheck?.fullApi) {
          activeUrl = `${liveCheck.fullApi}${endpoint}`;
        } else {
          clearLocalWardenUrl();
          const quickProbe = await probeLocalWardenIp().catch(() => null);
          activeUrl = (quickProbe?.success && quickProbe.url)
            ? `${quickProbe.url}${endpoint}`
            : `${cloudBase}${endpoint}`;
        }
      } else {
        activeUrl = `${wardenBase}${endpoint}`;
      }
    } else if (isDirectLan) {
      activeUrl = primaryUrl;
    } else {
      // On native app offline, probe LAN host first before falling back to Cloud DNS wait
      if (isNative) {
        const quickProbe = await probeLocalWardenIp().catch(() => null);
        if (quickProbe?.success && quickProbe.url) {
          activeUrl = `${quickProbe.url}${endpoint}`;
        } else {
          activeUrl = `${cloudBase}${endpoint}`;
        }
      } else {
        activeUrl = `${cloudBase}${endpoint}`;
      }
    }
  }

  try {
    // 15-second standard timeout for local Wi-Fi and mobile networks to avoid premature aborts
    const defaultTimeout = options.timeout || (endpoint === '/auth/me' ? 8000 : 15000);
    response = await performFetch(activeUrl, defaultTimeout);

    // If Capacitor or a static host returned HTML instead of API JSON, auto-probe Warden LAN host
    const earlyType = (response && response.headers && typeof response.headers.get === 'function')
      ? (response.headers.get('content-type') || '')
      : '';
    if (response.ok && earlyType && !earlyType.includes('application/json')) {
      const htmlRecovery = await probeLocalWardenIp().catch(() => null);
      if (htmlRecovery?.success && htmlRecovery.url) {
        activeUrl = `${htmlRecovery.url}${endpoint}`;
        response = await performFetch(activeUrl, defaultTimeout);
      }
    }
  } catch (networkErr) {
    const activeWardenUrl = typeof window !== 'undefined' ? localStorage.getItem('hg_local_warden_url') : localWarden;
    // Bidirectional resilient failover between Local Warden Server and Cloud:
    if (activeWardenUrl && activeUrl.includes(activeWardenUrl)) {
      const probeRes = await probeLocalWardenIp();
      if (probeRes.success) {
        try {
          const recoveredUrl = `${probeRes.url}${endpoint}`;
          activeUrl = recoveredUrl;
          response = await performFetch(recoveredUrl, options.timeout || 15000);
        } catch (_) {}
      }

      if (!response) {
        try {
          const fallbackUrl = `${cloudBase}${endpoint}`;
          activeUrl = fallbackUrl;
          response = await performFetch(fallbackUrl, options.timeout || 15000);
        } catch (_) {
          throw new Error(
            `Unable to reach Host Wi-Fi server (${activeWardenUrl}) or Cloud. Ensure your device is on the Hostel Wi-Fi.`
          );
        }
      }
    } else if (activeUrl.startsWith(cloudBase) || isDirectLan) {
      const probeRes = await probeLocalWardenIp();
      if (probeRes.success) {
        try {
          const recoveredUrl = `${probeRes.url}${endpoint}`;
          activeUrl = recoveredUrl;
          response = await performFetch(recoveredUrl, options.timeout || 15000);
        } catch (_) {}
      }
      if (!response) {
        throw new Error(
          'Offline: Unable to connect to Host Wi-Fi server. Ensure your device is connected to the Hostel Wi-Fi.'
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
          const refreshBase = activeUrl.endsWith(endpoint)
            ? activeUrl.slice(0, activeUrl.length - endpoint.length)
            : getApiBaseUrl();
          const refreshed = await performRefreshToken(`${refreshBase}/auth/refresh`, refreshToken);
          if (refreshed) {
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
    getFaceUpdateRequests: (status) => request(`/admin/face-update-requests${status ? '?status=' + status : ''}`),
    reviewFaceUpdateRequest: (id, data) => request(`/admin/face-update-requests/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify(data) }),
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
    getFaceUpdateRequests: (status) => request(`/warden/face-update-requests${status ? '?status=' + status : ''}`),
    reviewFaceUpdateRequest: (id, data) => request(`/warden/face-update-requests/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify(data) }),
    getFeedback: () => request('/warden/feedback'),
    respondFeedback: (id, data) => request(`/warden/feedback/${encodeURIComponent(id)}/respond`, { method: 'POST', body: JSON.stringify(data) }),
    getAttendanceLedger: (params = {}) => request(`/warden/attendance-ledger${params.year || params.month ? '?' + new URLSearchParams(params).toString() : ''}`),
    getStudentLedger: (studentId, year) => request(`/warden/student-ledger/${encodeURIComponent(studentId)}${year ? '?year=' + year : ''}`),
    getEmergencyMuster: () => request('/warden/emergency-muster'),
    getPendingPhysicalVerifications: () => request('/warden/pending-physical-verifications'),
    verifyPhysicalAttendance: (data) => request('/warden/verify-physical-attendance', { method: 'POST', body: JSON.stringify(data) })
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
    getFaceUpdateStatus: () => request('/students/face-update-status'),
    requestFaceUpdate: (data) => request('/students/request-face-update', { method: 'POST', body: JSON.stringify(data) }),
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

