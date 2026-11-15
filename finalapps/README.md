# 📦 ATTENDRA Distribution Packages (`finalapps/`)

> **Presence Powered by Intelligence.**  
> *GPS • BLE • Smart Biometric Attendance System*

This directory houses the consolidated production application binaries and deployment bundles for the **ATTENDRA** multi-platform system.

---

## 📱 Release Information

* **Version**: `v1.0.192`
* **Build Number**: `#192`
* **Release Channel**: Production Stable
* **GitHub Release**: [ATTENDRA v1.0.192](https://github.com/codewithgyan467/Attendence_system/releases/tag/v1.0.192)
* **Application ID**: `com.hostel.attendance`
* **Min SDK**: Android 7.0 (API Level 24)
* **Target SDK**: Android 14 (API Level 34)

---

## 📂 Package Catalog

| File Name | Platform | Description | Size |
| :--- | :--- | :--- | :--- |
| **`Attendra.apk`** | Android | Primary production Android installable package | ~15.7 MB |
| **`Attendra_Android.apk`** | Android | Direct alias package for release distributions | ~15.7 MB |
| **`HostelGuard_Android.apk`** | Android | Backward-compatible alias for existing automated linkers | ~15.7 MB |
| **`HostelGuard.apk`** | Android | Backward-compatible alias for legacy direct scripts | ~15.7 MB |
| **`Attendra_iOS.zip`** | iOS | Complete Xcode/Capacitor iOS project bundle with dark branding & assets | ~33.0 MB |
| **`HostelGuard_iOS.zip`** | iOS | Backward-compatible archive alias for Xcode CI runners | ~33.0 MB |
| **`ota-bundle.zip`** | Web / OTA | Live Over-The-Air update web bundle (Capgo instant hot-reload) | ~15.9 MB |
| **`app-debug.apk`** | Android | Development and local debugging package with Chrome Inspect enabled | ~15.7 MB |

---

## 🔒 Cryptographic Integrity Verification (SHA-256)

```text
A661C85B5A4FBC191529F65B175A7C3E584A44D3395567A37BC99E6C904DCE56  Attendra.apk
A661C85B5A4FBC191529F65B175A7C3E584A44D3395567A37BC99E6C904DCE56  Attendra_Android.apk
A661C85B5A4FBC191529F65B175A7C3E584A44D3395567A37BC99E6C904DCE56  HostelGuard_Android.apk
A661C85B5A4FBC191529F65B175A7C3E584A44D3395567A37BC99E6C904DCE56  HostelGuard.apk
DB435A47F390153193680A964969D0567FEE4CA936762164F28737062ED6A038  Attendra_iOS.zip
DB435A47F390153193680A964969D0567FEE4CA936762164F28737062ED6A038  HostelGuard_iOS.zip
63402A926A9E64D837785085BBB46F2B8BFDFD290F1F9E092B941143F8E38CE0  ota-bundle.zip
A661C85B5A4FBC191529F65B175A7C3E584A44D3395567A37BC99E6C904DCE56  app-debug.apk
```

---

## 🚀 Installation & Deployment Instructions

### 1. Direct Android Sideloading
1. Copy `Attendra.apk` to any Android device running Android 7.0 or higher.
2. Tap the file in your device file manager.
3. Allow "Install unknown apps" when prompted by Android Settings.
4. Launch **ATTENDRA**. When prompted, grant:
   * **Location**: Precise location (required for Geofence radius compliance)
   * **Camera**: Required for Face Mesh 3D biometric liveness verification
   * **Nearby Devices / Bluetooth**: Required for ESP32 BLE hardware beacon verification

### 2. Live Over-The-Air (OTA) Updates
1. Unzip `ota-bundle.zip` into your web server root or Capgo cloud distribution endpoint.
2. When the native app opens, it automatically detects and applies web UI patches without requiring an APK reinstallation.
