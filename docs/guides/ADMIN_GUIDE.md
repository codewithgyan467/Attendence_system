# HostelGuard: Administrator Operational Guide

This guide describes operational workflows for hostel directors, estate managers, and system administrators.

---

## 1. Executive Overview & Daily Supervision

The **Executive Dashboard** (`AdminDashboard.jsx`) presents high-level institutional metrics:
* **Total Registered Students**: Active residents in the hostel database.
* **Present Today & Attendance Rate**: Current roll-call coverage and late arrivals.
* **Absent / Unmarked**: Count of residents who have not checked in.
* **Security & Forge Alerts**: Active accounts flagged for security review.
* **Weekly Attendance Trend & Block Distribution**: Chart.js visualizations comparing block-by-block residential compliance.

---

## 2. Managing Timing, Events & Holidays

Access **Timing & Holidays** (`AttendanceScheduleManager.jsx`) to control roll-call windows:

### 2.1. Adjusting Default Daily Hours
1. In the **Default Daily Schedule** panel, configure the default start time (default `19:00` / 7:00 PM) and end time (default `19:30` / 7:30 PM).
2. Toggle schedule enforcement on or off as required.
3. Tap **Save Schedule Settings**. Changes take effect instantly across all connected student devices.

### 2.2. Setting Delayed Hours for Feasts & Cultural Events
On days when college dinners, cultural programs, or sports tournaments take place:
1. Select the target **Date**.
2. Enter an **Event Title** (e.g., *"Diwali Cultural Night Extension"*).
3. Set custom **Start Time** and **End Time** (e.g., `20:30` to `21:30`).
4. Enter notes and tap **Save Schedule Exception**. The system will enforce the custom hours exclusively for that date.

### 2.3. Bulk Uploading Holiday Lists
1. In the **Bulk Holiday Roster Upload** card, upload your semester calendar as a CSV or Excel (`.xlsx`) file.
2. The system automatically reads `Date`, `Reason`, and `Is Holiday` columns.
3. Days marked as holidays will automatically display holiday exemption banners and excuse students from roll call.

---

## 3. Student Roster Management & Bulk Enrollment

Access **Student Roster** (`StudentRosterManager.jsx`) for enrollment and room allotment:
* **Bulk Import (CSV / Excel)**: Upload pre-allotment rosters containing Roll Number, Name, Block, Room, Email, Phone, and Course.
* **No Pre-Created Passwords Required**: Students can complete self-onboarding using OTP verification delivered to their registered email/phone.
* **Search & Filters**: Search by student name, roll number, or filter by hostel block and activation status.

---

## 4. Geofence Perimeter Calibration

Access **Geofence Perimeter** (`GeofenceManager.jsx`):
* **Visual Map Editor**: Drag the center marker to position the hostel boundary on the Leaflet map.
* **Radius Slider**: Adjust permitted check-in radius (e.g. 20m, 35m, 50m) based on hostel building dimensions.
* **Real-Time Accuracy**: Test coordinates directly against physical landmarks to verify perimeter boundaries.

---

## 5. Security & 3-Strike Lockout Management

Access **Security & Forge Alerts** (`SecurityIncidentDesk.jsx`):
* **Incident Feed**: Displays attempts to mark attendance outside the geofence perimeter or with mismatched biometric identities.
* **3-Strike Lockout**: When an account reaches 3 strikes, the system automatically locks attendance permissions.
* **Resetting Strikes**:
  1. Click **Reset Strikes** next to the student's name.
  2. Enter a **Mandatory Justification Reason** (e.g., *"Student demonstrated GPS sensor variance inside Room 302; verified physical presence"*).
  3. Confirm reset. Strikes return to 0 and the account is immediately unlocked. The action is logged to the permanent audit trail.

---

## 6. System Health, Backups & Diagnostics

Access **System Health** (`AdminDiagnostics.jsx`):
* **Component Status**: Operational status of Core API, SQLite Database Storage, Biometric Identity Verification, and Automated Backups.
* **Snapshot Backups**: Click **Create Backup Snapshot** to generate an encrypted SQLite backup in `backend/data/backups/`.
* **Technical Details**: View runtime Node.js version, database integrity status, and backup archives.

---

## 7. Data Purging & Retention Operations

Every major management desk provides individual trash-can deletion and single-click **Clear All** bulk purges to clean up stale test data or past-year records:
* **Correction Requests**: Purge resolved or obsolete appeal records.
* **Security & Forge Alerts**: Clear historical alert logs while preserving student strike tallies.
* **Audit Logs**: Clear past administrative activity entries.
* **Attendance Records**: Purge attendance marks for a specific selected date or perform an administrative clean slate.
