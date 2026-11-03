# HostelGuard Enterprise v4.0: Known Technical Limitations & Operational Boundaries
**Document Version:** 4.0.0 (Production Release)  
**Security Classification:** Engineering Disclosure & Deployment Field Guide  
**Target Audience:** System Architects, Hostel Wardens, Network Administrators & Field Engineers

---

## 1. Executive Statement

Biometric security and presentation attack detection (PAD) are grounded in sensor physics, computer vision, and cryptographic trust boundaries. While HostelGuard Enterprise v4.0 represents an industry-leading, 100% Free and Open Source (FOSS) edge solution achieving **0.55% APCER** against presentation attacks, institutional stakeholders must understand its fundamental operational boundaries to design effective administrative procedures and environmental guidelines.

This document details all verified physical, algorithmic, and architectural limitations of the system, alongside the corresponding mitigations and field deployment protocols.

---

## 2. PWA & Web Platform Camera Hardware Provenance

### Technical Boundary:
Under the W3C WebRTC / MediaDevices specification, web applications and Progressive Web Apps (PWAs) access camera hardware through the browser's abstraction layer (`navigator.mediaDevices.getUserMedia`). 

Crucially, **the browser sandbox does not provide cryptographic hardware attestation** for camera sensor frames:
- Raw video frames delivered to JavaScript are not signed by an on-chip hardware security module (HSM, Apple Secure Enclave, or Android KeyStore).
- Advanced operating-system-level driver tampering (such as custom kernel-level video capture drivers disguised with legitimate hardware names) cannot be cryptographically invalidated from standard browser JavaScript alone.

### v4.0 Mitigations Implemented:
1. **Hardware Driver Blacklist & Fingerprinting:**  
   The client enumerates video input devices via `enumerateDevices()` and blocks known virtual camera drivers (`OBS Virtual Camera`, `ManyCam`, `v4l2loopback`, `CamTwist`, `FakeWebcam`).
2. **Server-Issued Active Nonces:**  
   Because the server requires dynamic head turns (`TURN_LEFT`, `TURN_RIGHT`, `NOD_DOWN`) bound to a 90-second session nonce, pre-recorded video injections cannot predict the required movement in advance.
3. **Temporal Micro-Motion Tracking:**  
   Inter-frame landmark optical displacement analysis catches static image injections and frozen virtual feeds.

### Recommended High-Security Recommendation:
For unmanned perimeter security turnstiles or ultra-high-assurance institutional environments, deploy the native Android/iOS mobile application (leveraging Android CameraX / iOS AVFoundation with hardware-backed Google Play Integrity / Apple DeviceCheck APIs) rather than a desktop browser.

---

## 3. Extreme Low-Light Environments (Sub-20 Lux)

### Technical Boundary:
Consumer smartphone front-facing cameras typically feature small sensor formats ($1/3.6''$ to $1/5''$) with high f-numbers ($f/2.2 - f/2.8$). In dimly lit hostel rooms (sub-20 Lux, e.g. after lights-out):
- The camera sensor increases analog ISO gain, introducing severe chrominance noise and sensor grain.
- Frame exposure times lengthen, causing motion blur during active liveness head turns.
- Facial skin micro-texture is smoothed out by camera noise-reduction algorithms, impacting MiniFASNet's deep feature extraction.

### Architectural Policy ("Fair Failure" Protocol):
Rather than incorrectly penalizing students or issuing disciplinary proxy strikes for poor lighting, HostelGuard v4.0 enforces a **non-punitive fallback**:
- The UI detects underexposed frames and displays:  
  `"⚠️ Insufficient Lighting: Please face a room light or step towards an ambient light source."`
- The screen background switches to 100% white luminance (acting as a natural screen fill flash).
- Unverified attempts under low light are logged as `INCONCLUSIVE_LIGHTING` with zero disciplinary strikes recorded against the student's profile.

---

## 4. Facial Occlusions & Cultural / Medical Headwear

### Technical Boundary:
YuNet 2D facial landmark detection and SFace 128-D facial feature extraction depend on detecting the geometric configuration of five key facial landmarks:
- Right eye pupil center
- Left eye pupil center
- Nose tip
- Right mouth corner
- Left mouth corner

