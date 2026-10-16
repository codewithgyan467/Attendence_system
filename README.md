# 🏨 HostelGuard Enterprise: Residential Attendance & Safety Platform

> **Institutional Edition v2.4**  
> *Production-Ready • Geo-Fenced • AI-Face-Verified • Zero Cloud API Costs*

HostelGuard Enterprise is an institutional, client-deployable attendance and resident safety management platform designed specifically for university hostels, dormitories, and residential campuses.

---

## 🌟 Key Platform Capabilities

1. **Real-World Attendance Time Management**:
   * Server-authoritative roll-call window enforcement (`19:00` – `19:30` / 7:00 PM – 7:30 PM default in `Asia/Kolkata` timezone).
   * Specific-date delay/extension overrides for college feasts, sports meets, cultural celebrations, or exams.
   * Bulk holiday list upload tool supporting CSV, Excel (`.xlsx`, `.xls`), and JSON.
2. **High-Precision Geofencing & Anti-Replay Protection**:
   * Server-side distance calculations against calibrated hostel perimeter boundaries.
   * Single-use cryptographic challenge tokens (180-second TTL) preventing network replay attacks.
   * Speed-based teleportation and mock-location detection.
3. **AI Biometric Verification & Liveness**:
   * Deep-learning face detection via OpenCV YuNet (5 facial landmarks) and SFace (128-dimensional embedding vectors).
   * Active multi-angle calibration (frontal, left 30°, right 30°, dynamic expression) to defeat presentation attacks.
4. **Clean Role-Based Portals**:
   * **Student Portal**: Live roll-call countdown, 3-step check-in wizard, summary cards, 7-day trend chart, appeal desk, and grievance ticketing.
   * **Warden Dashboard**: Block-filtered live roster, real-time absentee list, and emergency contact directory with direct calling.
   * **Admin Management Suite**: KPI dashboard, timing/schedule manager, student roster manager, geofence calibration, security alerts, and system health diagnostics.
5. **Data Hygiene & Purge Operations**:
   * Individual row deletion and single-click **Clear All** bulk purges across attendance records, corrections, security alerts, audit logs, and feedback tickets.

---

## 🔑 Evaluator Test Credentials

| Role | Username / Identifier | Password | Access Scope |
| :--- | :--- | :--- | :--- |
| **System Administrator** | `admin` | `Admin@12345` | Full Executive Dashboard, Timing & Schedules, Roster, Geofence, Security Alerts, Diagnostics |
| **Hostel Warden** | `warden` | `Warden@12345` | Block Supervision, Absent Residents Desk, Correction Reviews, Facility Feedback |
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

#### 2. Frontend (React 19 + Vite 6)
```bash
cd frontend
npm install
npm run dev
```
*Web Portal*: [http://localhost:3000](http://localhost:3000)

---

## 🧪 Automated Test Suite (85 of 85 Tests Passing)

Run the comprehensive integration test suite verifying authentication, OTP password resets, concurrency hardening, schedule windows, and bulk purges:
```bash
cd backend
npm test
```
```
Test Suites: 8 passed, 8 total
Tests:       85 passed, 85 total
Snapshots:   0 total
Time:        7.241 s
```

---

## 📚 Documentation Reference

* **System Architecture**: [docs/CURRENT_SYSTEM_ARCHITECTURE.md](docs/CURRENT_SYSTEM_ARCHITECTURE.md)
* **Student & Warden Guide**: [docs/USER_GUIDE.md](docs/USER_GUIDE.md)
* **Administrator Guide**: [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md)
* **Production Deployment Guide**: [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)
* **Security & Privacy Model**: [docs/SECURITY.md](docs/SECURITY.md)
* **Version 2.4 Release Notes**: [docs/RELEASE_NOTES.md](docs/RELEASE_NOTES.md)
* **Product Audit Report**: [FINAL_PRODUCT_AUDIT.md](FINAL_PRODUCT_AUDIT.md)

---

## 📄 License & Freedom

100% Free & Open-Source (FOSS) under the [MIT / Apache 2.0](LICENSE) licenses. Zero recurring cloud API fees.
