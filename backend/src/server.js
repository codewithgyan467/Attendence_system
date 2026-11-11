require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { v4: uuidv4 } = require('uuid');
const { initDatabase, getQuery } = require('./db/database');
const { generalLimiter } = require('./middleware/rateLimiter');

const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const wardenRoutes = require('./routes/wardenRoutes');
const studentRoutes = require('./routes/studentRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const otaRoutes = require('./routes/otaRoutes');
const wifiClusterRoutes = require('./routes/wifiClusterRoutes');
const wifiRoamingWatcher = require('./utils/wifiRoamingWatcher');

const app = express();
const PORT = process.env.PORT || 5000;

// Security & Header Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allows cross-origin camera/PWA media streaming
  crossOriginEmbedderPolicy: false
}));

// High-Performance Gzip/Brotli Compression for Fast Mobile Loading
app.use(compression());

const defaultOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
  'http://10.0.2.2:5000',
  'https://hostelguard-frontend.onrender.com'
];

const configuredOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : [];

const isProduction = process.env.NODE_ENV === 'production';
const allowAllOrigins = configuredOrigins.includes('*') || (!isProduction && !process.env.ALLOWED_ORIGINS);

function isPrivateSubnetHostname(hostname) {
  if (!hostname) return false;
  const clean = hostname.replace(/^https?:\/\//, '').split(':')[0].trim();
  if (clean === 'localhost' || clean === '127.0.0.1' || clean === '::1') return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(clean)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(clean)) return true;
  const m172 = clean.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (m172) {
    const octet = parseInt(m172[1], 10);
    if (octet >= 16 && octet <= 31) return true;
  }
  return false;
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. mobile native apps, curl, postman)
    if (!origin) return callback(null, true);
    if (allowAllOrigins) return callback(null, true);

    try {
      const url = new URL(origin);
      const hostname = url.hostname;
      if (
        isPrivateSubnetHostname(hostname) ||
        hostname.endsWith('.onrender.com') ||
        hostname.endsWith('.vercel.app') ||
        origin.startsWith('capacitor://') ||
        origin.startsWith('http://localhost') ||
        origin.startsWith('https://localhost') ||
        configuredOrigins.includes(origin) ||
        defaultOrigins.includes(origin)
      ) {
        return callback(null, true);
      }
    } catch (_) {
      if (origin.includes('localhost') || origin.startsWith('capacitor://')) {
        return callback(null, true);
      }
    }
    // Allow private subnets even without valid URL parse
    if (isPrivateSubnetHostname(origin)) {
      return callback(null, true);
    }
    return callback(null, true); // Safe fallback: allow all LAN & web clients
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-Request-Id',
    'X-Device-Id',
    'X-Device-Model',
    'X-Hostel-Ble-Token',
    'X-Hostel-Lan-Verified'
  ]
}));

// Chrome Private Network Access (PNA) Support & Preflight OPTIONS Handler
app.use((req, res, next) => {
  if (req.headers['access-control-request-private-network']) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Request-Id, X-Device-Id, X-Device-Model, X-Hostel-Ble-Token, X-Hostel-Lan-Verified');
    if (req.headers['access-control-request-private-network']) {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    return res.sendStatus(204);
  }
  next();
});

// Request Tracking & Structured Logging
app.use((req, res, next) => {
  req.id = uuidv4();
  res.setHeader('X-Request-Id', req.id);
  next();
});

// Large Payload limit for Base64 facial captures
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Apply General Rate Limiter to API routes
app.use('/api', generalLimiter);

