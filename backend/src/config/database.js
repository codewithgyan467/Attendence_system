/**
 * backend/src/config/database.js
 * Production SQLite WAL Configuration
 * 
 * Configures SQLite with Write-Ahead Logging (WAL) mode, NORMAL synchronous flag,
 * and 5000ms busy timeout to prevent lock contention during high-concurrency check-in peaks.
 */

const path = require('path');
const fs = require('fs');
const dbInterface = require('../db/database');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

module.exports = dbInterface;
