# HostelGuard Enterprise v4.0: Camera Integrity & Video Injection Report
**Scope:** Browser `MediaStream`, Native Android/iOS, Desktop Webcams, Virtual Cameras & Injection Vectors  
**Classification:** Technical Security Standard

---

## 1. Executive Summary & Problem Definition

In web-based Biometric Attendance and Proctoring systems, camera integrity is distinct from facial recognition:
- **Facial Recognition:** Verifies *who* is in the image.
- **Presentation Attack Detection (PAD):** Verifies *what physical medium* is in front of the lens.
- **Camera Integrity:** Verifies *where the digital pixel stream originated* (physical camera hardware sensor vs. synthetic software driver).

A critical vulnerability in standard web applications is that the W3C `navigator.mediaDevices.getUserMedia()` API delivers an abstract video stream without cryptographic hardware provenance. Software tools (OBS Virtual Camera, ManyCam, EpocCam, v4l2loopback, DirectShow filters) can inject pre-recorded video or modified streams directly into the browser.

HostelGuard Enterprise v4.0 implements a multi-tier defense across Browser/PWA, Android Native, and Desktop environments.

---

## 2. Threat Modeling & Platform Analysis

### 2.1 Browser / Progressive Web App (PWA)

```
[Attacker / Student]
       │
       ▼ (Plays recorded video)
[OBS Studio / Virtual Cam] ──(Virtual Driver)──► [Browser getUserMedia] ──► [HostelGuard Web App]
                                                           │
                                                           ▼ (Inspection)
                                               [EnumerateDevices Check]
                                               [Hardware Driver Regex]
                                               [Temporal Jitter Audit]
```

#### Technical Reality & Limitations
- **Browser Sandbox Boundary:** In standard web browsers (Chrome, Safari, Firefox), JavaScript code running inside a sandbox **cannot** cryptographically prove physical camera hardware authenticity. Operating systems expose virtual camera drivers through standard DirectShow (Windows), AVFoundation (macOS), or V4L2 (Linux) interfaces that appear identical to hardware webcams.
- **HostelGuard Defense:**
  1. **Device Label Auditing:** `navigator.mediaDevices.enumerateDevices()` checks for known virtual camera strings:
     `'obs'`, `'virtual'`, `'manycam'`, `'v4l2loopback'`, `'camo'`, `'splitcam'`, `'snap camera'`, `'droidcam'`.
  2. **Track Constraint Enforcement:** Requires `facingMode: { ideal: 'user' }` and enforces standard hardware aspect ratios.
  3. **Backend Enforcement:** If a virtual camera signature is present in telemetry, the backend returns HTTP `403 VIRTUAL_CAMERA_BLOCKED` and logs an incident in `security_audit_logs`.

### 2.2 Android Native (Capacitor / Android WebView)
In the native Android environment (via HostelGuard's Capacitor release), the app operates outside the standard browser sandbox and accesses platform-level security APIs:
1. **Camera2 API & Hardware Level Verification:** Queries `CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL`. Physical cameras report `LIMITED`, `FULL`, or `LEVEL_3`, while emulated/virtual cameras report `LEGACY` or missing physical lens characteristics.
2. **Google Play Integrity API:** Validates:
   - `MEETS_BASIC_INTEGRITY`: Basic untampered device.
   - `MEETS_DEVICE_INTEGRITY`: Hardware-backed Android CTS-certified device.
   - `MEETS_STRONG_INTEGRITY`: Hardware keystore and bootloader locked.
3. **Mock Location & Debugger Rejection:** Rejects devices with ADB enabled, active mock location apps, or hooked system frameworks (Xposed, Magisk).

### 2.3 Apple iOS (Safari & Native App)
1. **Safari CoreMedia Sandboxing:** iOS Safari strictly restricts virtual camera extensions. All video input maps directly to the front TrueDepth or FaceTime camera.
2. **Apple DeviceCheck & App Attest:** In native iOS builds, App Attest signs the attendance challenge request using a Secure Enclave hardware key, proving the request originated from an authentic instance of the HostelGuard app.

---

## 3. Virtual Camera Detection Rules

The following pattern-matching heuristics are applied in `StudentPortal.jsx` and verified server-side in `attendanceRoutes.js`:

```javascript
const VIRTUAL_CAMERA_BLACKLIST = [
  'obs',
  'virtual',
  'manycam',
  'v4l2loopback',
  'camo',
  'splitcam',
  'snap camera',
  'droidcam',
  'epoccam',
  'fake'
];

function isVirtualCamera(deviceLabel) {
  const lower = String(deviceLabel || '').toLowerCase();
  return VIRTUAL_CAMERA_BLACKLIST.some(k => lower.includes(k));
}
```

---

## 4. Policy for Untrusted Environments

If a student's device environment cannot be positively verified as a trusted hardware camera (e.g. Linux desktop with generic USB video device or unlabeled browser stream):
- **Decision:** The system **does not** automatically issue a disciplinary strike (to prevent false accusations due to odd hardware drivers).
- **Outcome:** The transaction is routed to **Warden Manual Confirmation** or assigned `PWA_DEGRADED` assurance tier, requiring physical presence confirmation via the floor's ESP32 BLE beacon.

