# 🌐 HostelGuard Enterprise — Multi-Router Wi-Fi Roaming & LAN Manual

## Executive Overview
In multi-story student residential buildings (3–4 floors, ~400 residents), the Warden laptop frequently moves between physical wings and connects to different local Wi-Fi access points:
* **Floor 1 Router:** Subnet `192.168.1.0/24` (e.g. `192.168.1.104`)
* **Floor 2 Router:** Subnet `192.168.2.0/24` (e.g. `192.168.2.88`)
* **Floor 3 Router:** Subnet `10.25.230.0/24` (e.g. `10.25.230.253`)
* **Floor 4 Router / Hotspot:** Subnet `172.20.10.0/28` (iPhone Hotspot `172.20.10.4`)

HostelGuard Enterprise features a **Zero-Freeze Dynamic Wi-Fi Roaming Engine** that allows the Warden to switch between routers or connect to phone hotspots **without restarting the server, without losing student data, and without stale cached IP lockouts**.

---

## 1. How Dynamic Wi-Fi Roaming Works Under the Hood

```
                        +----------------------------------+
                        |   Warden Laptop (Port 5000)      |
                        |  wifiRoamingWatcher (Every 5s)   |
                        +-----------------+----------------+
                                          |
                +-------------------------+-------------------------+
                |                         |                         |
       [Wi-Fi Switch Detected]     [Database Sync]         [Cloud Registry Push]
                |                         |                         |
         Emits 'ipChanged'       Updates geofence_configs   POST /api/v1/lan-discovery
     Logs new URL in console     local_warden_url record    to Cloud Render endpoint
                |                         |                         |
                +-------------------------+-------------------------+
                                          |
                        +-----------------+----------------+
                        |  Student Devices on Floor Wi-Fi  |
                        +----------------------------------+
                                          |
         +--------------------------------+--------------------------------+
         |                                |                                |
  [Direct Browser]               [Android / iOS App]              [Cloud Fallback]
Opens http://<IP>:5000           Probes /api/v1/ping-hostel       Queries Cloud Discovery
Zero Mixed-Content blocks        Auto-evicts stale IP in 1.5s     Pulls fresh floor IP
```

1. **5-Second Polling (`wifiRoamingWatcher.js`):**
   The backend continuously polls active non-virtual network interfaces. When the Warden laptop disconnects from Floor 1 and connects to Floor 2, the new IPv4 address is detected within 5 seconds.
2. **Instant Cloud Synchronization:**
   The backend immediately sends an asynchronous update to the Cloud Discovery Registry (`https://hostelguard-backend-oimp.onrender.com/api/v1/lan-discovery`).
3. **Frontend Auto-Healing & Eviction:**
   Before student portals use any cached IP from `localStorage`, they issue a strict 1500ms ping to `/api/v1/ping-hostel`. If unreachable, the stale IP is evicted immediately, and the client auto-resolves the new IP from:
   - Direct Local Host (`window.location.hostname`)
   - Cloud Discovery Registry (`/api/v1/lan-discovery`)
   - Parallel Subnet Sweep across standard gateway IPs (`172.20.10.x`, `192.168.137.1`, `192.168.43.1`, etc.)
4. **Permanent Windows Firewall Access:**
   Inbound rule for TCP port `5000` (Backend Gateway) is automatically enforced across `profile=any` (Public, Private, and Domain networks). The internal Python AI engine (`8000`) is strictly bound to local loopback (`127.0.0.1`), eliminating unauthorized network probing.

---

## 2. Step-by-Step Warden Floor-to-Floor Operating Procedure

### Step 1: Booting the Server
1. Double-click **`start.bat`** on the Warden laptop.
2. The terminal automatically:
   - Sets Windows Firewall rule for port `5000` (Backend Gateway).
   - Detects all active Wi-Fi adapters.
   - Launches the Python AI engine and Node.js server.
   - Displays the initial Student Check-In URL: `http://<PRIMARY_IP>:5000`.

