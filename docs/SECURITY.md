# HostelGuard: Security Architecture & Controls

> **Institutional Security Model & Privacy Controls**  
> *Version 2.4 — Production Standard*

---

## 1. Security Philosophy & Threat Model

HostelGuard is designed to significantly reduce proxy attendance, location spoofing, and unauthorized absences in student residential facilities through defense-in-depth engineering.

Rather than claiming absolute invulnerability, HostelGuard combines multiple corroborating physical and cryptographic signals:
1. **Physical Geolocation Boundaries**: Haversine distance evaluation calculated server-side against central coordinates and radius limits.
2. **Dynamic Challenge Tokens**: Ephemeral, single-use cryptographic tokens (valid for 3 minutes) preventing network replay attacks.
3. **Biometric Face Verification**: OpenCV YuNet landmark alignment and SFace 128-dimensional embedding comparison.
4. **Active Presentation Attack Defenses**: Multi-angle head pose and facial muscle movement verification during enrollment and roll call.
5. **Real-World Schedule Windows**: Strict time-bound roll-call windows enforced against server real-world time.

---

## 2. Cryptographic Replay & Anti-Tamper Defenses

### Single-Use Ephemeral Challenge Tokens
Attendance check-in is divided into two sequential stages:
1. `POST /api/v1/attendance/verify-location`: When the student device proves physical presence inside the hostel geofence, the server generates a cryptographically random UUID token stored in `attendance_challenges` with a 180-second TTL.
2. `POST /api/v1/attendance/verify-face`: When the student submits their facial snapshot, the challenge token is validated and immediately marked `is_used = 1`. Any subsequent attempt to reuse the token is rejected.

### Mock-Location & Teleportation Detection
* Browser mock-location headers and emulated GPS flags are inspected.
* Consecutive check-ins indicating velocities exceeding 100 km/h trigger automated security incident flags in `security_audit_logs`.

---

## 3. 3-Strike Security Protocol & Account Lockout

* **Strike Accumulation**: Unverified location attempts, facial mismatches, or abnormal hardware signals increment the student's strike count.
* **Account Lockout**: Reaching 3 strikes locks the account, disabling roll-call attendance permissions.
* **Audit-Controlled Unlocking**: Unlocking requires administrative review in `SecurityIncidentDesk.jsx`. The administrator must provide a mandatory justification note, which is immutably logged in `admin_audit_events`.

---

## 4. Biometric Data Privacy & Governance

* **Zero Raw Image Retention**: Facial images uploaded during roll-call verification are processed in memory by the OpenCV AI microservice and discarded immediately after vector extraction.
* **Mathematical Vector Storage**: The database stores only 128-dimensional floating-point vectors (`student_face_embeddings`). Raw photos cannot be reverse-engineered from embedding vectors.
* **Access Control**: Biometric endpoints are protected by role-based authorization. Students can only view their own verification status; raw embedding vectors are never transmitted to client viewports.

---

## 5. Network & Platform Hardening

* **Security Headers (Helmet)**: Sets X-Content-Type-Options, Strict-Transport-Security, and frameguard protections.
* **CORS Restrictions**: Explicit origin whitelisting configured via `ALLOWED_ORIGINS`.
* **Rate Limiting**: Brute-force protection on authentication (`/api/v1/auth/login`) and OTP delivery endpoints (`/api/v1/auth/forgot-password/request-otp`).
* **Database Write-Ahead Logging & Concurrency Mutex**: SQLite WAL mode with serialized transactions prevents race conditions during roll-call surges.
