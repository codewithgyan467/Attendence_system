# 🏨 HostelGuard Enterprise: Smart Hostel Attendance System
### 100% Free & Open-Source (FOSS) • Zero Cloud API Costs • Local & Self-Hosted

HostelGuard Enterprise is a production-ready, client-deployable biometric and geofenced hostel attendance management platform. It combines server-authoritative Haversine boundary calculations with local computer-vision facial verification (OpenCV YuNet detection + SFace 128-dimensional embedding vectors) and an immutable SQLite database operating in Write-Ahead Logging (WAL) mode.

---

## 🌟 100% Free & Open-Source (FOSS) Architecture

| Domain | FOSS Technology Implemented | Guarantee |
|---|---|---|
| **Database** | Embedded SQLite 3 in WAL mode | Zero subscription fees. ACID transactions with foreign key enforcement. |
| **Geofencing** | Server-side Haversine Great-Circle Algorithm | Pure mathematical calculation. **Zero Google Maps API costs**. |
| **Face Detection** | OpenCV YuNet (`face_detection_yunet.onnx`) | Apache 2.0 license. Offline neural face detection and alignment. |
| **Face Recognition** | OpenCV SFace (`face_recognition_sface.onnx`) | Extracts 128-D unit vectors locally. **Zero AWS/Azure Rekognition fees**. |
| **Liveness Analysis** | Laplacian Texture Variance + 2D FFT Moiré | Analyzes frequency patterns locally to reject screen replays & photos. |
| **UI Design System** | Bootstrap 5.3.3 + Chart.js 4.4.8 | Enterprise SaaS responsive design for Desktop, Tablet, and Mobile PWA. |

---

## 🔑 Quick Evaluator Login Credentials

| Role | Username | Default Password | Access Level |
|---|---|---|---|
| **System Administrator** | `admin` | `Admin@12345` | Full Executive Dashboard, Roster Import, Geofence Config, Security Desks, Audit Logs |
| **Hostel Warden** | `warden` | `Warden@12345` | Block Supervision, Absent Residents Desk, Correction Reviews, Facility Feedback |
| **Student Resident** | Self-Onboard | `Student@12345` | Daily Roll Call, GPS & Face Camera, Attendance History, Appeals, Support Tickets |

---

## 🏗️ The 3 Production Workflow Phases

```
           PHASE 1: ADMIN SETUP & ROSTER IMPORT
   [Upload Allotment CSV / JSON] ──► [Conflict Preview (Dup Detection)]
   [Commit Transaction to DB]    ──► [Configure Geofence Perimeter (15-20m)]
                  │
                  ▼
         PHASE 2: STUDENT ONBOARDING
   [Searchable Dropdown (Cannot manually type official name)]
   [Academic Details] ──► [3-Angle Live Camera Capture]
   [OpenCV Extracts 128D Embeddings] ──► [Student Profile Persisted]
                  │
                  ▼
        PHASE 3: DAILY ATTENDANCE ROLL CALL
   1. GPS Check: Server calculates Haversine distance from device coordinates.
      ├─► Outside / Mock Spoofer ──► Rejection (HTTP 403). Records strike (1 to 3).
      │                              Reaching 3 strikes locks account & alerts Admin.
      └─► In Perimeter (<= 20m) ───► Issues single-use 5-minute challenge token.
   2. Face Check: Live camera frame -> Anti-spoof analysis -> Cosine Similarity >= 0.65.
      ├─► Mismatch / Spoof ────────► Rejection recorded in security logs.
      └─► Matched ─────────────────► Transactionally marks "PRESENT" in attendance_records.
```

---

## 🚀 Quick Start (Running Locally)

### Option A: One-Click Windows Launcher
Double-click `start_all.bat` or run in PowerShell:
```powershell
.\start_all.ps1
```

### Option B: Manual Startup (Strictly Two Folders)