### Step 2: Moving Between Floors
1. Disconnect from the current floor Wi-Fi router.
2. Connect to the new floor Wi-Fi router (or turn on your phone's personal hotspot).
3. **DO NOT restart the server.**
4. Within 5 seconds, the console logs the new IP:
   ```
   ================================================================
   🔄 [Wi-Fi Roaming Detected] Warden Laptop IP Changed!
      Previous IP : 10.25.230.253
      New LAN IP  : 172.20.10.4
   📡 Student Check-In URL: http://172.20.10.4:5000
   ================================================================
   ```
5. Open the **Warden Operations Panel** (`http://localhost:5000`).
   The top banner immediately updates with:
   - The new live check-in URL (`http://<NEW_IP>:5000`).
   - A live scannable QR code matching the new IP.

---

## 3. Student Connection Methods

### Method A: Direct Browser Method (Recommended for Zero Setup)
* **Who it is for:** Students using Android Chrome, iOS Safari, or laptops.
* **How to connect:**
  1. Connect phone to the Hostel Wi-Fi router.
  2. Scan the QR code on the Warden laptop screen OR open `http://<WARDEN_IP>:5000` in the browser.
  3. Sign in and complete check-in.
  * **Advantage:** Served directly over HTTP from the Warden laptop. **100% immune to HTTPS Mixed Content blocking.**

### Method B: Native Android APK
* **Who it is for:** Students with the installed HostelGuard Android app.
* **How to connect:**
  1. Open the app while connected to the Hostel Wi-Fi.
  2. The app automatically probes the network via `/api/v1/ping-hostel` and locks onto the live Warden IP.
  3. If switching from another router, tap **"Change"** next to `Hostel Server: Wi-Fi (...)` and tap **"🔄 Auto-Detect on Wi-Fi"** or enter the IP.
  * **Advantage:** Connects to native Bluetooth Low Energy (BLE) anchors and Hardware GPS without browser restrictions.

### Method C: Cloud Web Portal (`https://hostelguard-frontend.onrender.com`)
* **Who it is for:** Off-campus students, administrators, or students checking attendance records.
* **How to connect:**
  - Open `https://hostelguard-frontend.onrender.com`.
  - When in range of the hostel, the portal synchronizes with the Cloud Discovery Registry to locate the local Warden laptop.

---

## 4. Mobile Hotspot Testing Checklist

When testing without institutional Wi-Fi routers using a smartphone's Personal Hotspot:

### 📱 iPhone / iOS Personal Hotspot:
- [ ] Open **Settings -> Personal Hotspot**.
- [ ] Turn ON **"Allow Others to Join"**.
- [ ] **CRITICAL:** Turn ON **"Maximize Compatibility"** (switches Wi-Fi to 2.4 GHz; ensures older Android phones and ESP32 hardware beacons can connect).
- [ ] Connect the Warden laptop to the iPhone Hotspot.
  - The laptop will receive an IP in the `172.20.10.x` range (e.g. `172.20.10.2` or `172.20.10.4`).
- [ ] Connect student phones to the same iPhone Hotspot.
- [ ] Students open `http://172.20.10.4:5000` (or scan the QR code).

### 🤖 Android Personal Hotspot:
- [ ] Open **Settings -> Network & internet -> Hotspot & tethering**.
- [ ] Set **AP Band** to **2.4 GHz Band** (for maximum hardware range).
- [ ] Turn OFF **"Turn off hotspot automatically"**.
- [ ] Connect Warden laptop to the Android Hotspot.
  - The laptop will receive an IP in the `192.168.43.x` range.
- [ ] Connect student phones and open `http://192.168.43.1:5000` (or laptop's assigned IP).

### 🏢 Hostel Hardware Routers Checklist:
- [ ] **Disable "AP Isolation" / "Client Isolation":**
  Ensure the router admin settings have AP Isolation turned **OFF**. When AP Isolation is enabled, connected phones cannot talk to the laptop on port 5000.
- [ ] **Static DHCP Reservation (Optional Best Practice):**
  Bind the Warden laptop MAC address to a fixed floor IP (e.g. `.100`) on each of the 4 floor routers so the IP remains identical every time the Warden enters that floor.
- [ ] **Windows Network Profile:**
  When Windows prompts *"Do you want your PC to be discoverable?"* on a new network, click **Yes (Private)**. Even if set to Public, our hardened `start.bat` enforces firewall rules across `profile=any`.

---

## 5. Multi-Floor & Multi-Block ESP32 Hardware Provisioning Table

To prevent through-ceiling radio spillover while guaranteeing instant roll-call proximity validation, Seeed Studio XIAO ESP32-C6 / ESP32-WROOM boards are deployed according to this standardized campus topology:

| Block | Floor | Anchor Identifier | Standard BLE Local Name | Service UUID | RSSI Cutoff | Typical Placement |
|:---:|:---:|:---:|:---:|:---:|:---:|:---|
| **Block A** | Ground Floor | `A01` | `HG-A01` | `0000a010-0000-1000-8000-00805f9b34fb` | -78 dBm | Central corridor pillar / Warden office |
| **Block A** | 1st Floor | `A02` | `HG-A02` | `0000a020-0000-1000-8000-00805f9b34fb` | -78 dBm | Floor 1 study lounge entrance |
| **Block A** | 2nd Floor | `A03` | `HG-A03` | `0000a030-0000-1000-8000-00805f9b34fb` | -78 dBm | Floor 2 wing corridor junction |
| **Block A** | 3rd Floor | `A04` | `HG-A04` | `0000a040-0000-1000-8000-00805f9b34fb` | -78 dBm | Floor 3 elevator / stairwell lobby |
| **Block B** | Ground Floor | `B01` | `HG-B01` | `0000b010-0000-1000-8000-00805f9b34fb` | -78 dBm | Block B reception / main portal |
| **Block B** | 1st Floor | `B02` | `HG-B02` | `0000b020-0000-1000-8000-00805f9b34fb` | -78 dBm | Block B Floor 1 common area |
| **Block B** | 2nd Floor | `B03` | `HG-B03` | `0000b030-0000-1000-8000-00805f9b34fb` | -78 dBm | Block B Floor 2 corridor center |
| **Block B** | 3rd Floor | `B04` | `HG-B04` | `0000b040-0000-1000-8000-00805f9b34fb` | -78 dBm | Block B Floor 3 terrace lobby |
| **Block C** | Floors 1–4 | `C01`–`C04` | `HG-C01`..`C04` | `0000c010-0000-1000-8000-00805f9b34fb` | -78 dBm | Block C central stairwell anchors |
| **Block D** | Floors 1–4 | `D01`–`D04` | `HG-D01`..`D04` | `0000d010-0000-1000-8000-00805f9b34fb` | -78 dBm | Block D residential wing portals |

### Technical Specifications:
- **Anchor Regex Pattern:** `^([A-D]\d{2}|FLR-\d{2}|FLR_\d{1,2}|HG-[A-Z0-9_-]{2,24})$`
- **Advertisement Frame:** 19-byte compact manufacturer data `<ANCHOR_ID>|<STEP_HEX>|<HMAC_8HEX>` (e.g. `A01|90d8f4|8EA5CC3F`).
- **Clock Drift Window:** 3-slot rolling window (-1, 0, +1 30-second steps = 90-second total valid tolerance).
- **Floor Isolation:** Received signals weaker than `-78 dBm` are rejected by the mobile scanner to prevent a resident on Floor 2 from verifying against a Floor 1 beacon.

---

## 6. Troubleshooting Matrix

| Symptom | Cause | Solution |
|---|---|---|
| **Student gets `ERR_CONNECTION_TIMED_OUT`** | Router has **AP Isolation** turned ON, blocking client-to-client traffic | Disable "AP Isolation" in router settings, or switch to laptop/phone hotspot. |
| **"Wi-Fi network changed" modal appears** | Warden switched to a new floor router | The app auto-cleared the old IP. Tap "Auto-Detect on Wi-Fi" or scan the Warden screen QR code. |
| **Mixed Content Error on Mobile Chrome** | Student accessed `https://...onrender.com` instead of local HTTP | Have student scan the Warden QR code or navigate directly to `http://<WARDEN_IP>:5000`. |
| **Port 5000 already in use** | Previous Node process still running | Run `start.bat` and select Option [4] (Stop All Services), then relaunch `start.bat`. |
| **Warden IP shows `127.0.0.1`** | Wi-Fi is disconnected or connected via a virtual adapter | Connect laptop to active Wi-Fi; `wifiRoamingWatcher` will update within 5s. |

