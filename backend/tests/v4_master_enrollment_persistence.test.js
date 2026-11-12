const request = require('supertest');
const { app } = require('../src/server');
const { runQuery, getQuery } = require('../src/db/database');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

describe('HostelGuard Master Fix: Permanent Biometric Face Enrollment & Persistence', () => {
  let studentId;
  let rollNumber;
  let studentToken;
  let userId;

  beforeAll(async () => {
    rollNumber = `PERM_${Date.now().toString().slice(-6)}`;
    studentId = `HSTL-2026-${rollNumber}`;
    userId = uuidv4();

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('Student@12345', salt);

    // Seed test user
    await runQuery(`
      INSERT INTO users (id, username, email, password_hash, role, student_id, is_active)
      VALUES (?, ?, ?, ?, 'STUDENT', ?, 1)
    `, [userId, rollNumber, `${rollNumber.toLowerCase()}@test.hostel.local`, passwordHash, studentId]);

    // Seed test student WITHOUT initial face embeddings, explicit version 0
    await runQuery(`
      INSERT INTO students (
        id, user_id, roll_number, full_name, email, course, admission_year, semester,
        hostel_block, room_number, device_id, is_active, face_enrollment_status, face_enrolled_version
      ) VALUES (?, ?, ?, 'Permanent Enrollment Student', ?, 'B.Tech CSE', 2026, 4, 'Block B', 'B-204', 'DEV-PERM-01', 1, 'NOT_ENROLLED', 0)
    `, [studentId, userId, rollNumber, `${rollNumber.toLowerCase()}@test.hostel.local`]);

    // Login to acquire auth token
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: rollNumber, password: 'Student@12345' });

    expect(loginRes.status).toBe(200);
    studentToken = loginRes.body.token;
  });

  afterAll(async () => {
    await runQuery(`DELETE FROM face_update_requests WHERE student_id = ?`, [studentId]);
    await runQuery(`DELETE FROM student_face_embeddings WHERE student_id = ?`, [studentId]);
    await runQuery(`DELETE FROM students WHERE id = ?`, [studentId]);
    await runQuery(`DELETE FROM users WHERE id = ?`, [userId]);
  });

  test('Step 1: Un-enrolled student dashboard reports NOT_ENROLLED with hasFaceRegistered: false', async () => {
    const res = await request(app)
      .get('/api/v1/students/dashboard')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.hasFaceRegistered).toBe(false);
    expect(res.body.enrollmentStatus).toBe('NOT_ENROLLED');
  });

  test('Step 2: One-time face registration atomically commits embeddings and updates enrollment status to ENROLLED', async () => {
    const dummyPhoto = 'data:image/jpeg;base64,' + Buffer.from('photo-front-valid').toString('base64');
    const res = await request(app)
      .post('/api/v1/students/register-face')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        photos: [
          { angle: 'FRONT', imageBase64: dummyPhoto },
          { angle: 'LEFT', imageBase64: dummyPhoto },
          { angle: 'RIGHT', imageBase64: dummyPhoto }
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.enrollmentStatus).toBe('ENROLLED');
    expect(res.body.embeddingsCount).toBe(3);

    // Verify database authoritatively stores ENROLLED status and version 1
    const stRow = await getQuery(`SELECT face_enrollment_status, face_enrolled_version FROM students WHERE id = ?`, [studentId]);
    expect(stRow.face_enrollment_status).toBe('ENROLLED');
    expect(stRow.face_enrolled_version).toBe(1);

    // Verify student_face_embeddings has 3 rows
    const faces = await getQuery(`SELECT COUNT(*) as count FROM student_face_embeddings WHERE student_id = ?`, [studentId]);
    expect(faces.count).toBe(3);
  });

  test('Step 3: Dashboard and Auth Profile immediately reflect persistent ENROLLED status', async () => {
    // 3a. Student dashboard
    const dashRes = await request(app)
      .get('/api/v1/students/dashboard')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(dashRes.status).toBe(200);
    expect(dashRes.body.hasFaceRegistered).toBe(true);
    expect(dashRes.body.enrollmentStatus).toBe('ENROLLED');
    expect(dashRes.body.face_enrollment_status).toBe('ENROLLED');

    // 3b. Auth /me endpoint
    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.user.hasFaceRegistered).toBe(true);
    expect(meRes.body.user.face_enrollment_status).toBe('ENROLLED');
  });

  test('Step 4: Accidental repeated enrollment without explicit re-enrollment flag is blocked (409 Conflict)', async () => {
    const dummyPhoto = 'data:image/jpeg;base64,' + Buffer.from('photo-accidental-dup').toString('base64');
    const res = await request(app)
      .post('/api/v1/students/register-face')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        photos: [{ angle: 'FRONT', imageBase64: dummyPhoto }]
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already completed biometric face enrollment/i);
    expect(res.body.isAlreadyEnrolled).toBe(true);
  });

  test('Step 5: Unapproved re-enrollment attempt is blocked with 403, and requires Warden/Admin approval', async () => {
    const newPhoto = 'data:image/jpeg;base64,' + Buffer.from('photo-new-authorized').toString('base64');
    
    // 5a. Attempt re-enrollment without prior approval -> Expect 403 Forbidden
    const unapprovedRes = await request(app)
      .post('/api/v1/students/register-face')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        photos: [{ angle: 'FRONT', imageBase64: newPhoto }],
        is_re_enrollment: true
      });

    expect(unapprovedRes.status).toBe(403);
    expect(unapprovedRes.body.requiresApproval).toBe(true);

    // 5b. Submit formal face update request
    const reqRes = await request(app)
      .post('/api/v1/students/request-face-update')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ reason: 'Facial appearance change: haircut and new glasses' });

    expect(reqRes.status).toBe(200);
    expect(reqRes.body.success).toBe(true);
    const requestId = reqRes.body.requestId;

    // 5c. Verify student face update status is PENDING
    const statusRes = await request(app)
      .get('/api/v1/students/face-update-status')
      .set('Authorization', `Bearer ${studentToken}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe('PENDING');

    // 5d. Admin logs in and approves the request
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'Admin@12345' });
    expect(adminLogin.status).toBe(200);
    const adminToken = adminLogin.body.token;

    const reviewRes = await request(app)
      .post(`/api/v1/admin/face-update-requests/${requestId}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APPROVED' });
    expect(reviewRes.status).toBe(200);

    // 5e. Authorized re-enrollment now succeeds and increments version to 2
    const res = await request(app)
      .post('/api/v1/students/register-face')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        photos: [
          { angle: 'FRONT', imageBase64: newPhoto },
          { angle: 'LEFT', imageBase64: newPhoto }
        ],
        is_re_enrollment: true
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.enrollmentStatus).toBe('ENROLLED');

    // Verify version incremented to 2
    const stRow = await getQuery(`SELECT face_enrollment_status, face_enrolled_version FROM students WHERE id = ?`, [studentId]);
    expect(stRow.face_enrollment_status).toBe('ENROLLED');
    expect(stRow.face_enrolled_version).toBe(2);

    // 5f. Verify request status is now COMPLETED (consumed)
    const consumedReq = await getQuery(`SELECT status FROM face_update_requests WHERE id = ?`, [requestId]);
    expect(consumedReq.status).toBe('COMPLETED');

    // 5g. Subsequent re-enrollment without another approval is blocked again
    const postConsumeRes = await request(app)
      .post('/api/v1/students/register-face')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        photos: [{ angle: 'FRONT', imageBase64: newPhoto }],
        is_re_enrollment: true
      });
    expect(postConsumeRes.status).toBe(403);
    expect(postConsumeRes.body.requiresApproval).toBe(true);
  });
});