// Health Check Endpoint
app.get('/health', async (req, res) => {
  try {
    const dbTest = await getQuery(`SELECT 1 as alive`);
    res.json({
      status: 'healthy',
      service: 'Smart Hostel Attendance Enterprise Core',
      database: dbTest?.alive === 1 ? 'connected' : 'error',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});

// Lightweight Keepalive Endpoint (< 1ms RAM response to prevent Render free-tier cold sleep)
app.get(['/api/v1/health/keepalive', '/health/keepalive'], (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// System Observability & Biometric Engine Health Endpoint
app.get(['/api/v1/system/version', '/system/version'], (req, res) => {
  const isTurso = Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
  res.json({
    version: 'v4.2.0-master',
    status: 'ONLINE',
    persistence_mode: isTurso ? 'TURSO_PERSISTENT_CLOUD' : 'LOCAL_EPHEMERAL_SQLITE',
    is_persistent: isTurso,
    models: {
      face_detection: 'OpenCV_YuNet_2023mar',
      face_recognition: 'OpenCV_SFace_128D',
      anti_spoofing: 'MiniFASNetV2_DeepPAD'
    },
    timestamp: new Date().toISOString()
  });
});

// Fast Ping-Hostel Discovery Endpoint (Task 1 requirement: <2ms response, zero cache)
app.get(['/api/v1/ping-hostel', '/ping-hostel'], (req, res) => {
  const currentIp = wifiRoamingWatcher.getCurrentLanIp();
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json({
    status: 'ok',
    wardenIp: currentIp,
    port: Number(PORT),
    fullUrl: `http://${currentIp}:${PORT}/api/v1`,
    timestamp: Date.now()
  });
});

// Cloud LAN Discovery Registry (Allows Warden laptop to register current LAN IP, and students to discover it)
app.get(['/api/v1/lan-discovery', '/lan-discovery'], async (req, res) => {
  const geofence = await getQuery(`SELECT local_warden_url FROM geofence_configs WHERE is_active = 1 LIMIT 1`).catch(() => null);
  const currentIp = wifiRoamingWatcher.getCurrentLanIp();
  const wardenUrl = global.wardenLanApiUrl || geofence?.local_warden_url || `http://${currentIp}:${PORT}/api/v1`;
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json({
    success: true,
    wardenIp: currentIp,
    port: Number(PORT),
    wardenLanApiUrl: wardenUrl,
    local_warden_url: wardenUrl,
    timestamp: Date.now()
  });
});

app.post(['/api/v1/lan-discovery', '/lan-discovery'], async (req, res) => {
  try {
    const expectedKey = process.env.LAN_SYNC_KEY || 'hostelguard-internal-sync';
    const providedKey = req.headers['x-lan-sync-key'];
    if (providedKey !== expectedKey) {
      return res.status(403).json({ success: false, error: 'Unauthorized: Invalid LAN sync credentials.' });
    }

    const { wardenIp, port = 5000, fullUrl } = req.body;
    if (!wardenIp && !fullUrl) {
      return res.status(400).json({ success: false, error: 'wardenIp or fullUrl required' });
    }
    const cleanIp = wardenIp || (fullUrl ? new URL(fullUrl).hostname : '127.0.0.1');

    if (!isPrivateSubnetHostname(cleanIp)) {
      return res.status(400).json({ success: false, error: 'Target IP must be a valid private hostel subnet or localhost address.' });
    }

    const targetUrl = fullUrl || `http://${cleanIp}:${port}/api/v1`;
    global.wardenIp = cleanIp;
    global.wardenLanApiUrl = targetUrl;

    const { runQuery } = require('./db/database');
    await runQuery(`UPDATE geofence_configs SET local_warden_url = ? WHERE is_active = 1`, [targetUrl]).catch(() => {});
    await runQuery(`
      INSERT INTO system_settings (setting_key, setting_value, updated_at)
      VALUES ('warden_lan_api_url', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
    `, [targetUrl]).catch(() => {});

    console.log(`📡 [Cloud Registry] Updated Warden LAN IP: ${targetUrl}`);
    res.json({ success: true, message: 'Warden LAN IP updated in Cloud Registry', wardenLanApiUrl: targetUrl });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Mount Domain Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/warden', wardenRoutes);
app.use('/api/v1/students', studentRoutes);
app.use('/api/v1/attendance', attendanceRoutes);
app.use('/api/v1/ota', otaRoutes);
app.use(['/api/v1/admin/wifi-cluster', '/api/admin/wifi-cluster'], wifiClusterRoutes);


// Serve Frontend Static Assets if built
const frontendDistPath = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    }
  }));
  app.get('*', (req, res, next) => {
    if (
      req.originalUrl.startsWith('/api') ||
      req.originalUrl.startsWith('/health') ||
      req.originalUrl.startsWith('/uploads')
    ) {
      return next();
    }
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

// Centralized 404 Handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Endpoint not found: ${req.method} ${req.originalUrl}` });
});

// Centralized Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(`[Error] Request ID ${req.id || 'N/A'}:`, err);
  const status = err.status || 500;
  const message = process.env.NODE_ENV === 'production' && status === 500
    ? 'Internal Server Error'
    : err.message || 'Internal Server Error';

  res.status(status).json({ success: false, error: message, requestId: req.id });
});

// Auto-Launch Python AI microservice if not already running
const { spawn } = require('child_process');
const aiServiceClient = require('./services/aiServiceClient');

let aiProcess = null;

async function ensureAiServiceRunning() {
  try {
    const health = await aiServiceClient.checkHealth();
    if (health.ok) {
      console.log('🧠 Python AI Microservice already active on port 8000.');
      return;
    }
  } catch (_) {}

  const aiDir = path.join(__dirname, '../ai_service');
  console.log('🧠 Auto-launching Python AI Microservice (OpenCV YuNet & SFace)...');

  // Resolve Python binary cleanly without shell: true to prevent DEP0190 warning
  const venvPythonWin = path.join(aiDir, 'venv', 'Scripts', 'python.exe');
  const venvPythonUnix = path.join(aiDir, 'venv', 'bin', 'python');
  let pythonCmd = 'python';
  if (process.platform === 'win32' && fs.existsSync(venvPythonWin)) {
    pythonCmd = venvPythonWin;
  } else if (process.platform !== 'win32' && fs.existsSync(venvPythonUnix)) {
    pythonCmd = venvPythonUnix;
  }

  aiProcess = spawn(pythonCmd, ['run.py'], {
    cwd: aiDir,
    stdio: 'inherit'
  });

  aiProcess.on('error', (err) => {
    console.warn('Could not auto-spawn Python AI service:', err.message);
  });

  const cleanup = () => {
    if (aiProcess) {
      try { aiProcess.kill(); } catch (_) {}
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(); });
  process.on('SIGTERM', () => { cleanup(); process.exit(); });
}

// Process Level Crash Shields
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ [Process Unhandled Rejection]:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ [Process Uncaught Exception]:', err);
});

