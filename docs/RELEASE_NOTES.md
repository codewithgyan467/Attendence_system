# HostelGuard: Release Notes

## Version 2.4 (Institutional Production Edition) — October 2026

### 🌟 Key Highlights & Major Features

1. **Client-Facing UI & Information Architecture Polish**:
   * Removed internal engineering jargon (e.g., SQLite WAL, YuNet, SFace 128-D, Haversine equations, and cosine similarity metrics) from normal student and staff viewports.
   * Established a unified, responsive Bootstrap 5.3 design system with institutional cards, badges, and progress indicators.
   * Designed a dedicated **System Health & Diagnostics** desk (`AdminDiagnostics.jsx`) with humanized status indicators (API: Operational, Database: Operational, Identity: Operational) and collapsible technical details.

2. **Real-World Attendance Time Management**:
   * Authoritative server clock enforcement with `Asia/Kolkata` timezone support.
   * Default roll-call window set to night **7:00 PM – 7:30 PM (`19:00` – `19:30`)**.
   * Admin capabilities to set delayed/extended hours for special occasions (feasts, festivals, cultural celebrations, examinations).
   * Bulk holiday list upload tool supporting CSV, Excel (`.xlsx`, `.xls`), and JSON.
   * Live countdown and status indicators in the Student Portal.

3. **3-Step Attendance Verification Wizard & Polished Confirmation**:
   * Clear 3-step progress indicator: `1. Confirm Location` ➔ `2. Verify Identity` ➔ `3. Complete`.
   * Clear single dominant CTA button: `✓ Mark Attendance`.
   * Polished success screen presenting date, time marked, verified location, and verified identity.
   * Student summary dashboard cards (Overall Attendance, Present Days, Absent Days, Identity Status) paired with clean 7-day roll-call trend visualizations.

4. **Comprehensive Data Hygiene & Purge Operations**:
   * Added both individual row deletion and single-click **Clear All** bulk purges across all historical data desks (Attendance Records, Correction Requests, Security Alerts, Audit Logs, and Feedback Tickets).
   * Double-confirmation safety dialogs displaying exact record counts before deletion.

5. **Security & Anti-Spoofing Protocol**:
   * Challenge-token anti-replay defenses (3-minute TTL).
   * High-precision geolocation clearance with mock-location and speed teleportation filters.
   * Multi-angle facial calibration (front, left, right, expression) with OpenCV YuNet & SFace.
   * 3-strike security lockout with mandatory justification audit trail.

---

### 🧪 Automated Testing & Production Quality
* **Backend Test Suite**: 8 Jest test suites with **85 out of 85 automated tests passing**.
* **Frontend Production Build**: Vite 6 compiled all 2022 modules cleanly with zero syntax or bundling errors.
