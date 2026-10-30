# Architecture Blueprint: HostelGuard Enterprise

## 1. System Overview

HostelGuard is an enterprise-grade, privacy-first, 100% Free & Open-Source (FOSS) Smart Hostel Attendance System. It combines server-authoritative Haversine geofence boundary validation with local computer-vision facial verification (OpenCV YuNet and SFace 128-dimensional embedding vectors) and an immutable SQLite database operating in Write-Ahead Logging (WAL) mode.

```
                    ┌────────────────────────────────────────────────────────┐
                    │               REACT + VITE PWA FRONTEND                │
                    │               (Bootstrap 5 + Chart.js)                 │
                    └───────────▲────────────────────────────────┬───────────┘
                                │                                │
                      REST / JSON (Port 5000)          Reverse Proxy / Vite
                                │                                │
                    ┌───────────▼────────────────────────────────▼───────────┐
                    │               NODE.JS EXPRESS CORE BACKEND             │
                    │  ┌──────────────────────────────────────────────────┐  │
                    │  │ Middleware: JWT Auth, RBAC, Rate Limiting, Helmet│  │
                    │  ├──────────────────────────────────────────────────┤  │
                    │  │ Domain Routes: Admin, Warden, Student, Attendance│  │
                    │  ├──────────────────────────────────────────────────┤  │
                    │  │ Services: Geofence (Haversine), Fraud Engine     │  │
                    │  └───────────────────────┬──────────────────────────┘  │
                    └──────────┬───────────────┼─────────────────────────────┘
                               │               │
                 Internal IPC / HTTP (Port 8000) Atomic WAL Transactions
                               │               │
      ┌────────────────────────▼─────┐   ┌─────▼─────────────────────────┐
      │     PYTHON FASTAPI SERVICE   │   │       SQLITE DATABASE         │
      │  ┌─────────────────────────┐ │   │  hostel_attendance.sqlite     │
      │  │ OpenCV YuNet Detection  │ │   │  - PRAGMA journal_mode = WAL  │
      │  ├─────────────────────────┤ │   │  - PRAGMA foreign_keys = ON   │
      │  │ OpenCV SFace 128D Embed │ │   │  - PRAGMA busy_timeout = 5000 │
      │  ├─────────────────────────┤ │   │  - PRAGMA synchronous = NORMAL│
      │  │ Laplacian & FFT Moiré   │ │   └───────────────────────────────┘
      │  └─────────────────────────┘ │
      └──────────────────────────────┘
```

---

## 2. Layered Component Responsibilities

### Layer 1: Presentation & Client PWA (`frontend/`)
- **Technology Stack**: React 18, Vite 6, Bootstrap 5.3.3, Chart.js 4.4.8, `lucide-react`.
- **Role Isolation**:
  - **Administrator Dashboard**: Executive KPIs, live weekly trend line charts, check-in status doughnut charts, block distribution bar charts, CSV roster preview & commit, geofence perimeter configurator, non-destructive attendance overrides, security alert management, strike counter resets, and audit trail viewer.
  - **Warden Panel**: Floor/block occupancy overview, daily absent resident tracking, roll call exceptions, resident appeal reviews, and facility grievance desk.
  - **Student Portal**: Device geolocation check, real-time oval face camera verification, 30-day attendance history, attendance appeal submissions, facility support requests, and profile metadata.
- **Security Boundary**: Zero authoritative attendance decisions or role authorization checks occur in client code. The UI renders reactive views based on cryptographic JWT token validation.

### Layer 2: API & Transport Gateway (`backend/src/server.js`)
- **Security Middleware**:
  - `helmet`: HTTP headers protection (`X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`).
  - `cors`: Strict origin allowlisting matching configured production domain.
  - `express-rate-limit`: Tiered window limits preventing credential stuffing (`authLimiter`), brute-force check-ins (`attendanceLimiter`), and general traffic abuse (`generalLimiter`).
  - `X-Request-Id`: Globally unique request correlation UUID tracking.
- **Graceful Lifecycle**: Structured process shutdown catching `SIGINT`/`SIGTERM` to close database locks and terminate background Python microservices cleanly.

### Layer 3: Authentication & Authorization (`backend/src/middleware/auth.js`)
- **Token Format**: Standard JSON Web Tokens (JWT) signed with HMAC-SHA256 (`JWT_SECRET`).
- **Password Protection**: Salted bcrypt password hashes (cost factor 10).
- **Access Control**: Role-based access control (RBAC) via `requireRole('ADMIN' | 'WARDEN' | 'STUDENT')`.
- **Audit Logging**: `recordAuditEvent` captures user IDs, actions, target entities, IP addresses, and user-agent strings.

### Layer 4: Business Logic & Domain Services
- **Geofence Engine (`geofenceService.js`)**:
  - Implements the Haversine great-circle formula calculating spherical distance:
    $$d = 2r \arcsin\left(\sqrt{\sin^2\left(\frac{\Delta\phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta\lambda}{2}\right)}\right)$$
  - Evaluates device reported accuracy and mock location provider flags.
  - Zero cloud dependencies or external third-party API keys required.
- **Fraud & Security Engine (`fraudService.js`)**:
  - Persistent 3-strike Forge Location tracker.
  - Reaching 3 out-of-boundary submissions triggers account lockout (`is_flagged_forge = 1`) and logs an incident in `security_audit_logs`.
  - Account unlocking requires administrative override with mandatory reason.

### Layer 5: Database Access Layer (`backend/src/db/database.js`)
- **Storage Engine**: SQLite 3 with WAL mode (`PRAGMA journal_mode = WAL;`) allowing concurrent readers without write contention.
- **Foreign Key Integrity**: Enforced at connection time (`PRAGMA foreign_keys = ON;`).
- **Atomic Operations**: `withTransaction(callback)` wrapper executing multi-query workflows within `BEGIN IMMEDIATE TRANSACTION` / `COMMIT` / `ROLLBACK`.
- **Automatic Migration**: `ensureColumns()` automatically migrates schema alterations non-destructively.

### Layer 6: Computer Vision Microservice (`backend/ai_service/`)
- **Framework**: Python 3.10+, FastAPI, Uvicorn.
- **Face Detection**: YuNet ONNX model (`face_detection_yunet_2023mar.onnx`).
- **Embedding Generation**: SFace ONNX model (`face_recognition_sface_2021dec.onnx`) generating standardized 128-dimensional unit vectors.
- **Anti-Spoofing & Liveness**:
  - Laplacian variance texture analysis.
  - 2D Fast Fourier Transform (FFT) moiré frequency pattern detection.
- **Cosine Similarity**: Vector dot-product similarity matching with threshold $\tau = 0.65$.
