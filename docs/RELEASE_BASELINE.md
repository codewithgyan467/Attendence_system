# HostelGuard Enterprise — Release Baseline Snapshot

**Document Version:** 1.0.0-PROD-BASELINE  
**Recording Date:** 2026-10-16  
**Auditor / Engineer:** Principal Release & Biometric Engineer  
**Baseline Git Commit:** `fdb96ff95f0ba5c7ab81bcd9139056ea290ceca6`  
**Branch:** `main`  
**Repository State:** Authoritative clean working tree snapshot before final release engineering pass.

---

## 1. Environment & Package Dependencies

### Frontend (`frontend/package.json`)
* **Runtime / Bundler:** Vite `^6.4.4`
* **Core Framework:** React `^19.0.0`, React-DOM `^19.0.0`
* **UI & Styling:** Bootstrap `^5.3.3`, Custom Glassmorphic CSS tokens (`index.css`)
* **Visualization & Mapping:** Chart.js `^4.4.7`, React-Chartjs-2 `^5.3.0`, Leaflet `^1.9.4`, React-Leaflet `^5.0.0`
* **Data Processing & Icons:** Lucide-React `^1.16.0`, SheetJS / XLSX `^0.18.5`

### Backend (`backend/package.json`)
* **Runtime:** Node.js v20+ / Express `^4.19.2`
* **Database Driver:** `sqlite3` `^5.1.7` (with WAL mode & foreign key pragmas)
* **Authentication & Cryptography:** `bcryptjs` `^2.4.3`, `jsonwebtoken` `^9.0.2`, `uuid` `^9.0.1`
* **Security & Network:** `cors` `^2.8.5`, `helmet` `^7.1.0`, `express-rate-limit` `^7.2.0`, `dotenv` `^16.4.5`
* **Testing:** `jest` `^29.7.0`, `supertest` `^6.3.4`

### AI Microservice (`backend/ai_service/requirements.txt`)
* **Framework:** FastAPI `^0.110.0`, Uvicorn `^0.28.0`, Pydantic `^2.6.4`
* **Computer Vision:** `opencv-python` `5.0.0`, `numpy` `^1.26.4`
* **Base Models:**
  - `face_detection_yunet_2023mar.onnx` (OpenCV Zoo YuNet)
  - `face_recognition_sface_2021dec.onnx` (OpenCV Zoo SFace 128-D)

---

## 2. Database Schema (17 Tables in WAL Mode)

Database engine: **SQLite 3 with Write-Ahead Logging (`PRAGMA journal_mode = WAL`) and Foreign Key enforcement (`PRAGMA foreign_keys = ON`)**.

1. `users` — Administrator, Warden, and Student authentication accounts, password hashes (bcrypt salt rounds = 10), roles, status.
2. `hostels` — Physical hostel blocks, campus coordinates (latitude, longitude), geofence radius (meters), contact numbers.
3. `rooms` — Room allocations mapped to hostels with capacity and occupancy counters.
4. `students` — Enrolled student roster, roll numbers, hostel & room assignments, device binding fingerprints, strike lockouts.
5. `student_face_embeddings` — Registered 128-D SFace biometric templates per angle, detection confidence, enrollment quality scores.
6. `attendance_records` — Daily confirmed roll-call check-ins, timestamps, verified GPS coordinates, distance from center, similarity scores.
7. `attendance_challenges` — Time-limited single-use nonce tokens (`is_used` atomic flag, 120s TTL) preventing replay attacks.
8. `attendance_schedules` — Roll call window rules (start time, end time, 12-hour display, active days).
9. `attendance_holidays` — Institutional campus holiday schedule; auto-exempts roll call check-in on designated dates.
10. `attendance_corrections` — Student roll call discrepancy claims, reason, supporting proof, warden approval workflow.
11. `security_incidents` — Geofence breach alerts, face mismatch events, spoofing attempts, biometric tamper warnings.
12. `security_audit_logs` — System-wide security audit trail (failed auth, strike triggers, lockouts, privilege escalations).
13. `audit_logs` — Administrative activity log (configuration changes, roster imports, schedule modifications).
14. `feedback_tickets` — Student support and facility maintenance tickets, categorized priorities, resolution notes.
15. `devices` — Registered student hardware fingerprints (`device_id`, user-agent signatures, binding timestamps).
16. `system_settings` — Key-value operational parameters (geofence defaults, strike thresholds, maintenance flags).
17. `db_backups` — Historical database backup metadata, integrity checksums, and snapshot timestamps.

---

## 3. API Surface Baseline

