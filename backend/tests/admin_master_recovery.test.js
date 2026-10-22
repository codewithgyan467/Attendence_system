const request = require('supertest');
const { app } = require('../src/server');
const { initDatabase, getQuery } = require('../src/db/database');
const { getActiveRecoveryKeyMetadata } = require('../src/services/recoveryService');

describe('Master Recovery Key & Administrator Security Desk API', () => {
  let adminToken = null;

  beforeAll(async () => {
    await initDatabase();

    // Login as default admin
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'Admin@12345' });

    if (loginRes.body.token || loginRes.body.accessToken) {
      adminToken = loginRes.body.accessToken || loginRes.body.token;
    }
  });

  test('GET /api/v1/admin/security/profile returns admin metadata and recovery key hint', async () => {
    const res = await request(app)
      .get('/api/v1/admin/security/profile')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user).toHaveProperty('username');
    expect(res.body.user).toHaveProperty('email');
    expect(res.body.recoveryKey).toBeDefined();
    expect(res.body.recoveryKey).toHaveProperty('hint');
  });

  test('POST /api/v1/admin/security/regenerate-master-key generates a valid formatted master key', async () => {
    const res = await request(app)
      .post('/api/v1/admin/security/regenerate-master-key')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ current_password: 'Admin@12345' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.masterRecoveryKey).toMatch(/^HG-MASTER-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);

    const generatedKey = res.body.masterRecoveryKey;

    // Verify key works with /api/v1/auth/master-recovery/verify
    const verifyRes = await request(app)
      .post('/api/v1/auth/master-recovery/verify')
      .send({ master_key: generatedKey });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.success).toBe(true);
  });

  test('POST /api/v1/auth/master-recovery/reset resets admin credentials when given valid master key', async () => {
    // Generate fresh key
    const regenRes = await request(app)
      .post('/api/v1/admin/security/regenerate-master-key')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ current_password: 'Admin@12345' });

    const keyToUse = regenRes.body.masterRecoveryKey;

    // Execute emergency reset
    const resetRes = await request(app)
      .post('/api/v1/auth/master-recovery/reset')
      .send({
        master_key: keyToUse,
        new_username: 'super_warden_test',
        new_email: 'warden.new@testcollege.edu',
        new_password: 'SuperSecurePass@2026'
      });

    expect(resetRes.status).toBe(200);
    expect(resetRes.body.success).toBe(true);
    expect(resetRes.body.newMasterRecoveryKey).toBeDefined();

    // Verify old credentials fail
    const oldLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'Admin@12345' });
    expect(oldLogin.status).toBe(401);

    // Verify new credentials succeed
    const newLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'super_warden_test', password: 'SuperSecurePass@2026' });

    expect(newLogin.status).toBe(200);
    expect(newLogin.body.user.username).toBe('super_warden_test');
    expect(newLogin.body.user.email).toBe('warden.new@testcollege.edu');

    // Reset back to admin / Admin@12345 for other test suites
    const revertRes = await request(app)
      .post('/api/v1/auth/master-recovery/reset')
      .send({
        master_key: resetRes.body.newMasterRecoveryKey,
        new_username: 'admin',
        new_email: 'admin@hostelguard.local',
        new_password: 'Admin@12345'
      });
    expect(revertRes.status).toBe(200);
  });
});
