# HostelGuard Enterprise v3.1: ESP32 BLE Beacon Firmware Guide

## 1. Overview & 6-Day Plug-and-Play Architecture

HostelGuard Enterprise is designed with a **Zero-Friction Hardware Upgrade Path**:
* **Today (Day 1 - 5):** The system operates in **`STANDBY_OPTIONAL`** mode with **zero hardware required**. GPS geofencing, 13-layer anti-spoof telemetry, and facial PAD function with 100% operational capability.
* **On Day 6 (When your ESP32 board arrives):** Follow the 3-minute flashing guide below to deploy physical radio anchoring, then switch the Admin Dashboard to **`SOFT_ANCHOR`** or **`STRICT_REQUIRED`** with zero code changes.

---

## 2. Hardware Requirements
* Any standard **ESP32 development board** (ESP32-WROOM-32, ESP32-S3, or ESP32-C3).
* Micro-USB or USB-C cable for programming and power.
* Standard 5V USB wall adapter (phone charger) for permanent placement at the hostel entrance/corridor.

---

## 3. Flashing Instructions (3 Minutes)

### Step 1: Open Arduino IDE
1. Open the [Arduino IDE](https://www.arduino.cc/en/software) (version 2.0+ recommended).
2. Ensure the **ESP32 Board Package** is installed:
   - Go to `File` &rarr; `Preferences` &rarr; Add to *Additional Boards Manager URLs*:
     `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   - Go to `Tools` &rarr; `Board` &rarr; `Boards Manager` &rarr; Search **esp32** &rarr; Install by Espressif Systems.

### Step 2: Open the Sketch
1. In Arduino IDE, click `File` &rarr; `Open` and navigate to:
   `e:\attendence_Hostel_system\hardware\esp32_beacon\esp32_hostelguard_beacon.ino`

### Step 3: Configure Wi-Fi & Secret Key
1. In the HostelGuard Admin Web App (`http://localhost:3000`), open **Geofence & BLE Anchors**.
2. Click **Register New ESP32 Beacon** or view an existing beacon.
3. Copy the **Beacon Public ID** (e.g. `HG-BEACON-BLKA-01`) and the **32-Byte Shared Secret Key**.
4. In `esp32_hostelguard_beacon.ino`, paste your parameters at lines 23-29:
   ```cpp
   const char* WIFI_SSID        = "Hostel_Staff_WiFi";
   const char* WIFI_PASSWORD    = "YourWiFiPassword123";
   const char* BEACON_PUBLIC_ID = "HG-BEACON-BLKA-01";
   const char* SHARED_SECRET_HEX= "4a8f9c1b2e3d4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a";
   ```

### Step 4: Compile & Upload
1. Connect your ESP32 to your PC via USB.
2. Select your board from `Tools` &rarr; `Board` &rarr; `ESP32 Arduino` &rarr; `ESP32 Dev Module` (or your specific model).
3. Select your COM port from `Tools` &rarr; `Port`.
4. Click **Upload** (the right-arrow icon).

---

## 4. Verification & Testing

1. Open the Arduino Serial Monitor (`Ctrl + Shift + M`) at baud rate **115200**.
2. You will see:
   ```text
   =======================================================
     HOSTELGUARD ENTERPRISE v3.1: ESP32 BLE BEACON FIRMWARE
   =======================================================
   Connecting to Wi-Fi SSID 'Hostel_Staff_WiFi' for NTP Time Sync...
   [Wi-Fi Connected!] Synchronizing Real-Time Clock with NTP...
   RTC Clock Synchronized! Current Time: 19:15:00
   Initializing BLE Subsystem (Zero-Cloud Radio Anchor)...
   ✅ HostelGuard BLE Beacon is actively broadcasting!
      - Public ID: HG-BEACON-BLKA-01
      - Service UUID: 4fafc201-1fb5-459e-8fcc-c5c9c331914b
   [BLE TICK] Slot #59837192 -> Rolling Token: 7B3A91FC
   ```
3. Use a free mobile BLE scanner app (e.g. **nRF Connect** or **LightBlue**) on iOS or Android:
   - Scan for devices &rarr; You will see `HG-BEACON-BLKA-01` actively advertising Service UUID `4fafc201-1fb5-459e-8fcc-c5c9c331914b`.
   - Read the characteristic &rarr; It emits the JSON payload containing the 30-second rolling token.

---

## 5. Activating Beacon Enforced Modes

Once placed at the hostel entrance:
1. Open Admin Dashboard &rarr; **Hostel Geofence & BLE Radio Anchor Calibration**.
2. Switch policy from **`Zero-Hardware Standby`** to:
   - **`Soft Anchor`**: If student radio fails to detect beacon, they are routed to Step-Up photometric screen-flash with 0 strikes.
   - **`Strict Hardware Lock`**: Guarantees zero-bypass. Attendance is rejected if the authentic rolling HMAC token is missing.

