# 🗺️ Implementation Plan: Production Transformation

**Objective**: Execute comprehensive refactoring and production hardening of the Smart Hostel Attendance System.

---

## Stage Breakdown & Work Packages

### Stage 1: Repository Audit & Planning (Complete)
- [x] Inspect actual codebase, dependencies, running tasks, and models.
- [x] Produce `ENGINEERING_AUDIT.md` baseline findings.
- [x] Produce `IMPLEMENTATION_PLAN.md` execution plan.

### Stage 2: Database Schema & Authentication Infrastructure
- [x] Configure SQLite pragmas: `PRAGMA journal_mode = WAL;`, `PRAGMA foreign_keys = ON;`, `PRAGMA busy_timeout = 5000;`.
- [ ] Implement database migration & schema runner with all domain entities:
  - `users` (id, username, email, password_hash, role, student_id, is_active, created_at, updated_at)
  - `hostel_blocks` and `rooms` (block_name, room_number, capacity, occupied)
  - `hostel_allotments` (id, roll_number, full_name, room_id, hostel_block, is_registered, created_at)
  - `students` (id, user_id, allotment_id, roll_number, full_name, email, phone, course, admission_year, semester, room_number, hostel_block, device_id, device_model, is_active, failed_attempts, is_flagged_forge)
  - `student_face_embeddings` (id, student_id, angle_label, embedding_vector, quality_score, liveness_score, created_at)
  - `geofence_configs` (id, hostel_name, latitude, longitude, radius_meters, is_active, updated_at, updated_by)
  - `attendance_challenges` (id, student_id, challenge_token, expires_at, is_used, verified_distance, created_at)
  - `attendance_records` (id, student_id, roll_number, full_name, date, time_marked, status, verified_distance, similarity_score, liveness_score, is_override, override_reason, override_by, created_at)
  - `attendance_corrections` (id, attendance_id, student_id, original_status, requested_status, reason, status, reviewed_by, reviewed_at, created_at)
  - `security_audit_logs` (id, user_id, student_id, roll_number, incident_type, calculated_distance, details, ip_address, created_at)
  - `admin_audit_events` (id, user_id, username, action, target_type, target_id, details, ip_address, created_at)
  - `feedback_tickets` (id, student_id, roll_number, category, subject, message, status, resolution_note, resolved_by, created_at, resolved_at)
- [ ] Implement password hashing with `bcryptjs`.
- [ ] Implement JWT generation, verification, and cookie/bearer extraction.
- [ ] Implement Role-Based Access Control middleware (`requireAuth`, `requireRole('ADMIN'|'WARDEN'|'STUDENT')`).
- [ ] Seed default accounts safely:
  - Admin: `admin` / `Admin@12345`
  - Warden: `warden` / `Warden@12345`
  - Student accounts automatically created upon roster onboarding.

### Stage 3: Backend Completion & API Hardening
- [ ] Add `helmet` security headers and rate-limiting middleware (`authLimiter`, `attendanceLimiter`, `generalLimiter`).
- [ ] Implement central request validation (`express-validator`).
- [ ] Add transactions for multi-record operations (CSV roster import, attendance commit + challenge consume + audit log).
- [ ] Build complete REST endpoints:
  - `/api/v1/auth/login`, `/api/v1/auth/logout`, `/api/v1/auth/me`, `/api/v1/auth/change-password`
  - `/api/v1/admin/dashboard-stats` (KPIs + Chart.js datasets from real DB queries)
  - `/api/v1/admin/students` (Full CRUD: list, view, create, edit, deactivate/activate)
  - `/api/v1/admin/rooms` and `/api/v1/admin/blocks`
  - `/api/v1/admin/allotment/upload-preview` and `/api/v1/admin/allotment/upload-commit` (with duplicate conflict detection)
  - `/api/v1/admin/corrections` (Approve / Reject student attendance correction requests)
  - `/api/v1/admin/audit-logs` (Filtered search of admin actions & security events)
  - `/api/v1/admin/security/reset-strike` (with mandatory reason & audit event)
  - `/api/v1/warden/*` (Scoped hostel block attendance, exception review, feedback management)
  - `/api/v1/student/dashboard`, `/api/v1/student/history`, `/api/v1/student/corrections`, `/api/v1/student/feedback`
  - `/api/v1/attendance/verify-location` (issues persistent single-use challenge token)
  - `/api/v1/attendance/verify-face` (atomically consumes challenge token & records attendance)

### Stage 4: AI Computer Vision & Geofence Hardening
- [ ] Verify OpenCV YuNet and SFace models and document exact vector dimensions (128-D).
- [ ] Enhance image preprocessing and quality validation (rejection of blur, darkness, multiple faces).
- [ ] Enforce strict production biometric mode while retaining test simulation flags in dedicated integration tests.
- [ ] Document liveness limitations honestly (presentation-attack defense, not foolproof against all attacks).

### Stage 5: Enterprise Bootstrap 5 Frontend Transformation
- [ ] Configure Bootstrap 5 (`bootstrap/dist/css/bootstrap.min.css`) and custom SaaS stylesheet (`index.css`).
- [ ] Implement Chart.js charts:
  - Attendance trends over time (Line chart)
  - Present vs Absent vs Late ratio (Doughnut chart)
  - Attendance by Hostel Block (Bar chart)
  - Student monthly history (Calendar/Weekly bar chart)
- [ ] Build isolated Role-Protected Layouts:
  - Authentication screen (`/login`) with role-based routing and demo test credential selector.
  - **Admin Portal**: Executive KPI Dashboard, Student Roster CRUD & CSV Preview Modal, Geofence Radius Map/Slider, Attendance Manager with Filters & CSV Export, Security Incident Desk, Correction Request Desk, Audit Trail.
  - **Warden Portal**: Block Attendance Overview, Daily Exceptions, Correction Request Approval, Student Feedback resolution.
  - **Student Portal**: Daily Attendance (GPS + Live Face Visor), Attendance History & Monthly Calendar, Correction Request submission, Feedback/Support Ticketing, Profile & Enrollment status.

### Stage 6: Full Integration & Testing
- [ ] Connect all UI forms, tables, modals, and charts to real backend APIs.
- [ ] Build automated test suite using Jest and Supertest (`backend/tests/`).
- [ ] Verify test cases: Auth, RBAC, Roster import, Geofence boundary, Single-use tokens, 3-strike forge rules, Non-destructive attendance corrections, Uniqueness constraints, SQL injection, Rate limiting.

### Stage 7: Performance, Reliability & Production Packaging
- [ ] Database query optimization, composite indexes, and server-side pagination.
- [ ] Startup launcher hardening (`start_all.bat`, `start_all.ps1`).
- [ ] Create automated database backup & restore scripts.
- [ ] Build 14-document technical documentation suite.
- [ ] Run full verification suite and compile Final Engineering Report.
