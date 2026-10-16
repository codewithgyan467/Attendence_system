# HostelGuard: Security Architecture & Controls

> **Institutional Security Model, Cryptographic Safeguards & Privacy Controls**  
> *Version 2.0-RELEASE — Certified Production Standard*

---

## 1. Security Philosophy & Measurable Defense-in-Depth

HostelGuard is engineered to reliably mitigate proxy attendance, remote location spoofing, and unauthorized absences in student residential facilities through defense-in-depth engineering.

### Scientific Honesty & No False Security Claims
In strict compliance with release engineering standards, HostelGuard makes **no** scientifically unfounded claims such as "100% impossible to spoof" or "unbreakable biometric locks." Modern mobile browsers and sensor stacks operate in untrusted client environments. 

Rather than relying on any single point of failure, HostelGuard combines **multiple corroborating physical, temporal, and cryptographic signals**:
1. **Server-Enforced Geolocation Boundaries**: Haversine distance calculations computed entirely server-side against authoritative GPS coordinates and configured radius perimeters.
2. **Atomic Single-Use Challenge Tokens**: Ephemeral, cryptographically random challenge nonces with a 120-second TTL that prevent network replay attacks.
3. **Biometric Face Verification**: OpenCV YuNet landmark alignment and SFace 128-dimensional embedding comparisons at an empirically calibrated threshold of 0.65.
4. **Presentation Attack Detection (PAD)**: Multi-signal passive texture sharpness (Laplacian variance), 2D FFT moiré harmonic detection, and YCrCb biological skin chrominance validation.
5. **Real-World Roll Call Windows**: Strict time-bound windows (e.g., 7:00 PM – 7:30 PM) synchronized with the institutional server clock and automated holiday exemptions.
6. **Hardware Device Binding**: Browser and device signatures are recorded as security signals to prevent rapid credential hopping across multiple physical handsets.

---

## 2. Cryptographic Replay & Anti-Tamper Defenses

### Single-Use Ephemeral Challenge Tokens (State Machine Enforcement)
Attendance verification cannot be bypassed by calling endpoints out of order. The state machine strictly requires:
```
REQUEST ➔ LOCATION CHECK ➔ CHALLENGE TOKEN ISSUED ➔ CAMERA CAPTURE ➔ LIVENESS ➔ IDENTITY MATCH ➔ ATTENDANCE COMMITTED
```
1. `POST /api/v1/attendance/verify-location`: When the student proves presence inside the geofence, the server generates a unique UUID stored in `attendance_challenges` with a 120-second TTL.
2. `POST /api/v1/attendance/verify-face`: When the student submits their live facial snapshot with the challenge token, the token is verified and immediately consumed using an atomic conditional update:
   ```sql
   UPDATE attendance_challenges SET is_used = 1 WHERE id = ? AND is_used = 0
   ```
   If two requests attempt to reuse the same token simultaneously, only one succeeds and the other is rejected with HTTP 409 Conflict.
3. Duplicate daily attendance is mathematically prevented by the database constraint `UNIQUE(student_id, date)`.

### Geolocation Security & Limitation Acknowledgment
* GPS coordinates are evaluated exclusively on the server using the spherical Haversine formula.
* In thick concrete hostel rooms, GPS signals may degrade. HostelGuard accommodates this via interactive live radar maps and Wi-Fi beacon locking advice without weakening server-side radius checks.
* Impossible teleportation (velocities exceeding 100 km/h between check-in sessions) automatically triggers security incident flags in `security_audit_logs`.

---

## 3. 3-Strike Security Protocol & Account Lockout

* **Strike Accumulation**: Unverified location attempts outside the geofence perimeter, facial mismatches, or anomalous device signatures automatically increment the student's strike counter.
* **Account Lockout**: Upon reaching 3 strikes, the student's account is locked from roll call check-in.
* **Audit-Controlled Unlocking**: Unlocking requires administrative review in the `SecurityIncidentDesk`. The administrator or warden must provide a mandatory justification note, which is immutably recorded in `admin_audit_events`.

---

## 4. Biometric Data Privacy & Storage Compliance

* **Zero Raw Photo Retention**: Normal roll call verification does not store raw student face images on server disk or in SQLite. Images are processed in memory and discarded upon inference completion.
* **One-Way Mathematical Vectors**: Only 128-D normalized floating-point numerical embeddings are stored in `student_face_embeddings`. A 128-D vector cannot be mathematically reversed to reconstruct a student's photographic likeness.
* **Frontend Isolation**: Raw embedding vectors are **never** returned in API responses to client browsers or mobile devices. Endpoints return only boolean match flags, similarity scores, and user-friendly status messages.
* **Log Sanitization**: Application logs, database query logs, and error traces never print raw vector arrays, passwords, or session tokens.

---

## 5. Role-Based Access Control (RBAC) & IDOR Defenses

* **Strict Server-Side Authorization**: Every API route enforces `requireAuth` and role guards:
  - `requireRole('ADMIN')` — Full administrative oversight, roster management, geofence editing, timing, and system diagnostics.
  - `requireRole('WARDEN')` — Scoped hostel block roll call oversight, exception tracking, and correction reviews.
  - `requireRole('STUDENT')` — Attendance check-in, personal attendance history, profile, and support ticket submissions.
* **IDOR Prevention**: Student endpoints strictly scope all database queries to `req.user.student_id`. Students cannot read or alter attendance records, correction requests, or profiles belonging to other students.

---

## 6. File Upload & Formula Injection Security

* **CSV / JSON Roster Uploads**: Roster batch imports validate file extensions, MIME types, required columns, and data types.
* **Formula Injection Defense (DDE Attacks)**: All imported and exported tabular cell values are sanitized by neutralizing dangerous leading characters (`=`, `+`, `-`, `@`, `\t`, `\r`) with single quotes to prevent code execution when spreadsheets are opened in Microsoft Excel or Google Sheets.

---

## 7. Platform Hardening & Network Security

* **Security Headers (Helmet)**: Sets `X-Content-Type-Options`, `Strict-Transport-Security`, `X-Frame-Options`, and Content-Security policies.
* **CORS Restrictions**: Explicit origin whitelisting configured via `ALLOWED_ORIGINS` environment variables.
* **Rate Limiting**: Brute-force protection on authentication (`/api/v1/auth/login`) and OTP delivery endpoints (`/api/v1/auth/forgot-password`).
* **Database WAL & Concurrency Mutex**: SQLite Write-Ahead Logging (`PRAGMA journal_mode = WAL`) paired with thread-linearized transaction wrappers (`withTransaction`) prevents database locking and ensures atomic roll call operations under high student check-in concurrency.