### Public / Authentication Endpoints
- `POST /api/v1/auth/login` — Role-based authentication (Admin, Warden, Student); issues JWT with role-scoped claims.
- `POST /api/v1/auth/student-onboarding/verify` — Roll number verification for new students.
- `POST /api/v1/auth/student-onboarding/submit` — Multi-angle biometric enrollment and initial credential generation.
- `POST /api/v1/auth/forgot-password` — Password reset request and SMS OTP delivery.
- `POST /api/v1/auth/verify-reset-code` — Single-use verification of 6-digit SMS OTP.
- `POST /api/v1/auth/reset-password` — Password update with OTP token proof.

### Student Portal Endpoints (`/api/v1/student`)
- `GET /profile` — Fetch authenticated student profile, room allotment, strike count.
- `GET /dashboard` — Today's attendance status, semester metrics (rate, present, absent), 7-day trend, schedule banner.
- `GET /history` — Historical attendance log with date/time and verification distance.
- `POST /corrections` — Submit roll call correction request with notes.
- `GET /corrections` — View correction request status (Pending, Approved, Rejected).
- `POST /feedback` — Submit support ticket or facility maintenance report.
- `POST /register-face` — Enroll or update 3-angle face profile.

### Attendance Engine Endpoints (`/api/v1/attendance`)
- `POST /verify-location` — Geofence verification against hostel boundary; issues atomic 120s `session_token`.
- `POST /verify-face` — Consumes `session_token`, validates liveness anti-spoof, verifies face match against stored template at threshold 0.65, commits attendance record atomically.

### Warden Operations Endpoints (`/api/v1/warden`)
- `GET /dashboard` — Today's block statistics (total, present, absent, on-leave, pending).
- `GET /students` — Filterable student roster assigned to warden's hostel block.
- `GET /attendance-today` — Live today attendance status with room numbers and verification times.
- `GET /exceptions` — Absence alerts and late check-in reports.
- `GET /corrections` & `PUT /corrections/:id` — Review, approve, or reject attendance correction appeals.
- `GET /feedback` — Resident support tickets and maintenance requests.

### Administrator Endpoints (`/api/v1/admin`)
- `GET /dashboard` — Institutional overview metrics (students, present today, absent today, attendance rate, alerts).
- `GET /students/present-today` — Drilldown list of students marked present today.
- `GET /students/absent-today` — Drilldown list of students absent or pending for today's roll call.
- `POST /roster/import` — CSV/JSON bulk roster import with automatic password and SMS notification dispatch.
- `DELETE /roster/students/:id` — Complete hostel checkout action (cascading removal of records and credentials).
- `GET /geofence` & `PUT /geofence` — Campus boundary perimeter coordinates and radius adjustment.
- `GET /schedules` & `POST /schedules` — Attendance timing configuration (12-hour format) and campus holiday schedule.
- `GET /security/incidents` — Audit desk for geofence breaches, spoof flags, and account strike lockouts.
- `POST /security/incidents/reset-strikes` — Administrative unlock of student roll call access.
- `DELETE /security/incidents` — Purge security alerts individually or in bulk.
- `DELETE /corrections` — Purge resolved correction requests individually or in bulk.
- `DELETE /audit-logs` — Administrative audit log maintenance.
- `GET /system-health` — Real-time diagnostic metrics for API, SQLite, AI microservice, memory, and backup status.
- `POST /backup/create` — Instant SQLite database snapshot and integrity verification.

### AI Microservice Endpoints (`/api/v1/faces`)
- `GET /health` — Verifies ONNX models are loaded into memory and ready for inference.
- `POST /extract-embeddings` — Multi-photo face detection (YuNet) and 128-D vector generation (SFace).
- `POST /verify-live` — Live photo liveness detection and Cosine similarity comparison against stored template.

---

## 4. Frontend Route & Component Baseline

- `StudentPortal.jsx` — Complete student experience: attendance roll call, semester statistics cards, 7-day trend chart, interactive geofence radar map, attendance history table, correction request form, help & support desk.
- `StudentOnboarding.jsx` — Self-guided 4-step onboarding: identity verification, device binding, 3-angle face capture with oval guide, credential setup.
- `AdminDashboard.jsx` — Executive oversight with 8 KPI summary cards, present/absent today drilldown modals, recent attendance stream.
- `StudentRosterManager.jsx` — Full student roster directory, room allocations, search & filter, CSV bulk import, hostel checkout.
- `GeofenceManager.jsx` — Visual campus geofence mapping, coordinates entry, radius slider, live student positioning test.
- `AttendanceManager.jsx` — Comprehensive attendance log with date range filters, student roll search, Excel export.
- `AttendanceScheduleManager.jsx` — 12-hour timing configuration, start/end windows, holiday management calendar.
- `SecurityIncidentDesk.jsx` — Security breach monitoring, strike lockouts, spoof attempt tracking, strike reset workflow.
- `CorrectionRequestDesk.jsx` — Student roll call discrepancy claims, approval/rejection actions with warden notes.
- `FeedbackTicketDesk.jsx` — Student support issues, facility maintenance requests, priority categorization.
- `AuditLogViewer.jsx` — Complete administrative activity audit trail with search and individual/bulk purge.
- `AdminDiagnostics.jsx` — Real-time system health dashboard, component statuses, memory usage, manual backup trigger.
- `WardenDashboard.jsx` — Hostel block management, today's roll call status, exception tracking, facility feedback.

