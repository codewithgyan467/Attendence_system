const request = require('supertest');
const { app } = require('../src/server');
const { initDatabase, getQuery, runQuery } = require('../src/db/database');
const bcrypt = require('bcryptjs');

beforeAll(async () => {
  await initDatabase();
  await runQuery('DELETE FROM password_reset_otps');
});

describe('Student Password Reset System (Email & Phone OTP)', () => {
  let adminToken = '';
  let otpCode = '';
  let resetToken = '';

  beforeAll(async () => {
    await runQuery('DELETE FROM password_reset_otps');
    await runQuery("DELETE FROM users WHERE username IN ('2023CS01', '2023CS02')");
    await runQuery("DELETE FROM students WHERE roll_number IN ('2023CS01', '2023CS02')");
    await runQuery("DELETE FROM hostel_allotments WHERE roll_number IN ('2023CS01', '2023CS02')");

    const salt = await bcrypt.genSalt(10);
    const passHash = await bcrypt.hash('Student@12345', salt);

    await runQuery(`
      INSERT INTO users (id, username, email, password_hash, role, student_id, is_active, must_change_password)
      VALUES
        ('user-test-cs01', '2023CS01', 'aarav.sharma@student.hostel.local', ?, 'STUDENT', 'HSTL-2023-2023CS01', 1, 0),
        ('user-test-cs02', '2023CS02', 'ananya.patel@student.hostel.local', ?, 'STUDENT', 'HSTL-2023-2023CS02', 1, 0)
    `, [passHash, passHash]);

    await runQuery(`
      INSERT INTO students (id, user_id, roll_number, full_name, email, phone, course, admission_year, semester, room_number, hostel_block, device_id, device_model, is_active)
      VALUES
        ('HSTL-2023-2023CS01', 'user-test-cs01', '2023CS01', 'Aarav Sharma', 'aarav.sharma@student.hostel.local', '+919876543210', 'B.Tech CS', 2023, 4, 'A-101', 'Block A', 'DEV-2023cs01', 'Samsung A54', 1),
        ('HSTL-2023-2023CS02', 'user-test-cs02', '2023CS02', 'Ananya Patel', 'ananya.patel@student.hostel.local', '+919876543211', 'B.Tech CS', 2023, 4, 'A-102', 'Block A', 'DEV-2023cs02', 'iPhone 13', 1)
    `);

    // Obtain admin token for admin credentials endpoint
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'Admin@12345' });
    adminToken = res.body.token;
  });

  afterAll(async () => {
    await runQuery('DELETE FROM password_reset_otps');
    await runQuery("DELETE FROM students WHERE roll_number IN ('2023CS01', '2023CS02')");
    await runQuery("DELETE FROM users WHERE username IN ('2023CS01', '2023CS02')");
  });

  test('POST /api/v1/auth/forgot-password/request-otp - Rejects empty identifier with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password/request-otp')
      .send({ identifier: '' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/v1/auth/forgot-password/request-otp - Rejects unknown identity with 404', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password/request-otp')
      .send({ identifier: 'UNKNOWN_ROLL_99999' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/v1/auth/forgot-password/request-otp - Successfully dispatches Email OTP for student 2023CS01', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password/request-otp')
      .send({ identifier: '2023CS01', method: 'EMAIL' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.method).toBe('EMAIL');
    expect(res.body.maskedDestination).toBeDefined();
    expect(res.body.debugOtp).toBeDefined();
    expect(res.body.debugOtp.length).toBe(6);
    otpCode = res.body.debugOtp;
  });

  test('POST /api/v1/auth/forgot-password/verify-otp - Rejects incorrect OTP with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password/verify-otp')
      .send({ identifier: '2023CS01', otp: '000000' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/v1/auth/forgot-password/verify-otp - Verifies correct OTP and returns signed reset token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password/verify-otp')
      .send({ identifier: '2023CS01', otp: otpCode });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.resetToken).toBeDefined();
    resetToken = res.body.resetToken;
  });

  test('POST /api/v1/auth/forgot-password/reset - Rejects passwords shorter than 8 characters', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password/reset')
      .send({ resetToken, new_password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/v1/auth/forgot-password/reset - Successfully resets password with valid token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password/reset')
      .send({
        resetToken,
        new_password: 'TestNewPassword@123',
        confirm_password: 'TestNewPassword@123'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify login with new password
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: '2023CS01', password: 'TestNewPassword@123' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);
    expect(loginRes.body.token).toBeDefined();
  });

  test('POST /api/v1/auth/forgot-password/request-otp - Successfully dispatches Phone SMS OTP for student 2023CS02', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password/request-otp')
      .send({ identifier: '2023CS02', method: 'PHONE' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.method).toBe('PHONE');
    expect(res.body.maskedDestination).toBeDefined();
    expect(res.body.debugOtp).toBeDefined();
  });

  test('GET /api/v1/admin/credentials-directory - Returns directory of staff, students, and default credentials', async () => {
    const res = await request(app)
      .get('/api/v1/admin/credentials-directory')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.directory).toBeDefined();
    expect(res.body.directory.staff.length).toBeGreaterThan(0);
    expect(res.body.directory.students.length).toBeGreaterThan(0);
  });

  test('POST /api/v1/admin/students/:id/reset-password - Admin resets student password to default', async () => {
    const res = await request(app)
      .post('/api/v1/admin/students/2023CS01/reset-password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ new_password: 'Student@12345', reason: 'Automated test recovery' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify student can log in with reset password Student@12345
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: '2023CS01', password: 'Student@12345' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);
  });

  test('POST /api/v1/auth/forgot-password/phone-email-verify - Successfully authenticates phone via Phone.Email model', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password/phone-email-verify')
      .send({
        identifier: '2023CS01',
        simulated_phone: '+919876543210'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.resetToken).toBeDefined();
    expect(res.body.identifier).toBe('2023CS01');
  });

  test('POST /api/v1/auth/forgot-password/verify-magic-link - Successfully verifies valid email magic link token', async () => {
    // 1. Request email OTP to generate magic link
    const reqRes = await request(app)
      .post('/api/v1/auth/forgot-password/request-otp')
      .send({ identifier: '2023CS02', method: 'EMAIL' });

    expect(reqRes.status).toBe(200);
    expect(reqRes.body.magicLinkUrl).toBeDefined();

    // 2. Extract token
    const url = new URL(reqRes.body.magicLinkUrl);
    const token = url.searchParams.get('token');
    expect(token).toBeDefined();

    // 3. Verify magic link
    const verifyRes = await request(app)
      .post('/api/v1/auth/forgot-password/verify-magic-link')
      .send({ token });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.success).toBe(true);
    expect(verifyRes.body.identifier).toBe('2023CS02');
    expect(verifyRes.body.resetToken).toBe(token);
  });

  test('POST /api/v1/auth/phone-login - Rejects request with missing phone/json url with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/phone-login')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/v1/auth/phone-login - Rejects unregistered phone number with 404', async () => {
    const res = await request(app)
      .post('/api/v1/auth/phone-login')
      .send({ simulated_phone: '+919999988888' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/v1/auth/phone-login - Successfully logs in student via verified phone number', async () => {
    const res = await request(app)
      .post('/api/v1/auth/phone-login')
      .send({ simulated_phone: '+919876543210' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.user).toBeDefined();
    expect(res.body.user.username).toBe('2023CS01');
    expect(res.body.user.role).toBe('STUDENT');
  });

  test('POST /api/v1/auth/otp-login/request & verify - Direct OTP authentication without first or last name', async () => {
    // 1. Request OTP using student roll number
    const reqRes = await request(app)
      .post('/api/v1/auth/otp-login/request')
      .send({ identifier: '2023CS01', method: 'SMS' });

    expect(reqRes.status).toBe(200);
    expect(reqRes.body.success).toBe(true);
    expect(reqRes.body.maskedDestination).toBeDefined();

    const { debugOtp } = reqRes.body;
    expect(debugOtp).toBeDefined();
    expect(debugOtp).toHaveLength(6);

    // 2. Verify OTP directly without supplying any name
    const verifyRes = await request(app)
      .post('/api/v1/auth/otp-login/verify')
      .send({ identifier: '2023CS01', otp: debugOtp });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.success).toBe(true);
    expect(verifyRes.body.token).toBeDefined();
    expect(verifyRes.body.user).toBeDefined();
    expect(verifyRes.body.user.username).toBe('2023CS01');
  });
});

