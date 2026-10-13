# 🛡️ Engineering Baseline Audit Report
**Project**: Smart Hostel Attendance System (Production Transformation)  
**Date**: October 14, 2026  
**Auditor**: Senior Software Architect & Lead Security Engineer  

---

## 1. Executive Summary

This baseline audit investigates the repository `e:\attendence_Hostel_system`, evaluating architecture, authentication, database integrity, computer-vision models, security hardening, user interface, and operational readiness.

The project currently has a working technical prototype divided into two primary directories (`backend/` and `frontend/`). While the core algorithms (Haversine geofence calculation, OpenCV YuNet detection, and SFace 128-D embedding extraction) function, the system lacks production-grade authentication, role-based access control (RBAC), transactional database reliability, input sanitization, rate limiting, and an enterprise UI.

---

## 2. Component-by-Component Baseline Audit

### 2.1 Authentication & Authorization
| Component | Current State | Classification | Risk Level |
|---|---|---|---|
| User Table & Identity | None. No `users` table; no passwords stored. | **Missing** | 🔴 CRITICAL |
| Password Hashing | None. No bcrypt or Argon2 hashing implemented. | **Missing** | 🔴 CRITICAL |
| Role-Based Access Control | None. Any client can invoke `/api/v1/admin/*` endpoints without authentication. | **Broken / Missing** | 🔴 CRITICAL |
| Session & Challenge Security | Attendance challenge token stored in an in-memory JS `Map()`; wiped on restart, no cryptographic signature. | **Partially Implemented** | 🟠 HIGH |

### 2.2 Database Architecture & Data Integrity
| Component | Current State | Classification | Risk Level |
|---|---|---|---|
| Foreign Key Enforcement | SQLite driver does not enforce `PRAGMA foreign_keys = ON;`. | **Broken** | 🟠 HIGH |
| Concurrency (WAL Mode) | WAL mode (`PRAGMA journal_mode = WAL;`) not configured; default rollback journal susceptible to database lock contention. | **Performance-Critical** | 🟠 HIGH |
| Relational Entities | Missing tables for `users`, `hostel_blocks`, `rooms`, `attendance_corrections`, `admin_audit_events`, `feedback_tickets`, and persistent `attendance_challenges`. | **Missing** | 🟡 MEDIUM |
| Transactions | Multi-row batch operations (CSV allotment upload, attendance logging + audit) execute without SQLite `BEGIN TRANSACTION`/`COMMIT`. | **Partially Implemented** | 🟠 HIGH |
| Indexes | Only primary key index exists. No indexes on `student_id`, `roll_number`, `date`, or `created_at`. | **Performance-Critical** | 🟡 MEDIUM |

### 2.3 Geofencing & Fraud Prevention
| Component | Current State | Classification | Risk Level |
|---|---|---|---|
| Haversine Algorithm | Pure mathematical spherical trigonometric formula implemented correctly on the backend. | **Implemented & Verified** | 🟢 LOW |
| Server-Authoritative Distance | Server calculates distance using validated GPS coordinates; does not accept client-submitted distance. | **Implemented & Verified** | 🟢 LOW |
| Mock GPS & 3-Strike Tracking | Tracks consecutive failed attempts and flags `is_flagged_forge = 1` on strike 3. Stored in database. | **Implemented & Verified** | 🟢 LOW |
| Challenge Expiration & Replay | Challenge token exists but lacks single-use consumption guarantee and persistent replay protection. | **Partially Implemented** | 🟠 HIGH |

### 2.4 Biometrics & Computer Vision Pipeline
| Component | Current State | Classification | Risk Level |
|---|---|---|---|
| Face Detection | OpenCV YuNet (`face_detection_yunet.onnx`, 232 KB) loaded and verified. | **Implemented & Verified** | 🟢 LOW |
| Facial Embeddings | OpenCV SFace (`face_recognition_sface.onnx`, 36.9 MB) loaded and verified. Generates 128-D vectors. | **Implemented & Verified** | 🟢 LOW |
| Cosine Matching | Unit $L_2$ normalization and dot product cosine similarity implemented. | **Implemented & Verified** | 🟢 LOW |
| Anti-Spoofing & Liveness | Laplacian texture variance and 2D FFT frequency moiré pattern detection implemented. Presentation-attack mitigation is functional but must be documented with honest limitations (not foolproof against all spoof vectors). | **Implemented with Limitations** | 🟡 MEDIUM |

