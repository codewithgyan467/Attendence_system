const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { runQuery, getQuery, checkDatabaseIntegrity, closeSqliteConnection, openSqliteConnection } = require('../db/database');

const DB_PATH = process.env.SQLITE_PATH || path.resolve(__dirname, '../../data/hostel_attendance.sqlite');
const BACKUP_DIR = process.env.BACKUP_DIR || path.resolve(__dirname, '../../data/backups');

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/**
 * Creates a verified SQLite backup using checkpoint + VACUUM INTO / atomic copy
 */
async function createBackup(customBackupPath = null) {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`Database file not found at ${DB_PATH}`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `hostelguard_backup_${timestamp}.sqlite`;
  const targetPath = customBackupPath || path.join(BACKUP_DIR, backupFileName);

  // 1. Flush SQLite Write-Ahead Log (WAL) to main DB file
  try {
    await runQuery('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (walErr) {
    console.warn('WAL checkpoint notice:', walErr.message);
  }

  // 2. Perform atomic vacuum copy or secure copy
  try {
    // If target exists, unlink
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    // VACUUM INTO creates a clean, unfragmented, consistent backup snapshot
    await runQuery(`VACUUM INTO ?;`, [targetPath]);
  } catch (vacErr) {
    // Fallback: file copy if VACUUM INTO is not supported by driver
    fs.copyFileSync(DB_PATH, targetPath);
  }

  // 3. Verify integrity of the newly created backup file
  const integrityOk = await verifyFileIntegrity(targetPath);
  if (!integrityOk) {
    if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
    throw new Error('Created backup file failed PRAGMA integrity_check.');
  }

  const stats = fs.statSync(targetPath);

  return {
    success: true,
    backupFile: path.basename(targetPath),
    backupPath: targetPath,
    sizeBytes: stats.size,
    createdAt: new Date().toISOString(),
    integrity: 'PASS'
  };
}

/**
 * Verifies integrity of any SQLite database file
 */
function verifyFileIntegrity(filePath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) return resolve(false);

    const testDb = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return resolve(false);

      testDb.get('PRAGMA integrity_check;', (intErr, row) => {
        testDb.close();
        if (intErr || !row) return resolve(false);
        const result = Object.values(row)[0];
        resolve(result === 'ok');
      });
    });
  });
}

/**
 * Restores the database from a verified backup file
 */
async function restoreBackup(backupFilePath, targetDbPath = DB_PATH) {
  if (!fs.existsSync(backupFilePath)) {
    throw new Error(`Backup file does not exist: ${backupFilePath}`);
  }

  // 1. Verify backup file integrity before restoring
  const isHealthy = await verifyFileIntegrity(backupFilePath);
  if (!isHealthy) {
    throw new Error('Restore rejected: Backup file is corrupt or failed integrity verification.');
  }

  const isLiveRestore = path.resolve(targetDbPath) === path.resolve(DB_PATH);

  // If restoring to an isolated target (e.g. testing / sandbox inspection)
  if (!isLiveRestore) {
    fs.copyFileSync(backupFilePath, targetDbPath);
    const targetHealthy = await verifyFileIntegrity(targetDbPath);
    if (!targetHealthy) {
      if (fs.existsSync(targetDbPath)) fs.unlinkSync(targetDbPath);
      throw new Error('Restored target database failed PRAGMA integrity_check.');
    }
    return {
      success: true,
      restoredFrom: path.basename(backupFilePath),
      targetPath: targetDbPath,
      integrity: 'PASS',
      restoredAt: new Date().toISOString()
    };
  }

  // 2. Live production restore: Backup current state as safety recovery point
  const emergencyRecoveryPath = `${DB_PATH}.pre_restore_${Date.now()}`;
  if (fs.existsSync(DB_PATH)) {
    fs.copyFileSync(DB_PATH, emergencyRecoveryPath);
  }

  try {
    // Checkpoint existing DB
    try {
      await runQuery('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch (_) {}

    // Close active connection pool to release Windows locks and avoid page-cache corruption
    await closeSqliteConnection();

    // Overwrite database file with verified backup
    fs.copyFileSync(backupFilePath, DB_PATH);

    // Clean up auxiliary WAL/SHM files to prevent stale state
    const walFile = `${DB_PATH}-wal`;
    const shmFile = `${DB_PATH}-shm`;
    try {
      if (fs.existsSync(walFile)) fs.unlinkSync(walFile);
    } catch (_) {
      // Non-blocking
    }
    try {
      if (fs.existsSync(shmFile)) fs.unlinkSync(shmFile);
    } catch (_) {
      // Non-blocking
    }

    // Re-open clean database connection
    await openSqliteConnection();

    // Re-verify restored database integrity
    const restoredIntegrity = await checkDatabaseIntegrity();
    if (restoredIntegrity !== 'ok') {
      throw new Error(`Restored database check returned: ${restoredIntegrity}`);
    }

    // Remove emergency recovery if restore succeeded
    if (fs.existsSync(emergencyRecoveryPath)) {
      fs.unlinkSync(emergencyRecoveryPath);
    }

    return {
      success: true,
      restoredFrom: path.basename(backupFilePath),
      integrity: 'PASS',
      restoredAt: new Date().toISOString()
    };
  } catch (err) {
    // Rollback to emergency recovery file
    try {
      await closeSqliteConnection();
      if (fs.existsSync(emergencyRecoveryPath)) {
        fs.copyFileSync(emergencyRecoveryPath, DB_PATH);
        fs.unlinkSync(emergencyRecoveryPath);
      }
      await openSqliteConnection();
    } catch (_) {}
    throw new Error(`Restore failed: ${err.message}. Rolled back to prior state.`);
  }
}

/**
 * Lists available backups with metadata
 */
function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];

  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.sqlite'));
  return files.map(file => {
    const fullPath = path.join(BACKUP_DIR, file);
    const stats = fs.statSync(fullPath);
    return {
      filename: file,
      sizeBytes: stats.size,
      sizeFormatted: `${(stats.size / 1024).toFixed(1)} KB`,
      createdAt: stats.mtime.toISOString()
    };
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = {
  createBackup,
  restoreBackup,
  listBackups,
  verifyFileIntegrity,
  BACKUP_DIR
};