#### 1. Backend (Node.js API + SQLite WAL + Python AI Service)
```powershell
cd backend
npm.cmd install
npm.cmd start
```
*Health Check*: [http://localhost:5000/health](http://localhost:5000/health)

#### 2. Frontend (React Vite PWA)
```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```
*Web Portal*: [http://localhost:3000](http://localhost:3000)

---

## 🧪 Automated Test Suite (100% Pass Rate)

Run the comprehensive integration test suite verifying authentication, RBAC, Haversine math, 3-strike forge rules, challenge replay protection, and roster conflict preview:
```powershell
cd backend
npm.cmd test
```
```
PASS tests/attendance_rules.test.js
PASS tests/auth.test.js
PASS tests/roster_import.test.js
PASS tests/geofence.test.js

Test Suites: 4 passed, 4 total
Tests:       21 passed, 21 total
Time:        2.325 s
```

---

## 📚 Complete Architectural Documentation

- [ENGINEERING_AUDIT.md](file:///e:/attendence_Hostel_system/ENGINEERING_AUDIT.md) — Baseline defect audit and remediation record.
- [IMPLEMENTATION_PLAN.md](file:///e:/attendence_Hostel_system/IMPLEMENTATION_PLAN.md) — Detailed 10-stage execution plan.
- [ARCHITECTURE.md](file:///e:/attendence_Hostel_system/ARCHITECTURE.md) — Multi-tier system architecture and service boundaries.
- [DATABASE_SCHEMA.md](file:///e:/attendence_Hostel_system/DATABASE_SCHEMA.md) — SQLite WAL schema, tables catalog, ERD, and indexes.
- [API_DOCUMENTATION.md](file:///e:/attendence_Hostel_system/API_DOCUMENTATION.md) — REST endpoints specification and payloads.
- [SECURITY.md](file:///e:/attendence_Hostel_system/SECURITY.md) — Threat models, liveness limits, and security controls.
- [PRIVACY_AND_BIOMETRIC_DATA.md](file:///e:/attendence_Hostel_system/PRIVACY_AND_BIOMETRIC_DATA.md) — Biometric data minimization policy.
- [TESTING_REPORT.md](file:///e:/attendence_Hostel_system/TESTING_REPORT.md) — Exact pass/fail counts and test evidence.
- [PERFORMANCE_REPORT.md](file:///e:/attendence_Hostel_system/PERFORMANCE_REPORT.md) — Latency benchmarks and database indexing metrics.
- [DEPLOYMENT_GUIDE.md](file:///e:/attendence_Hostel_system/DEPLOYMENT_GUIDE.md) — Production setup, environment variables, and Nginx proxy.
- [BACKUP_AND_RECOVERY.md](file:///e:/attendence_Hostel_system/BACKUP_AND_RECOVERY.md) — Atomic WAL snapshot scripts and rollback checklists.
- [TROUBLESHOOTING.md](file:///e:/attendence_Hostel_system/TROUBLESHOOTING.md) — Diagnostic trees and operator resolution steps.
- [CHANGELOG.md](file:///e:/attendence_Hostel_system/CHANGELOG.md) — Transformation release history.

---

## 📱 Native Android Mobile App (Capacitor FOSS Wrapper)

The system includes a production-grade native Android wrapper built into `frontend/` powered by **Capacitor**. It wraps the Vite React application while binding directly to native Android GPS hardware and camera sensors:

- **Hardware GPS & Mock Spoofer Detection**: Queries Android's native `LocationManager` via `@capacitor/geolocation` and inspects `isMock` flags to enforce anti-forgery geofencing.
- **Hardware Camera**: Direct hardware selfie camera capture via `@capacitor/camera` and WebRTC Chromium bridge.
- **Strict Two-Folder Layout**: All Android project files and Gradle configurations reside strictly inside `frontend/android/`.

### Building & Running the Android App

1. Ensure [Android Studio](https://developer.android.com/studio) and Android SDK are installed.
2. Build the web distribution and sync the native Android project:
   ```powershell
   cd frontend
   npm run cap:build
   ```
3. Open the native Android project in Android Studio:
   ```powershell
   npm run cap:open
   ```
4. Connect an Android phone or launch an Android Virtual Device (AVD) emulator, then click **Run (Play)** in Android Studio.
5. To compile a standalone debug APK from the command line:
   ```powershell
   cd frontend/android
   ./gradlew assembleDebug
   # Output APK will be at frontend/android/app/build/outputs/apk/debug/app-debug.apk
   ```

---

## 📁 Repository Layout

```
attendence_Hostel_system/
├── backend/                      # [FOLDER 1] Core API, Database, and Computer Vision
│   ├── src/
│   │   ├── db/database.js        # SQLite WAL database & migration engine
│   │   ├── middleware/auth.js    # JWT verification & RBAC authorization
│   │   ├── middleware/rateLimiter.js # Tiered IP-based rate limiters
│   │   ├── services/
│   │   │   ├── geofenceService.js# Haversine great-circle calculation
│   │   │   ├── fraudService.js   # 3-strike Forge Location tracker
│   │   │   └── aiServiceClient.js# HTTP client to local Python microservice
│   │   ├── routes/
│   │   │   ├── authRoutes.js     # User authentication & credentials
│   │   │   ├── adminRoutes.js    # Dashboard stats, Roster import, Overrides, Desks
│   │   │   ├── wardenRoutes.js   # Block supervision & resident appeals
│   │   │   ├── studentRoutes.js  # Dropdown allotment list, onboarding, history
│   │   │   └── attendanceRoutes.js # Step 1 GPS check & Step 2 Face scan
│   │   └── server.js             # Express application & lifecycle manager
│   ├── ai_service/               # Python FastAPI Microservice
│   │   ├── app/models/           # YuNet & SFace ONNX neural models
│   │   └── app/services/         # Anti-spoofing frequency & texture analysis
│   ├── data/                     # SQLite database storage file
│   └── tests/                    # Jest/Supertest integration test suite
│
├── frontend/                     # [FOLDER 2] React Vite PWA & Android Native Wrapper
│   ├── android/                  # Native Android Studio Gradle Project (Capacitor)
│   │   ├── app/src/main/AndroidManifest.xml # Native GPS & Camera hardware permissions
│   │   └── build.gradle          # Android Gradle build script
│   ├── src/
│   │   ├── components/
│   │   │   ├── admin/            # Executive Dashboard, Charts, Roster, Geofence, Desks
│   │   │   ├── warden/           # Warden Operations Dashboard
│   │   │   ├── student/          # Student Attendance Portal & Camera Scanner
│   │   │   ├── auth/             # SaaS Login Page & Demo Selectors
│   │   │   └── common/           # Bootstrap 5 Navbar, Sidebar, KPI Cards
│   │   ├── context/AuthContext.jsx # Reactive session & role state provider
│   │   ├── utils/
│   │   │   ├── api.js            # Authoritative API client with auto JWT
│   │   │   └── nativeHardware.js # Unified Capacitor GPS & Camera hardware bridge
│   │   └── App.jsx               # Role-based workspace coordinator
│   ├── capacitor.config.json     # Mobile wrapper configuration & appId
│   └── index.css                 # Custom enterprise Bootstrap 5 design theme
│
├── start_all.bat                 # One-click Windows batch launcher
├── start_all.ps1                 # One-click PowerShell launcher
└── test_pipeline.py              # End-to-end Python pipeline integration test
```