// Start Server
async function startServer() {
  try {
    await initDatabase();
    await ensureAiServiceRunning();
    try {
      const localVaultDb = require('./config/localVaultDb');
      const { allQuery, getQuery } = require('./db/database');
      await localVaultDb.openVaultDb();
      await localVaultDb.loadEmbeddingCache();

      // Auto-Prepare Offline Cache on Startup (pull latest students & beacons into vault)
      localVaultDb.prepareOfflineCache({ allQuery, getQuery })
        .then((res) => {
          console.log(`⚡ [AutoVault] Startup cache ready: ${res.cachedStudentsCount} students, ${res.cachedBeaconsCount} beacons, ${res.ramVectorsCount} RAM vectors.`);
        })
        .catch((err) => {
          console.warn('⚠️ [AutoVault] Offline startup preload notice:', err.message);
        });
    } catch (vaultErr) {
      console.warn('⚠️ [StrictVault] Local SQLite vault initialization notice:', vaultErr.message);
    }

    // Dynamic Wi-Fi Roaming Watcher & Real-Time Cloud LAN Sync (5-second polling loop)
    try {
      const { runQuery } = require('./db/database');
      const lanUrl = wifiRoamingWatcher.startRoamingWatcher(PORT, { runQuery });
      console.log(`📡 [LAN Discovery & Roaming] Active Warden Address: ${lanUrl}`);
    } catch (lanErr) {
      console.warn('⚠️ [LAN Discovery] Notice:', lanErr.message);
    }

    // Background Auto-Sync: Automatically sync offline attendance & strikes to cloud every 30 seconds
    const THIRTY_SECONDS_MS = 30 * 1000;
    let isVaultSyncing = false;
    setInterval(async () => {
      if (isVaultSyncing) return;
      try {
        isVaultSyncing = true;
        const localVaultDb = require('./config/localVaultDb');
        const { runQuery, getQuery, withTransaction } = require('./db/database');
        const res = await localVaultDb.syncVaultToCloud({ runQuery, getQuery, withTransaction });
        if (res && (res.syncedAttendanceCount > 0 || res.syncedStrikesCount > 0)) {
          console.log(`☁️ [AutoSync] Background synced to Cloud: ${res.syncedAttendanceCount} attendance records, ${res.syncedStrikesCount} strikes.`);
        }
      } catch (_) {
        // Silent catch for offline LAN operation
      } finally {
        isVaultSyncing = false;
      }
    }, THIRTY_SECONDS_MS);

    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`=======================================================`);
      console.log(`🚀 Smart Hostel Attendance Enterprise Backend is LIVE!`);
      console.log(`📡 URL: http://localhost:${PORT}`);
      console.log(`💎 Stack: Node.js + Express + SQLite (WAL) + Python OpenCV AI`);
      console.log(`=======================================================`);

      // Automatic Anti-Spin-Down Keep-Alive for Cloud / Render Free Tier
      const isCloudEnv = process.env.RENDER || process.env.NODE_ENV === 'production' || process.env.ENABLE_KEEP_ALIVE === 'true';
      const keepAliveUrl = process.env.KEEP_ALIVE_URL ||
        (process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL}/health` : 'https://hostelguard-backend-oimp.onrender.com/health');

      if (isCloudEnv && keepAliveUrl) {
        const TEN_MINUTES_MS = 10 * 60 * 1000;
        setInterval(() => {
          fetch(keepAliveUrl, { headers: { 'User-Agent': 'HostelGuard-KeepAlive-Worker/1.0' } })
            .then((r) => r.json())
            .then((data) => {
              console.log(`[Keep-Alive Ping] Server pulse healthy at ${new Date().toLocaleTimeString()} (status: ${data.status})`);
            })
            .catch((pingErr) => {
              console.warn('[Keep-Alive Ping Notice]', pingErr.message);
            });
        }, TEN_MINUTES_MS);
        console.log(`🛡️ Anti-spin-down keep-alive active: pinging ${keepAliveUrl} every 10 minutes`);
      }
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use by another process.`);
      } else {
        console.error('❌ Server error:', err);
      }
    });

    // Graceful Shutdown
    const handleShutdown = (signal) => {
      console.log(`Received ${signal}. Shutting down gracefully...`);
      server.close(() => {
        console.log('HTTP server closed.');
        if (aiProcess) {
          try { aiProcess.kill(); } catch (_) {}
        }
        process.exit(0);
      });
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));

    return server;
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
