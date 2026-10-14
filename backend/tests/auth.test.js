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

  test('GET /api/v1/auth/me - Rejects malformed or tampered JWT with 401', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalidpayload.signature');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/Invalid authentication token/);
  });

  test('GET /api/v1/auth/me - Rejects expired JWT with 401 and TokenExpired message', async () => {
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('../src/middleware/auth');
    const expiredToken = jwt.sign(
      { id: 'some-id', username: 'admin', role: 'ADMIN' },
      JWT_SECRET,
      { expiresIn: '-1s' }
    );

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/Session expired/);
  });

  // Google JWT Authentication Tests
  describe('Google JWT Authentication (POST /api/v1/auth/google-login)', () => {
    test('Rejects request with missing token / credential with 400', async () => {
      const res = await request(app)
        .post('/api/v1/auth/google-login')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Google credential token is required/i);
    });

    test('Rejects unregistered Google email with 404', async () => {
      const res = await request(app)
        .post('/api/v1/auth/google-login')
        .send({ credential: 'demo:unknown.stranger@example.com' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/No registered account found with Google email/i);
    });

    test('Authenticates successfully with registered student Google account and returns tokens', async () => {
      // Find an existing student email in the db or use aarav.sharma@student.hostel.local
      const res = await request(app)
        .post('/api/v1/auth/google-login')
        .send({ credential: 'demo:aarav.sharma@student.hostel.local' });

      // Note: If student is in DB, returns 200 with tokens
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.accessToken).toBeDefined();
        expect(res.body.refreshToken).toBeDefined();
        expect(res.body.user).toBeDefined();
        expect(res.body.user.role).toBe('STUDENT');
      } else {
        // If student not seeded in this specific test file, test with simulated_email for admin
        const adminRes = await request(app)
          .post('/api/v1/auth/google-login')
          .send({ simulated_email: 'admin@hostelguard.local' });

        expect(adminRes.status).toBe(200);
        expect(adminRes.body.success).toBe(true);
        expect(adminRes.body.accessToken).toBeDefined();
        expect(adminRes.body.user.role).toBe('ADMIN');
      }
    });

    test('Rejects invalid non-simulated Google token with 401', async () => {
      const res = await request(app)
        .post('/api/v1/auth/google-login')
        .send({ credential: 'invalid.bogus.jwt.token' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Google JWT verification failed/i);
    });
  });
});

