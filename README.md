# 🏨 HostelGuard Enterprise: Residential Attendance & Safety Platform

> **Institutional Edition v4.0**  
> *Production-Ready • Three-Ring Fortress • AI MiniFASNet PAD • ESP32 BLE Anchored • Zero Cloud API Costs*

HostelGuard Enterprise is an institutional, client-deployable attendance and resident safety management platform designed specifically for university hostels, dormitories, and residential campuses.

---

## 🌟 Key Platform Capabilities

1. **Three-Ring Fortress Attendance Verification**:
   * **Ring 1 (Campus Geofence)**: High-precision Haversine perimeter calculations (<95 meters boundary).
   * **Ring 2 (GPS Anti-Spoofing Engine)**: Deep operating system inspection detecting `isMock` hardware flags, Fake GPS apps (JoyStick/Fly GPS), "Superman" teleportation velocity (>100 km/h), satellite jitter variance, and 15-second timestamp freshness guards.
   * **Ring 3 (Physical BLE Hardware Anchor)**: Wall-mounted ESP32 Bluetooth Low Energy beacons broadcasting corridor 2.4 GHz radio waves that cannot be faked or forwarded remotely.

2. **Facial Security Engine v4.0 (Presentation Attack Detection)**:
   * **Deep Learning Passive PAD**: MiniFASNetV2 ONNX (80x80 scale-2.7 context crop) evaluating screen replays, high-PPI mobile/laptop displays, and photo print attacks.
   * **Active Gesture Challenge**: Dynamic server-issued head pose and landmark challenges (blinking, nodding, head rotation) preventing pre-recorded video injection.
   * **Camera Integrity Guard**: Detection of virtual cameras (OBS, ManyCam), synthetic frames, and browser driver manipulation.
   * **Biometric Embedding**: OpenCV YuNet (5 facial landmarks) + SFace (128-dimensional cosine embedding vectors) with local CPU execution.

3. **Operational Redundancy & Incident Readiness**:
   * **Emergency Evacuation Muster Desk**: Real-time roll-call safety desk providing instant headcount of safe vs. unaccounted residents during fire drills or emergencies.
   * **In-Person Physical Fallback**: Sign-off protocol for students with facial bandages, medical injuries, or hardware camera failure.
   * **Hostel Roll Call Ledger**: Pure calendar day counts (Days Present / Days Absent) excluding official hostel holidays, eliminating misleading academic course percentages.
   * **Offline Resilient Queue**: Cryptographically signed local verifications auto-syncing seamlessly when connectivity returns.

4. **Clean Role-Based Portals**:
   * **Student Portal**: Evening roll-call wizard, BLE beacon detector, active gesture prompter, monthly presence summary, appeals, and support tickets.
   * **Warden Dashboard**: Block-filtered live roster, Emergency Muster Desk, in-person verification review, absent residents desk with direct emergency calling.
   * **Admin Management Suite**: KPI dashboard, timing & holiday manager, student roster manager, geofence calibration, security incident log, and automated SQLite WAL database maintenance.

---

## 🔑 Evaluator Test Credentials

| Role | Username / Identifier | Password | Access Scope |
| :--- | :--- | :--- | :--- |
| **System Administrator** | `admin` | `Admin@12345` | Executive Dashboard, Schedules, Roster, Geofence, Security Desk, Diagnostics |
| **Hostel Warden** | `warden` | `Warden@12345` | Block Supervision, Muster Desk, Physical Sign-off, Absent Desk, Facility Feedback |
| **Student Resident** | `2023CS01` *(or self-onboard)* | `Student@12345` | Evening Roll Call, Location & Face Verification, History, Appeals, Support Tickets |

---

## 🚀 Quick Start (Local Setup)

### Option A: One-Click Windows Launcher
Run in PowerShell:
```powershell
.\start_all.ps1
```

### Option B: Manual Startup

