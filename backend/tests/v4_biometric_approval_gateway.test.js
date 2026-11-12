const request = require('supertest');
const { app } = require('../src/server');
const { runQuery, getQuery } = require('../src/db/database');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

describe('HostelGuard Biometric Security: Dual-Authority Face Re-Enrollment Gateway', () => {
  let student1Id, student1Roll, student1Token, student1UserId;
  let student2Id, student2Roll, student2Token, student2UserId;
  let adminToken;
  let wardenToken;

  beforeAll(async () => {
    const timestamp = Date.now().toString().slice(-6);
    student1Roll = `SEC_${timestamp}_01`;
    student1Id = `HSTL-2026-${student1Roll}`;
    student1UserId = uuidv4();

    student2Roll = `SEC_${timestamp}_02`;
    student2Id = `HSTL-2026-${student2Roll}`;
    student2UserId = uuidv4();

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('TestPass@123', salt);

    // Seed student 1 (un-enrolled)
    await runQuery(`
      INSERT INTO users (id, username, email, password_hash, role, student_id, is_active)
      VALUES (?, ?, ?, ?, 'STUDENT', ?, 1)
    `, [student1UserId, student1Roll, `${student1Roll.toLowerCase()}@test.local`, passwordHash, student1Id]);

    await runQuery(`
      INSERT INTO students (
        id, user_id, roll_number, full_name, email, course, admission_year, semester,
        hostel_block, room_number, device_id, is_active, face_enrollment_status, face_enrolled_version
      ) VALUES (?, ?, ?, 'Sec Student 1', ?, 'B.Tech', 2026, 4, 'Block A', 'A-101', 'DEV-SEC-01', 1, 'NOT_ENROLLED', 0)
    `, [student1Id, student1UserId, student1Roll, `${student1Roll.toLowerCase()}@test.local`]);

    // Seed student 2 (un-enrolled)
    await runQuery(`
      INSERT INTO users (id, username, email, password_hash, role, student_id, is_active)
      VALUES (?, ?, ?, ?, 'STUDENT', ?, 1)
    `, [student2UserId, student2Roll, `${student2Roll.toLowerCase()}@test.local`, passwordHash, student2Id]);

    await runQuery(`
      INSERT INTO students (
        id, user_id, roll_number, full_name, email, course, admission_year, semester,
        hostel_block, room_number, device_id, is_active, face_enrollment_status, face_enrolled_version
      ) VALUES (?, ?, ?, 'Sec Student 2', ?, 'B.Tech', 2026, 4, 'Block B', 'B-102', 'DEV-SEC-02', 1, 'NOT_ENROLLED', 0)
    `, [student2Id, student2UserId, student2Roll, `${student2Roll.toLowerCase()}@test.local`]);

    // Student 1 login
    const s1Res = await request(app).post('/api/v1/auth/login').send({ username: student1Roll, password: 'TestPass@123' });
    student1Token = s1Res.body.token;

    // Student 2 login
    const s2Res = await request(app).post('/api/v1/auth/login').send({ username: student2Roll, password: 'TestPass@123' });
    student2Token = s2Res.body.token;

    // Admin login
    const adminRes = await request(app).post('/api/v1/auth/login').send({ username: 'admin', password: 'Admin@12345' });
    adminToken = adminRes.body.token;

    // Seed Warden user if not present
    let wardenUser = await getQuery(`SELECT * FROM users WHERE role = 'WARDEN' LIMIT 1`);
    if (!wardenUser) {
      const wardenId = uuidv4();
      await runQuery(`
        INSERT INTO users (id, username, email, password_hash, role, is_active)
        VALUES (?, 'warden_test', 'warden_test@hostel.local', ?, 'WARDEN', 1)
      `, [wardenId, passwordHash]);
    }
    const wardenLogin = await request(app).post('/api/v1/auth/login').send({ username: wardenUser ? wardenUser.username : 'warden_test', password: wardenUser ? 'Admin@12345' : 'TestPass@123' });
    wardenToken = wardenLogin.body?.token;
    if (!wardenToken) {
      // Fallback: reset password for warden_test
      const resetHash = await bcrypt.hash('Warden@12345', salt);
      await runQuery(`UPDATE users SET password_hash = ? WHERE role = 'WARDEN'`, [resetHash]);
      const wRes = await request(app).post('/api/v1/auth/login').send({ username: wardenUser ? wardenUser.username : 'warden_test', password: 'Warden@12345' });
      wardenToken = wRes.body.token;
    }
  });

  afterAll(async () => {
    await runQuery(`DELETE FROM face_update_requests WHERE student_id IN (?, ?)`, [student1Id, student2Id]);
    await runQuery(`DELETE FROM student_face_embeddings WHERE student_id IN (?, ?)`, [student1Id, student2Id]);
    await runQuery(`DELETE FROM students WHERE id IN (?, ?)`, [student1Id, student2Id]);
    await runQuery(`DELETE FROM users WHERE id IN (?, ?)`, [student1UserId, student2UserId]);
  });

  test('Rule 1: Un-enrolled student cannot submit a face update request before initial onboarding', async () => {
    const res = await request(app)
      .post('/api/v1/students/request-face-update')
      .set('Authorization', `Bearer ${student1Token}`)
      .send({ reason: 'Premature request' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/initial face enrollment does not require administrative approval/i);
  });

  test('Rule 2: Initial onboarding face enrollment succeeds without needing prior approval', async () => {
    const dummyPhoto = 'data:image/jpeg;base64,' + Buffer.from('photo-initial-valid').toString('base64');
    const res = await request(app)
      .post('/api/v1/students/register-face')
      .set('Authorization', `Bearer ${student1Token}`)
      .send({
        photos: [
          { angle: 'FRONT', imageBase64: dummyPhoto },
          { angle: 'LEFT', imageBase64: dummyPhoto }
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.enrollmentStatus).toBe('ENROLLED');

    const studentRow = await getQuery(`SELECT face_enrollment_status, face_enrolled_version FROM students WHERE id = ?`, [student1Id]);
    expect(studentRow.face_enrollment_status).toBe('ENROLLED');
    expect(studentRow.face_enrolled_version).toBe(1);
  });

  test('Rule 3: Enrolled student attempting face update without prior approval is blocked (403 Forbidden)', async () => {
    const friendPhoto = 'data:image/jpeg;base64,' + Buffer.from('photo-friend-unauthorized').toString('base64');
    const res = await request(app)
      .post('/api/v1/students/register-face')
      .set('Authorization', `Bearer ${student1Token}`)
      .send({
        photos: [{ angle: 'FRONT', imageBase64: friendPhoto }],
        is_re_enrollment: true
      });

    expect(res.status).toBe(403);
    expect(res.body.requiresApproval).toBe(true);
    expect(res.body.error).toMatch(/Biometric Security Policy: Updating an existing face profile requires prior approval/i);
  });

  test('Rule 4: Enrolled student can submit a face update request with valid reason (status PENDING)', async () => {
    const res = await request(app)
      .post('/api/v1/students/request-face-update')
      .set('Authorization', `Bearer ${student1Token}`)
      .send({ reason: 'New spectacles and significant haircut' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.requestId).toBeDefined();

    // Verify GET /face-update-status reports PENDING
    const statusRes = await request(app)
      .get('/api/v1/students/face-update-status')
      .set('Authorization', `Bearer ${student1Token}`);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe('PENDING');
    expect(statusRes.body.request.reason).toBe('New spectacles and significant haircut');
  });

  test('Rule 5: Duplicate pending request is blocked', async () => {
    const res = await request(app)
      .post('/api/v1/students/request-face-update')
      .set('Authorization', `Bearer ${student1Token}`)
      .send({ reason: 'Duplicate request attempt' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already have a pending face update request/i);
  });

  test('Rule 6: Either Warden OR Admin can list and review pending requests', async () => {
    // 6a. Admin lists requests
    const adminList = await request(app)
      .get('/api/v1/admin/face-update-requests?status=PENDING')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(adminList.status).toBe(200);
    const reqItem = adminList.body.requests.find(r => r.student_id === student1Id);
    expect(reqItem).toBeDefined();
    expect(reqItem.status).toBe('PENDING');

    // 6b. Warden lists requests
    const wardenList = await request(app)
      .get('/api/v1/warden/face-update-requests?status=PENDING')
      .set('Authorization', `Bearer ${wardenToken}`);

    expect(wardenList.status).toBe(200);
    const wardenReqItem = wardenList.body.requests.find(r => r.student_id === student1Id);
    expect(wardenReqItem).toBeDefined();

    // 6c. Warden approves student 1's request
    const reviewRes = await request(app)
      .post(`/api/v1/warden/face-update-requests/${reqItem.id}/review`)
      .set('Authorization', `Bearer ${wardenToken}`)
      .send({ decision: 'APPROVED' });

    expect(reviewRes.status).toBe(200);
    expect(reviewRes.body.success).toBe(true);

    // 6d. Student now sees status APPROVED
    const statusRes = await request(app)
      .get('/api/v1/students/face-update-status')
      .set('Authorization', `Bearer ${student1Token}`);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe('APPROVED');
    expect(statusRes.body.request.reviewer_role).toBe('WARDEN');
  });

  test('Rule 7: With APPROVED status, student face update succeeds and atomically consumes approval', async () => {
    const newFacePhoto = 'data:image/jpeg;base64,' + Buffer.from('photo-new-approved-face').toString('base64');
    const res = await request(app)
      .post('/api/v1/students/register-face')
      .set('Authorization', `Bearer ${student1Token}`)
      .send({
        photos: [{ angle: 'FRONT', imageBase64: newFacePhoto }],
        is_re_enrollment: true
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify version incremented to 2
    const studentRow = await getQuery(`SELECT face_enrollment_status, face_enrolled_version FROM students WHERE id = ?`, [student1Id]);
    expect(studentRow.face_enrollment_status).toBe('ENROLLED');
    expect(studentRow.face_enrolled_version).toBe(2);

    // Verify request is now marked COMPLETED (cannot be reused)
    const reqRow = await getQuery(`SELECT status FROM face_update_requests WHERE student_id = ? ORDER BY reviewed_at DESC LIMIT 1`, [student1Id]);
    expect(reqRow.status).toBe('COMPLETED');

    // Attempting a third update without new approval is blocked again
    const postConsumeRes = await request(app)
      .post('/api/v1/students/register-face')
      .set('Authorization', `Bearer ${student1Token}`)
      .send({
        photos: [{ angle: 'FRONT', imageBase64: newFacePhoto }],
        is_re_enrollment: true
      });

    expect(postConsumeRes.status).toBe(403);
    expect(postConsumeRes.body.requiresApproval).toBe(true);
  });

  test('Rule 8: Admin can reject a request with reason, and student sees REJECTED status', async () => {
    // Initial enrollment for student 2
    const dummyPhoto = 'data:image/jpeg;base64,' + Buffer.from('photo-s2-initial').toString('base64');
    await request(app)
      .post('/api/v1/students/register-face')
      .set('Authorization', `Bearer ${student2Token}`)
      .send({ photos: [{ angle: 'FRONT', imageBase64: dummyPhoto }] });

    // Student 2 requests face update
    const reqRes = await request(app)
      .post('/api/v1/students/request-face-update')
      .set('Authorization', `Bearer ${student2Token}`)
      .send({ reason: 'Suspicious change without proof' });
    const reqId = reqRes.body.requestId;

    // Admin rejects with reason
    const rejectRes = await request(app)
      .post(`/api/v1/admin/face-update-requests/${reqId}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'REJECTED', rejection_reason: 'In-person verification at warden office required first.' });

    expect(rejectRes.status).toBe(200);

    // Student 2 checks status
    const statusRes = await request(app)
      .get('/api/v1/students/face-update-status')
      .set('Authorization', `Bearer ${student2Token}`);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe('REJECTED');
    expect(statusRes.body.request.rejection_reason).toMatch(/In-person verification/i);

    // Attempting re-enrollment while rejected is blocked
    const updateRes = await request(app)
      .post('/api/v1/students/register-face')
      .set('Authorization', `Bearer ${student2Token}`)
      .send({ photos: [{ angle: 'FRONT', imageBase64: dummyPhoto }], is_re_enrollment: true });

    expect(updateRes.status).toBe(403);
  });
});
