require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');
const { initDatabase, getQuery } = require('./db/database');
const { generalLimiter } = require('./middleware/rateLimiter');

const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const wardenRoutes = require('./routes/wardenRoutes');
const studentRoutes = require('./routes/studentRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const otaRoutes = require('./routes/otaRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Security & Header Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allows cross-origin camera/PWA media streaming
  crossOriginEmbedderPolicy: false
}));

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

const allowAllOrigins = configuredOrigins.includes('*') || !process.env.ALLOWED_ORIGINS;

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. mobile apps, curl)
    if (!origin) return callback(null, true);
    // If wildcard configured or in development mode
    if (allowAllOrigins || process.env.NODE_ENV !== 'production') return callback(null, true);
    // If matching configured origins, defaults, or any onrender.com host
    if (
      configuredOrigins.includes(origin) ||
      defaultOrigins.includes(origin) ||
      origin.endsWith('.onrender.com') ||
      origin.includes('localhost')
    ) {
      return callback(null, true);
    }
    return callback(new Error(`Blocked by CORS policy: Origin '${origin}' is not authorized.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-Id']
}));

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

// Mount Domain Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/warden', wardenRoutes);
app.use('/api/v1/students', studentRoutes);
app.use('/api/v1/attendance', attendanceRoutes);
app.use('/api/v1/ota', otaRoutes);

// Serve Frontend Static Assets if built
const frontendDistPath = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
  app.get('*', (req, res, next) => {
    if (
      req.originalUrl.startsWith('/api') ||
      req.originalUrl.startsWith('/health') ||
      req.originalUrl.startsWith('/uploads')
    ) {
      return next();
    }
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
  aiProcess = spawn('python', ['run.py'], {
    cwd: aiDir,
    stdio: 'inherit',
    shell: true
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

    const server = app.listen(PORT, () => {
      console.log(`=======================================================`);
      console.log(`🚀 Smart Hostel Attendance Enterprise Backend is LIVE!`);
      console.log(`📡 URL: http://localhost:${PORT}`);
      console.log(`💎 Stack: Node.js + Express + SQLite (WAL) + Python OpenCV AI`);
      console.log(`=======================================================`);
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