#### 1. Backend (Node.js API + SQLite WAL + Python AI Service)
```bash
cd backend
npm install
npm start
```
*Health Check*: [http://localhost:5000/health](http://localhost:5000/health)

#### 2. Frontend (React 18 + Vite 6 PWA)
```bash
cd frontend
npm install
npm run dev
```
*Web Portal*: [http://localhost:5173](http://localhost:5173) (or [http://localhost:3000](http://localhost:3000))

---

## 🧪 Automated Test Suite (121 of 121 Tests Passing)

Run the comprehensive 14-suite automated test matrix verifying authentication, OTP security, geofence algorithms, BLE sync, v4 facial security, and operational enhancements:
```bash
npm test
```
```
PASS tests/admin_master_recovery.test.js
PASS tests/auth.test.js
PASS tests/operational_enhancements.test.js
PASS tests/roster_import.test.js
PASS tests/password_reset.test.js
PASS tests/system_reverification.test.js
PASS tests/security_concurrency_hardening.test.js
PASS tests/attendance_schedule_and_purges.test.js
PASS tests/backup_restore.test.js
PASS tests/attendance_rules.test.js
PASS tests/v3_antispoof_security.test.js
PASS tests/offline_ble_sync.test.js
PASS tests/v4_facial_security_engine.test.js
PASS tests/geofence.test.js

Test Suites: 14 passed, 14 total
Tests:       121 passed, 121 total
Snapshots:   0 total
```

---

## 📚 Certified Release Documentation & Architecture

* **v4.0 PAD Architecture**: [HOSTELGUARD_PAD_V4_ARCHITECTURE.md](HOSTELGUARD_PAD_V4_ARCHITECTURE.md) *(also in [docs/reports/](docs/reports/HOSTELGUARD_PAD_V4_ARCHITECTURE.md))*
* **Attack Validation Matrix**: [HOSTELGUARD_ATTACK_VALIDATION_MATRIX.md](HOSTELGUARD_ATTACK_VALIDATION_MATRIX.md) *(also in [docs/reports/](docs/reports/HOSTELGUARD_ATTACK_VALIDATION_MATRIX.md))*
* **Biometric Model Benchmark**: [HOSTELGUARD_MODEL_COMPARISON.md](HOSTELGUARD_MODEL_COMPARISON.md) & [HOSTELGUARD_PERFORMANCE_BENCHMARK.md](HOSTELGUARD_PERFORMANCE_BENCHMARK.md)
* **Camera Integrity & Virtual Defenses**: [HOSTELGUARD_CAMERA_INTEGRITY_REPORT.md](HOSTELGUARD_CAMERA_INTEGRITY_REPORT.md)
* **System Known Limitations**: [HOSTELGUARD_KNOWN_LIMITATIONS.md](HOSTELGUARD_KNOWN_LIMITATIONS.md)
* **System Architecture**: [docs/architecture/CURRENT_SYSTEM_ARCHITECTURE.md](docs/architecture/CURRENT_SYSTEM_ARCHITECTURE.md)
* **21 BCNF Database Schema**: [docs/architecture/DATABASE_SCHEMA.md](docs/architecture/DATABASE_SCHEMA.md)
* **Master Presentation & Engineering Report**: [docs/reports/hostelguard_presentation_and_engineering_report.md](docs/reports/hostelguard_presentation_and_engineering_report.md)
* **Camera & Facial Verification Specification**: [docs/reports/CAMERA_FACE_VERIFICATION_WORKFLOW_REPORT.md](docs/reports/CAMERA_FACE_VERIFICATION_WORKFLOW_REPORT.md)
* **GPS & Zero-Cloud Geofencing Specification**: [docs/reports/GPS_GEOFENCE_ANTI_SPOOFING_WORKFLOW_REPORT.md](docs/reports/GPS_GEOFENCE_ANTI_SPOOFING_WORKFLOW_REPORT.md)
* **Final Production Certification Audit**: [docs/reports/FINAL_PRODUCTION_AUDIT.md](docs/reports/FINAL_PRODUCTION_AUDIT.md)
* **Security & Threat Model Guide**: [docs/architecture/SECURITY.md](docs/architecture/SECURITY.md)
* **Student & Warden Guide**: [docs/guides/USER_GUIDE.md](docs/guides/USER_GUIDE.md)
* **Administrator Guide**: [docs/guides/ADMIN_GUIDE.md](docs/guides/ADMIN_GUIDE.md)
* **Production Deployment Guide**: [docs/guides/DEPLOYMENT_GUIDE.md](docs/guides/DEPLOYMENT_GUIDE.md)

---

## 📄 License & Freedom

100% Free & Open-Source (FOSS) under the [MIT / Apache 2.0](LICENSE) licenses. Zero recurring cloud API fees.