When more than 50% of the facial surface is obscured:
1. **Medical Face Masks & N95 Respirators:** Cover the nose tip and mouth corners.
2. **Religious Veils / Niqabs / Burqas:** Obscure lower facial structures.
3. **Heavy Bandages / Medical Dressings:** Obscure landmark symmetry.

Under these conditions, algorithmic biometric matching is mathematically indeterminate.

### Operational Mitigation (Warden Assisted Roll-Call):
- Students with verified medical exemptions or religious observances are registered in the administrative database under the `EXEMPT_BIOMETRIC_ROLLCALL` flag.
- During evening roll call, the Hostel Warden uses the **Warden Portal Manual Roll-Call** module:
  - The Warden verifies the resident in person.
  - The check-in is logged with `verification_method = 'WARDEN_MANUAL_OVERRIDE'` along with the Warden's authenticated employee ID and timestamp, preserving complete audit accountability.

---

## 5. Physical ESP32 Radio Propagation & Multi-Floor BLE Bleed

### Technical Boundary:
The HostelGuard BLE hardware verification layer uses ESP32 microcontrollers broadcasting standard 2.4 GHz Bluetooth Low Energy advertising packets. 

In reinforced concrete and brick structures typical of hostel dormitories:
- **Radio Transparency:** 2.4 GHz radio waves can penetrate drywall, wooden doors, and certain lightweight concrete ceilings.
- **Vertical Signal Bleed:** A beacon placed on Floor 1 (Ground Floor) may occasionally emit a readable signal on Floor 2 immediately above it if transmit power is uncalibrated.

### Mitigations & Field Deployment Rules:
1. **RSSI Threshold Hard Filtering:**  
   The backend enforces a strict $-75\text{ dBm}$ signal strength cutoff (`MIN_BLE_RSSI = -75`). Weaker signals penetrating from adjacent floors are automatically discarded.
2. **MAC Address Floor Binding:**  
   Each physical beacon's factory MAC address is strictly bound in the database to a specific hostel block and floor (`blocks` table: `ble_beacon_mac`).
3. **On-Site RF Power Calibration:**  
   During on-site installation, field engineers must configure the ESP32 RF power level in `esp32_hostelguard_beacon.ino`:
   - Small Floor Wing: `esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_ADV, ESP_PWR_LVL_N6);` (-6 dBm)
   - Large Open Corridor: `esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_ADV, ESP_PWR_LVL_P3);` (+3 dBm)

---

## 6. Offline Biometric Verification Synchronization

### Technical Boundary:
When a student verifies offline (due to temporary hostel Wi-Fi outage):
1. **Local Matching:** The PWA performs local 128-D cosine distance matching against pre-cached biometric templates in encrypted IndexedDB storage.
2. **Liveness Queuing:** Deep neural network MiniFASNet inference requires Python AI service execution. On offline student client devices, the full MiniFASNet deep network cannot execute directly within client-side WebAssembly without significant download overhead (~40 MB initial download).

### Synchronization Safeguards:
- Offline attendance records are stored locally with a cryptographically signed payload (`signed_offline_token`).
- Upon Wi-Fi reconnection, the offline queue automatically synchronizes with the backend via `/api/attendance/sync-offline`.
- The backend evaluates the cached verification frame against MiniFASNetV2 prior to permanently committing the record to the master attendance ledger.
- If a post-sync offline check-in fails anti-spoofing, it is flagged for Warden review under `FLAGGED_OFFLINE_SYNC`.

---

## 7. Summary Matrix of Limitations & Controls

| Limitation | Root Cause | Severity | System Control / Mitigation |
| :--- | :--- | :---: | :--- |
| **Web Camera Provenance** | Browser sandbox lacks hardware key signing | Medium | Driver blacklist, active pose nonces, temporal micro-motion |
| **Extreme Darkness (<20 Lux)** | Camera sensor ISO noise & motion blur | Low | Screen fill flash, non-punitive retry, zero disciplinary strike |
| **Heavy Facial Occlusion** | Landmark coverage $<50\%$ | Low | Audited Warden Manual Override with employee sign-off |
| **Multi-Floor BLE Bleed** | 2.4 GHz RF penetration through floors | Medium | $-75\text{ dBm}$ RSSI threshold, floor MAC binding, TX power tuning |
| **Offline Deep Liveness** | Edge client WASM compute constraints | Low | Cryptographic offline tokens + server post-sync verification |

