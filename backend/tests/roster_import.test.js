const request = require('supertest');
const { app } = require('../src/server');
const { initDatabase, runQuery, getQuery } = require('../src/db/database');

let adminToken = '';

beforeAll(async () => {
  await initDatabase();

  await runQuery(`DELETE FROM students WHERE roll_number IN ('ROSTER_TEST_01', 'ROSTER_TEST_02', '2023CS01')`);
  await runQuery(`DELETE FROM hostel_allotments WHERE roll_number IN ('ROSTER_TEST_01', 'ROSTER_TEST_02', '2023CS01')`);

  // Ensure test fixture for conflict detection
  await runQuery(`
    INSERT INTO hostel_allotments (id, roll_number, full_name, room_number, hostel_block, is_registered)
    VALUES ('test-allot-2023cs01', '2023CS01', 'Aarav Sharma', 'A-101', 'Block A', 0)
  `);

  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ username: 'admin', password: 'Admin@12345' });
  adminToken = loginRes.body.token;
});

afterAll(async () => {
  await runQuery(`DELETE FROM students WHERE roll_number IN ('ROSTER_TEST_01', 'ROSTER_TEST_02', '2023CS01')`);
  await runQuery(`DELETE FROM hostel_allotments WHERE roll_number IN ('ROSTER_TEST_01', 'ROSTER_TEST_02', '2023CS01')`);
});

