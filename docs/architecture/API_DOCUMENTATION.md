# REST API Reference: HostelGuard Enterprise

Base URL: `http://localhost:5000/api/v1`

All responses return standard JSON. Authenticated endpoints require an HTTP `Authorization` header formatted as:
`Authorization: Bearer <JWT_TOKEN>`

---

## 1. Authentication Endpoints

### 1.1 User Login
`POST /auth/login`
- **Rate Limit**: 10 requests per 15 minutes.
- **Request Body**:
  ```json
  {
    "username": "admin",
    "password": "Admin@12345"
  }
  ```
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
    "user": {
      "id": "e4f8d2...",
      "username": "admin",
      "email": "admin@hostelguard.local",
      "role": "ADMIN"
    }
  }
  ```

### 1.2 Get Current Session
`GET /auth/me`
- **Headers**: `Authorization: Bearer <TOKEN>`
- **Response**: Current user object with verified permissions.

---

## 2. Administrator Operations (`ADMIN` Role Required)

### 2.1 Executive Dashboard Metrics
`GET /admin/dashboard-stats`
- **Response**:
  ```json
  {
    "success": true,
    "summary": {
      "totalRegistered": 142,
      "totalAllotted": 150,
      "presentToday": 136,
      "absentToday": 6,
      "attendancePercentage": 96,
      "flaggedForgeCount": 1,
      "pendingCorrections": 2
    },
    "charts": {
      "weeklyTrend": [...],
      "statusDistribution": { "present": 136, "absent": 6, "late": 0, "flagged": 1 },
      "blockDistribution": [...]
    }
  }
  ```

### 2.2 Pre-Registration Roster Preview
`POST /admin/allotment/upload-preview`
- **Payload**: Multipart form-data with `.csv` file OR JSON `{ "records": [...] }`.
- **Response**: Conflict preview summary with categorized rows:
  - `VALID`: Ready for transaction commit.
  - `CONFLICT_ALREADY_EXISTS`: Roll number already present on roster.
  - `INVALID_FIELDS`: Missing required name or roll number.

### 2.3 Roster Commit (Transactional)
`POST /admin/allotment/upload-commit`
- **Request Body**: `{ "validRecords": [...] }`
- **Response**: Number of newly created allotment records committed inside atomic database transaction.

### 2.4 Geofence Configuration
`GET /admin/geofence`
- **Response**: Current active geofence center coordinates and permitted boundary radius.

`POST /admin/geofence`
- **Request Body**:
  ```json
  {
    "facility_name": "Main Hostel Campus",
    "latitude": 28.535512,
    "longitude": 77.391028,
    "radius_meters": 20,
    "is_active": 1
  }
  ```

### 2.5 Attendance Reporting & Overrides
`GET /admin/reports?date=2026-10-14&status=PRESENT&block=Block%20A`
- **Response**: Filtered attendance records with time, method, distance, and student roll numbers.

`POST /admin/attendance/override`
- **Request Body**:
  ```json
  {
    "student_id": "HSTL-2023-2023CS01",
    "date": "2026-10-14",
    "status": "PRESENT",
    "reason": "Official medical certificate verified by hostel clinic."
  }
  ```
- **Policy**: Non-destructive override preserving original records and logging to `admin_audit_events`.

### 2.6 Security & Strike Counter Reset
`GET /admin/security/alerts`
- **Response**: Students with active strikes, accounts flagged for Forge Location, and incident history.

`POST /admin/security/reset-strike`
- **Request Body**:
  ```json
  {
    "student_id": "HSTL-2023-2023CS01",
    "reason": "Student verified GPS sensor drift with campus IT support."
  }
  ```

---

## 3. Warden Operations (`WARDEN` or `ADMIN` Role Required)

### 3.1 Block Supervision Overview
`GET /warden/overview`
- **Response**: Resident counts, attendance rates, and occupancy across assigned hostel blocks.

### 3.2 Daily Exceptions Desk
`GET /warden/exceptions`
- **Response**: List of absent residents and students nearing forge strike limits.

### 3.3 Adjudicate Correction Request
`POST /warden/corrections/:id/review`
- **Request Body**:
  ```json
  {
    "decision": "APPROVED",
    "resolution_note": "In-person roll call verified presence on floor."
  }
  ```

---

## 4. Student Operations (`STUDENT` Role Required)

### 4.1 Onboarding Roster Fetch (Public)
`GET /students/allotment-list`
- **Response**: List of pre-allotted students who have not completed Phase 2 onboarding.

### 4.2 Complete Phase 2 Onboarding (Public)
`POST /students/onboard`
- **Request Body**:
  ```json
  {
    "roll_number": "2023CS01",
    "course": "B.Tech Computer Science",
    "admission_year": 2023,
    "semester": 4,
    "device_id": "DEV-XYZ-123",
    "photos": [
      { "angle": "FRONT", "imageBase64": "data:image/jpeg;base64,..." }
    ]
  }
  ```
- **Response**: Enrolled student object and confirmation of extracted SFace 128-D vector embeddings.

### 4.3 Student Dashboard & History
`GET /students/dashboard`
- **Response**: Today's roll call status, monthly attendance percentage, and active strike count.

`GET /students/history`
- **Response**: Chronological attendance logs for authenticated student.

### 4.4 Submit Attendance Correction Appeal
`POST /students/corrections`
- **Request Body**:
  ```json
  {
    "date": "2026-10-14",
    "reason": "Attending inter-college symposium with dean permission."
  }
  ```

---

## 5. Daily Attendance Verification Engine

### 5.1 Step 1: Geofence Validation
`POST /attendance/verify-location`
- **Rate Limit**: 20 requests per 10 minutes.
- **Request Body**:
  ```json
  {
    "roll_number": "2023CS01",
    "latitude": 28.535512,
    "longitude": 77.391028,
    "accuracy": 8.5,
    "is_mock_location": false
  }
  ```
- **Success (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Location verified! Proceed to facial verification.",
    "sessionToken": "48b6c810-...",
    "distanceMeters": 4.2,
    "permittedRadiusMeters": 20.0
  }
  ```
- **Rejection (403 Forbidden)**:
  - If out-of-bounds: Increments strike count and returns current strikes (e.g. `1/3`).
  - If strike reaches 3: Flags account as `isFlaggedForge = true`.

### 5.2 Step 2: Live Facial Verification
`POST /attendance/verify-face`
- **Request Body**:
  ```json
  {
    "session_token": "48b6c810-...",
    "live_photo": "data:image/jpeg;base64,..."
  }
  ```
- **Processing**:
  1. Revalidates challenge token expiry and replay status (`is_used = 0`).
  2. Submits camera frame to local OpenCV Python microservice.
  3. Verifies anti-spoofing criteria (Laplacian variance & moiré frequencies).
  4. Computes cosine similarity against student's stored 128-D vector templates ($\ge 0.65$).
  5. Atomically marks challenge token used and logs attendance as `PRESENT`.
