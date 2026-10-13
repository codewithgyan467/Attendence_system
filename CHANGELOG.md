# Engineering Changelog: HostelGuard Enterprise

## [v2.0.0-PROD] - 2026-10-14 (Production Transformation Release)

### Added
- **Bootstrap 5 & Chart.js Enterprise Dashboard**: Replaced all mock components and unstyled forms with a cohesive Bootstrap 5 design system, custom CSS variables, and Chart.js 4 visualizations (Line trend, Status Doughnut, Block Bar).
- **Three-Tier Role-Based Access Control (RBAC)**: Complete isolation of Administrator, Warden, and Student workflows with cryptographic JWT authentication and resource-level authorization.
- **SQLite WAL Production Database**:
  - Implemented `PRAGMA journal_mode = WAL;`, `foreign_keys = ON;`, `busy_timeout = 5000;`, and `synchronous = NORMAL;`.
  - Created automatic non-destructive column migrations (`ensureColumns`) supporting legacy databases.
  - Added atomic multi-query transaction wrapper `withTransaction`.
- **Pre-Registration Allotment CSV / JSON Import**:
  - Built conflict preview modal detecting duplicate roll numbers and missing fields before commit.
  - Enforced single-click transactional commit into `hostel_allotments`.
- **Admin Management Desks**:
  - `GeofenceManager`: Configures central GPS coordinates and radius with live device GPS detection.
  - `AttendanceManager`: Daily check-in log, CSV report export, and non-destructive administrative override modal.
  - `SecurityIncidentDesk`: 3-strike Forge Location tracker, flagged resident management, and auditable strike counter reset.
  - `CorrectionRequestDesk`: Formal appeal adjudication for warden/admin.
  - `FeedbackTicketDesk`: Facility support grievance tracking and response workflow.
  - `AuditLogViewer`: Searchable administrative audit trail.
- **Dedicated Warden Panel (`WardenDashboard.jsx`)**: Scoped hostel block overview, absent resident tracking, and correction reviews.
- **Student Self-Service Portal (`StudentPortal.jsx`)**: Biometric daily roll call, oval face camera stream, 30-day attendance history, and support grievance submissions.
- **Automated Integration Test Suite**: 21 Jest/Supertest tests covering Auth, RBAC, Geofencing, 3-strike forge rules, challenge replay protection, and roster conflict detection (100% pass rate).

### Repaired & Hardened
- **Eliminated All Mock Responses**: Replaced hardcoded arrays and simulated delays with real SQLite database queries.
- **Challenge Token Replay Vulnerability**: Replaced in-memory challenge maps with a persistent `attendance_challenges` table with single-use atomic consumption flags (`is_used = 1`).
- **Student Name Alteration Security Flaw**: Strictly enforced pre-populated dropdown selection from administrative allotment roster; students cannot edit their official identity.
- **Non-Destructive Overrides**: Manual overrides now preserve original check-in evidence and log an audit event with mandatory justification.
- **Clean Production Build**: Resolved all CSS syntax errors and verified that Vite compiles cleanly with zero warnings.
