# Operations & Troubleshooting Guide: HostelGuard Enterprise

## 1. Diagnostic Decision Tree

```
                       [Issue Detected]
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
    [API Not Responding]                [Verification Failure]
            │                                   │
  1. Check /health endpoint           1. Location Failure:
     http://localhost:5000/health        - Inspect device GPS accuracy
  2. Verify Node.js process:             - Check Haversine distance
     Get-Process -Name "node"         2. Biometric Failure:
  3. Verify Python AI Microservice:      - Check room lighting
     http://localhost:8000/docs          - Ensure single centered face
```

---

## 2. Common Issues & Solutions

### Issue A: "SQLITE_BUSY: database is locked"
- **Cause**: High write contention when multiple background jobs attempt atomic transactions simultaneously without WAL mode.
- **Solution**:
  1. Ensure WAL mode is active:
     ```sql
     PRAGMA journal_mode = WAL;
     PRAGMA busy_timeout = 5000;
     ```
  2. The core backend includes `PRAGMA busy_timeout = 5000;` on startup, allowing queries to wait up to 5 seconds before erroring.

### Issue B: "Failed to detect face in captured photos" during Onboarding
- **Cause**: Student webcam capture contains excessive motion blur, poor backlight, or multiple faces in the frame.
- **Solution**:
  1. Ensure the student is centered directly inside the green oval guide.
  2. Avoid strong light sources directly behind the student's head (backlighting).
  3. Ensure no roommates or bystanders are visible in the camera frame.

### Issue C: Student Receives "Mock Location / GPS Spoofer Detected"
- **Cause**: The Android device has "Select mock location app" enabled in Developer Options, or client-side GPS coordinates exceed standard drift.
- **Solution**:
  1. Open Android Settings > System > Developer Options.
  2. Ensure "Mock location app" is set to "None".
  3. If persistent on specific laptop webcams without GPS chips, administrators can adjust the geofence radius in **Geofence Manager** (up to 30-50m during initial setup).

### Issue D: Strike Counter Reached 3 / Student Account Flagged
- **Cause**: The student attempted to mark attendance 3 consecutive times from outside the permitted hostel geofence.
- **Solution**:
  1. Administrator logs into **Security & Forge Alerts Desk**.
  2. Locate the flagged resident.
  3. Click "Reset Strike Counter".
  4. Provide mandatory justification reason and confirm reset.