describe('Roster Upload & Pre-Registration Verification', () => {
  test('POST /api/v1/admin/allotment/upload-preview - Previews and flags duplicate conflicts', async () => {
    // 1. First record has existing roll number
    // 2. Second record has valid new roll number
    // 3. Third record has missing required fields
    const testRecords = [
      { roll_number: '2023CS01', full_name: 'Existing Student', hostel_block: 'Block A', room_number: 'A-101' },
      { roll_number: 'ROSTER_TEST_01', full_name: 'New Test Student', hostel_block: 'Block A', room_number: 'A-205' },
      { roll_number: '', full_name: 'Incomplete Student', hostel_block: 'Block A', room_number: 'A-206' }
    ];

    const res = await request(app)
      .post('/api/v1/admin/allotment/upload-preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ records: testRecords });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.preview).toBeDefined();

    const preview = res.body.preview;
    expect(preview.totalRows).toBe(3);
    expect(preview.validRows).toBe(1);
    expect(preview.conflictRows).toBe(2);

    const dupRecord = preview.records.find(r => r.roll_number === '2023CS01');
    expect(dupRecord.status).toBe('CONFLICT_ALREADY_EXISTS');

    const validRecord = preview.records.find(r => r.roll_number === 'ROSTER_TEST_01');
    expect(validRecord.status).toBe('VALID');

    const emptyRecord = preview.records.find(r => !r.roll_number);
    expect(emptyRecord.status).toBe('INVALID_FIELDS');
  });

  test('POST /api/v1/admin/allotment/upload-commit - Atomically commits valid records into database', async () => {
    const validRecords = [
      { roll_number: 'ROSTER_TEST_01', full_name: 'New Test Student One', hostel_block: 'Block A', room_number: 'A-205' },
      { roll_number: 'ROSTER_TEST_02', full_name: 'New Test Student Two', hostel_block: 'Block B', room_number: 'B-105' }
    ];

    const res = await request(app)
      .post('/api/v1/admin/allotment/upload-commit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ validRecords });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.committedCount).toBe(2);

    // Verify database entries
    const r1 = await getQuery(`SELECT * FROM hostel_allotments WHERE roll_number = ?`, ['ROSTER_TEST_01']);
    expect(r1).toBeDefined();
    expect(r1.full_name).toBe('New Test Student One');
    expect(r1.is_registered).toBe(0);

    const r2 = await getQuery(`SELECT * FROM hostel_allotments WHERE roll_number = ?`, ['ROSTER_TEST_02']);
    expect(r2).toBeDefined();

    // Verify administrative audit trail recorded the commit
    const audit = await getQuery(`SELECT * FROM admin_audit_events WHERE action = 'ROSTER_CSV_COMMIT' ORDER BY created_at DESC LIMIT 1`);
    expect(audit).toBeDefined();
    expect(audit.username).toBe('admin');
  });

  test('POST /api/v1/admin/students/manual-add - Rejects duplicate email with friendly 400 error instead of SQLITE_CONSTRAINT crash', async () => {
    // Attempt to add a student using the admin's email 'admin@hostelguard.local'
    const res = await request(app)
      .post('/api/v1/admin/students/manual-add')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        roll_number: 'UNIQUE_ROLL_99',
        full_name: 'Test Student Conflict',
        room_number: 'B-101',
        hostel_block: 'Block B',
        email: 'admin@hostelguard.local',
        phone: '+919999988888',
        course: 'B.Tech IT',
        admission_year: 2024,
        semester: 1,
        create_login: true
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/already registered/i);
    expect(res.body.error).not.toMatch(/SQLITE_CONSTRAINT/i);
  });

  test('POST /api/v1/admin/students/manual-add - Successfully registers student with unique email', async () => {
    await runQuery(`DELETE FROM students WHERE roll_number = 'UNIQUE_ROLL_99'`);
    await runQuery(`DELETE FROM hostel_allotments WHERE roll_number = 'UNIQUE_ROLL_99'`);
    await runQuery(`DELETE FROM users WHERE username = 'UNIQUE_ROLL_99'`);

    const res = await request(app)
      .post('/api/v1/admin/students/manual-add')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        roll_number: 'UNIQUE_ROLL_99',
        full_name: 'Test Unique Student',
        room_number: 'B-101',
        hostel_block: 'Block B',
        email: 'unique.student.99@student.hostel.local',
        phone: '+919999977777',
        course: 'B.Tech IT',
        admission_year: 2024,
        semester: 1,
        create_login: true
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.student.roll_number).toBe('UNIQUE_ROLL_99');

    // Clean up
    await runQuery(`DELETE FROM students WHERE roll_number = 'UNIQUE_ROLL_99'`);
    await runQuery(`DELETE FROM hostel_allotments WHERE roll_number = 'UNIQUE_ROLL_99'`);
    await runQuery(`DELETE FROM users WHERE username = 'UNIQUE_ROLL_99'`);
  });

  test('DELETE /api/v1/admin/students/:id - Permanently deletes individual student when departing hostel', async () => {
    // 0. Clean prior state if any
    await runQuery(`DELETE FROM student_face_embeddings WHERE id = 'face-vec-depart-01'`);
    await runQuery(`DELETE FROM students WHERE roll_number = 'DEPART_STUDENT_01'`);
    await runQuery(`DELETE FROM hostel_allotments WHERE roll_number = 'DEPART_STUDENT_01'`);
    await runQuery(`DELETE FROM users WHERE username = 'DEPART_STUDENT_01'`);

    // 1. Create a student to delete
    await request(app)
      .post('/api/v1/admin/students/manual-add')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        roll_number: 'DEPART_STUDENT_01',
        full_name: 'Departing Student',
        room_number: 'C-301',
        hostel_block: 'Block C',
        email: 'departing.student@hostel.local',
        phone: '+919876500000',
        course: 'B.Tech Mechanical',
        admission_year: 2024,
        semester: 2,
        create_login: true
      });

    const studentRec = await getQuery(`SELECT * FROM students WHERE roll_number = 'DEPART_STUDENT_01'`);
    expect(studentRec).toBeDefined();

    // 2. Add sample face embedding vector
    await runQuery(`
      INSERT INTO student_face_embeddings (id, student_id, angle_label, embedding_vector, quality_score, liveness_score)
      VALUES ('face-vec-depart-01', ?, 'frontal', '[0.12, 0.34]', 1.0, 1.0)
    `, [studentRec.id]);

    // 3. Call DELETE endpoint
    const delRes = await request(app)
      .delete(`/api/v1/admin/students/${studentRec.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);
    expect(delRes.body.message).toMatch(/successfully deleted/i);

    // 4. Verify all associated records were completely wiped
    const checkStudent = await getQuery(`SELECT id FROM students WHERE roll_number = 'DEPART_STUDENT_01'`);
    expect(checkStudent).toBeNull();

    const checkAllotment = await getQuery(`SELECT id FROM hostel_allotments WHERE roll_number = 'DEPART_STUDENT_01'`);
    expect(checkAllotment).toBeNull();

    const checkUser = await getQuery(`SELECT id FROM users WHERE username = 'DEPART_STUDENT_01'`);
    expect(checkUser).toBeNull();

    const checkVectors = await getQuery(`SELECT id FROM student_face_embeddings WHERE id = 'face-vec-depart-01'`);
    expect(checkVectors).toBeNull();

    // 5. Verify audit event was logged
    const audit = await getQuery(`
      SELECT * FROM admin_audit_events
      WHERE action = 'DELETE_STUDENT_RECORD' AND details LIKE '%DEPART_STUDENT_01%'
      ORDER BY created_at DESC LIMIT 1
    `);
    expect(audit).toBeDefined();
    expect(audit.username).toBe('admin');
  });

  test('Enroll student WITHOUT pre-created login, verify roster visibility, and complete self-onboarding lifecycle', async () => {
    const testRoll = 'TEST_NOLOGIN_01';
    const testPhone = '9395746230';
    const testEmail = 'shashanka.test@example.com';

    // Cleanup any leftovers
    await runQuery(`DELETE FROM students WHERE roll_number = ?`, [testRoll]);
    await runQuery(`DELETE FROM hostel_allotments WHERE roll_number = ?`, [testRoll]);
    await runQuery(`DELETE FROM users WHERE username = ?`, [testRoll]);

    // 1. Admin adds student with create_login = false
    const addRes = await request(app)
      .post('/api/v1/admin/students/manual-add')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        roll_number: testRoll,
        full_name: 'Shashanka Test',
        room_number: 'A-101',
        hostel_block: 'Block A',
        email: testEmail,
        phone: testPhone,
        course: 'B.Tech Computer Science',
        admission_year: 2026,
        semester: 1,
        create_login: false
      });

    expect(addRes.status).toBe(200);
    expect(addRes.body.success).toBe(true);
    expect(addRes.body.student.credentials).toBeNull();

    // 2. Student is visible in GET /api/v1/admin/students
    const listRes = await request(app)
      .get(`/api/v1/admin/students?search=${testRoll}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.students.length).toBeGreaterThanOrEqual(1);
    const listedStudent = listRes.body.students.find(s => s.roll_number === testRoll);
    expect(listedStudent).toBeDefined();
    expect(listedStudent.user_id).toBeNull();

    // 3. Student performs privacy-preserving lookup by phone number
    const lookupRes = await request(app)
      .post('/api/v1/students/onboarding/lookup')
      .send({ query: testPhone });

    expect(lookupRes.status).toBe(200);
    expect(lookupRes.body.success).toBe(true);
    expect(lookupRes.body.student.roll_number).toBe(testRoll);
    expect(lookupRes.body.student.has_phone).toBe(true);

    // 4. Student requests OTP
    const otpRes = await request(app)
      .post('/api/v1/students/onboarding/send-otp')
      .send({ roll_number: testRoll, method: 'PHONE' });

    expect(otpRes.status).toBe(200);
    expect(otpRes.body.success).toBe(true);
    expect(otpRes.body.debugOtp).toBeDefined();
    const sentOtp = otpRes.body.debugOtp;

    // 5. Student verifies OTP
    const verifyRes = await request(app)
      .post('/api/v1/students/onboarding/verify-otp')
      .send({ roll_number: testRoll, otp: sentOtp });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.success).toBe(true);
    expect(verifyRes.body.onboarding_token).toBeDefined();
    expect(verifyRes.body.credentials.username).toBe(testRoll);
    const onboardingToken = verifyRes.body.onboarding_token;

    // 6. Student submits face biometrics and completes onboarding
    const onboardRes = await request(app)
      .post('/api/v1/students/onboard')
      .send({
        onboarding_token: onboardingToken,
        roll_number: testRoll,
        photos: [{ angle: 'FRONT', imageBase64: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }]
      });

    expect(onboardRes.status).toBe(200);
    expect(onboardRes.body.success).toBe(true);
    expect(onboardRes.body.student.rollNumber).toBe(testRoll);

    // 7. Verify login user was created and can sign in
    const studentLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: testRoll, password: 'Student@12345' });

    expect(studentLogin.status).toBe(200);
    expect(studentLogin.body.success).toBe(true);
    expect(studentLogin.body.user.role).toBe('STUDENT');

    // Clean up test data
    await runQuery(`DELETE FROM students WHERE roll_number = ?`, [testRoll]);
    await runQuery(`DELETE FROM hostel_allotments WHERE roll_number = ?`, [testRoll]);
    await runQuery(`DELETE FROM users WHERE username = ?`, [testRoll]);
  });
});
