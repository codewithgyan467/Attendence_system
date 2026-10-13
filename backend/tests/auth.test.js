const request = require('supertest');
const { app } = require('../src/server');
const { initDatabase } = require('../src/db/database');

beforeAll(async () => {
  await initDatabase();
});

describe('Authentication & Role-Based Access Control (RBAC)', () => {
  let adminToken = '';
  let wardenToken = '';

  test('POST /api/v1/auth/login - Admin authentication succeeds with valid credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'Admin@12345' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.user).toBeDefined();
    expect(res.body.user.role).toBe('ADMIN');
    adminToken = res.body.token;
  });

  test('POST /api/v1/auth/login - Warden authentication succeeds with valid credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'warden', password: 'Warden@12345' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toBe('WARDEN');
    wardenToken = res.body.token;
  });

  test('POST /api/v1/auth/login - Rejects invalid password with 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'WrongPassword999' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/v1/auth/login - Rejects nonexistent username with 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'nonexistent_user', password: 'password123' });

    expect(res.status).toBe(401);
  });

  test('GET /api/v1/auth/me - Returns authenticated user details with Bearer token', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.username).toBe('admin');
  });

  test('GET /api/v1/auth/me - Rejects request with missing token with 401', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  test('GET /api/v1/admin/dashboard-stats - Admin can access admin-scoped endpoint', async () => {
    const res = await request(app)
      .get('/api/v1/admin/dashboard-stats')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary).toBeDefined();
  });

  test('GET /api/v1/admin/dashboard-stats - Warden is rejected from admin-only endpoint with 403', async () => {
    const res = await request(app)
      .get('/api/v1/admin/dashboard-stats')
      .set('Authorization', `Bearer ${wardenToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test('GET /api/v1/warden/overview - Warden can access warden-scoped endpoint', async () => {
    const res = await request(app)
      .get('/api/v1/warden/overview')
      .set('Authorization', `Bearer ${wardenToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary).toBeDefined();
  });
});