---

## 5. Test Suite Baseline

**Command:** `npm test` (executed via Jest in `backend/`)  
**Results:**  
* **Test Suites:** 8 passed, 8 total (100% pass rate)
* **Tests:** 86 passed, 86 total
* **Execution Time:** ~9.997 seconds
* **Database Check:** `🛡️ SQLite Database Integrity Check: PASS (ok)` across all suites.

Suites validated:
1. `tests/auth.test.js` — Authentication, JWT validation, role-based access control.
2. `tests/system_reverification.test.js` — System-wide reverification of user and role workflows.
3. `tests/password_reset.test.js` — Forgot password, 6-digit SMS OTP issuance, verification, and reset.
4. `tests/roster_import.test.js` — CSV roster bulk import, student account creation, notification dispatch.
5. `tests/attendance_schedule_and_purges.test.js` — Timing window enforcement, holiday exemptions, individual and bulk purge operations.
6. `tests/security_concurrency_hardening.test.js` — Race-condition resistance, atomic challenge consumption, strike enforcement.
7. `tests/attendance_rules.test.js` — Geofence validation, duplicate attendance prevention.
8. `tests/geofence.test.js` — Haversine distance calculation and boundary containment.

---

## 6. Production Build Baseline

**Command:** `npm run build` (executed via Vite 6 in `frontend/`)  
**Results:**  
* **Build Time:** 5.59 seconds
* **Total Chunks:** 24 modules
* **Module Count:** 2,022 modules transformed
* **Code Splitting & Lazy-Loaded Bundles:**
  - `dist/assets/xlsx-CbTSpprj.js` — 429.52 kB (gzip: 143.08 kB) — *Lazy-loaded on export only*
  - `dist/assets/index-CC_1VSBN.js` — 317.22 kB (gzip: 98.10 kB) — *Core application shell*
  - `dist/assets/vendor-chart-CCCH4PHX.js` — 186.15 kB (gzip: 65.06 kB) — *Lazy-loaded chart engine*
  - `dist/assets/GeofenceMap-BHC0aUkF.js` — 154.76 kB (gzip: 45.40 kB) — *Lazy-loaded Leaflet radar map*
  - `dist/assets/StudentPortal-CGy6x9Y2.js` — 61.44 kB (gzip: 15.14 kB) — *Student portal bundle*
  - `dist/assets/vendor-icons-DFkUQ4Kf.js` — 47.21 kB (gzip: 11.25 kB) — *Lucide icon set*
  - `dist/assets/StudentRosterManager-DvWcsPky.js` — 34.12 kB (gzip: 7.84 kB) — *Admin only*
  - `dist/assets/StudentOnboarding-B7or8KdK.js` — 27.61 kB (gzip: 7.59 kB) — *Onboarding only*
  - `dist/assets/AttendanceScheduleManager-Dvjr2kdQ.js` — 19.87 kB (gzip: 5.36 kB) — *Admin only*
  - `dist/assets/AdminDashboard-Bu52Wv9V.js` — 19.28 kB (gzip: 5.35 kB) — *Admin only*
  - `dist/assets/WardenDashboard-BRhwCDiS.js` — 16.21 kB (gzip: 3.79 kB) — *Warden only*

---

## 7. Biometric Configuration Baseline

* **Detection Model:** OpenCV YuNet ONNX (`face_detection_yunet_2023mar.onnx`)
  - Target input resolution: Dynamic (optimized at 320×320)
  - Detection confidence threshold: `0.60`
  - Non-Maximum Suppression (NMS) threshold: `0.30`
* **Recognition Model:** OpenCV SFace ONNX (`face_recognition_sface_2021dec.onnx`)
  - Output feature dimension: 128-D floating-point vector
  - Distance / similarity metric: Cosine Similarity (`dot(v1, v2) / (|v1| * |v2|)`)
* **Current Operating Decision Threshold:** `0.65`
* **Presentation Attack Detection (PAD):** Multi-signal passive stack:
  - Laplacian Variance Texture Sharpness (rejects out-of-focus prints & blurry displays)
  - 2D Fast Fourier Transform (FFT) Power Spectrum Ratio (identifies high-frequency screen moiré harmonics)
  - YCrCb Skin Chrominance Distribution (identifies natural biological human tissue vs RGB backlight displays)
  - Composite Liveness Threshold: `0.65`

---

## 8. Baseline Integrity Confirmation

This baseline was captured and measured on the physical working repository prior to the final release certification pass. It stands as the permanent benchmark against which all changes and improvements are measured.