### 2.5 Presentation Layer & User Interface
| Component | Current State | Classification | Risk Level |
|---|---|---|---|
| UI Framework | Custom dark-theme CSS in React. Lacks modern Bootstrap 5 enterprise standards. | **Needs Replacement** | 🟡 MEDIUM |
| Data Visualizations | Dashboard uses static KPI text. Lacks Chart.js charts for daily/weekly trends and block breakdowns. | **Missing** | 🟡 MEDIUM |
| Separate Panels | No isolated Admin, Student, and Warden portals. Everything is mounted on a single tab switcher. | **Needs Restructuring** | 🟠 HIGH |
| CRUD Operations | Roster upload exists, but lacks student edit/view/deactivate, room assignment, correction requests, and feedback ticketing. | **Partially Implemented** | 🟡 MEDIUM |

### 2.6 Security & Hardening
| Component | Current State | Classification | Risk Level |
|---|---|---|---|
| HTTP Security Headers | No Helmet middleware; missing CSP, HSTS, X-Content-Type-Options. | **Missing** | 🟠 HIGH |
| Rate Limiting | No rate limiting on login, GPS verification, or face recognition endpoints. | **Missing** | 🟠 HIGH |
| Input Validation | Ad-hoc `if (!roll_number)` checks; missing centralized schema validation (`express-validator`). | **Partially Implemented** | 🟡 MEDIUM |
| CORS Configuration | Wildcard `*` in development; needs strict origin restriction in production. | **Security-Critical** | 🟠 HIGH |

---

## 3. Prioritized Remediation Roadmap

1. **Security & Authentication Layer (Priority 1 - Critical)**:
   - Create `users` table with roles (`ADMIN`, `WARDEN`, `STUDENT`).
   - Implement `bcryptjs` password hashing and JWT authentication middleware.
   - Implement role-based authorization guards on all API routes.
   - Seed default initial admin (`admin` / `Admin@12345`) and warden accounts safely with forced password change support.
2. **Database Engine & Domain Schema (Priority 2 - High)**:
   - Configure SQLite WAL mode, foreign keys, and busy timeout.
   - Build complete relational schema: `users`, `hostel_blocks`, `rooms`, `hostel_allotments`, `students`, `student_face_embeddings`, `geofence_configs`, `attendance_challenges`, `attendance_records`, `attendance_corrections`, `security_audit_logs`, `admin_audit_events`, `feedback_tickets`.
   - Add database migration runner and seed scripts.
   - Implement transactions (`BEGIN` / `COMMIT` / `ROLLBACK`) for multi-record operations.
3. **Core Backend APIs & Services (Priority 3 - High)**:
   - Complete CRUD endpoints for students, rooms, allotments, geofences, attendance corrections, and feedback.
   - Centralize validation with `express-validator`.
   - Add `helmet` security headers and `express-rate-limit`.
   - Enhance attendance challenge tokens with single-use replay protection.
4. **AI Vision & Liveness Calibration (Priority 4 - Medium)**:
   - Document calibrated thresholds and SFace 128-D vector characteristics.
   - Strengthen image quality checks (blur, illumination, face count).
   - Ensure clean separation between production biometric processing and automated test mock endpoints.
5. **Frontend Transformation (Priority 5 - High)**:
   - Implement Bootstrap 5 SaaS design system with custom CSS variables.
   - Implement real Chart.js visualizations (weekly trends, attendance ratios, block distributions).
   - Build 3 isolated, role-guarded panels: **Admin Panel**, **Warden Panel**, and **Student Portal**.
   - Connect all panels to live database APIs (eliminate any mock state).
6. **Automated Testing & DevSecOps (Priority 6 - High)**:
   - Build comprehensive integration test suite (Jest + Supertest) covering auth, RBAC, geofencing, transactions, attendance uniqueness, and security.
   - Verify backup and restore procedures.
   - Complete 14-point documentation suite.
