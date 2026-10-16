const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { app } = require('../src/server');
const { initDatabase, runQuery, getQuery, allQuery } = require('../src/db/database');
const backupService = require('../src/services/backupService');

let adminToken = '';
const createdTestBackups = [];

beforeAll(async () => {
  await initDatabase();

  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ username: 'admin', password: 'Admin@12345' });
  adminToken = loginRes.body.token;
});

afterAll(async () => {
  // Clean up any test backup files
  for (const f of createdTestBackups) {
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch (_) {}
    }
  }
});

describe('Database Backup, Integrity & Restoration Suite (Section 31 Certification)', () => {
  let backupFileSnapshot = null;

  test('Step 1: Backup created with valid SQLite WAL flush', async () => {
    const res = await backupService.createBackup();
    expect(res).toBeDefined();
    expect(res.success).toBe(true);
    expect(res.integrity).toBe('PASS');
    expect(res.sizeBytes).toBeGreaterThan(1000);
    expect(fs.existsSync(res.backupPath)).toBe(true);

    backupFileSnapshot = res.backupPath;
    createdTestBackups.push(res.backupPath);
  });

  test('Step 2: Backup integrity is checked and valid', async () => {
    expect(backupFileSnapshot).toBeTruthy();
    const isHealthy = await backupService.verifyFileIntegrity(backupFileSnapshot);
    expect(isHealthy).toBe(true);
  });

  test('Step 3: Isolated restore performed and database opens with all tables preserved', async () => {
    const testRestorePath = path.join(backupService.BACKUP_DIR, `test_restore_${Date.now()}.sqlite`);
    createdTestBackups.push(testRestorePath);

    // Baseline counts from primary DB
    const origUsers = await allQuery('SELECT * FROM users');
    const origStudents = await allQuery('SELECT * FROM students');
    const origAttendance = await allQuery('SELECT * FROM attendance_records');
    const origAuditLogs = await allQuery('SELECT * FROM admin_audit_events');
    const origGeofence = await allQuery('SELECT * FROM geofence_configs');

    // Perform restore to isolated target
    const restoreRes = await backupService.restoreBackup(backupFileSnapshot, testRestorePath);
    expect(restoreRes.success).toBe(true);
    expect(restoreRes.integrity).toBe('PASS');
    expect(fs.existsSync(testRestorePath)).toBe(true);

    // Verify restored database opens and all records are preserved
    const sqlite3 = require('sqlite3').verbose();
    const restoredDb = new sqlite3.Database(testRestorePath, sqlite3.OPEN_READONLY);

    const queryAsync = (sql) => new Promise((resolve, reject) => {
      restoredDb.all(sql, (err, rows) => err ? reject(err) : resolve(rows));
    });

    const resUsers = await queryAsync('SELECT * FROM users');
    const resStudents = await queryAsync('SELECT * FROM students');
    const resAttendance = await queryAsync('SELECT * FROM attendance_records');
    const resAuditLogs = await queryAsync('SELECT * FROM admin_audit_events');
    const resGeofence = await queryAsync('SELECT * FROM geofence_configs');

    restoredDb.close();

    // Verify preservation
    expect(resUsers.length).toBe(origUsers.length);
    expect(resStudents.length).toBe(origStudents.length);
    expect(resAttendance.length).toBe(origAttendance.length);
    expect(resAuditLogs.length).toBe(origAuditLogs.length);
    expect(resGeofence.length).toBe(origGeofence.length);
  });

  test('Step 4: Restore rejects corrupt or truncated backup files', async () => {
    const corruptFile = path.join(backupService.BACKUP_DIR, `corrupt_test_${Date.now()}.sqlite`);
    fs.writeFileSync(corruptFile, 'NOT_A_VALID_SQLITE_DATABASE_HEADER');
    createdTestBackups.push(corruptFile);

    const testTargetPath = path.join(backupService.BACKUP_DIR, `target_${Date.now()}.sqlite`);
    createdTestBackups.push(testTargetPath);

    await expect(backupService.restoreBackup(corruptFile, testTargetPath)).rejects.toThrow(
      /Backup file is corrupt or failed integrity verification/
    );
  });

  test('Step 5: Admin API endpoint creates backup and logs audit event', async () => {
    const apiRes = await request(app)
      .post('/api/v1/admin/backup/create')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(apiRes.status).toBe(200);
    expect(apiRes.body.success).toBe(true);
    expect(apiRes.body.backup.integrity).toBe('PASS');

    if (apiRes.body.backup?.backupPath) {
      createdTestBackups.push(apiRes.body.backup.backupPath);
    }

    // Verify audit log entry was created
    const log = await getQuery(`
      SELECT * FROM admin_audit_events 
      WHERE action = 'CREATE_DATABASE_BACKUP' 
      ORDER BY created_at DESC 
      LIMIT 1
    `);
    expect(log).toBeDefined();
    expect(log.details).toContain('Created verified backup');
  });
});
