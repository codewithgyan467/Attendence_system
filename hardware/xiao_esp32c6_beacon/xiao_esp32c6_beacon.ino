/**
 * ============================================================================
 * HOSTELGUARD ENTERPRISE v4.2: DUAL-BEACON AIR-ANCHOR FIRMWARE
 * SPECIFICALLY ADAPTED FOR: Seeed Studio XIAO ESP32-C6 (14-Pin Edition)
 * ============================================================================
 * Hardware:      Seeed Studio XIAO ESP32C6 (FCC ID: Z4T-XIAOESP32C6)
 * Architecture:  32-bit RISC-V Single-Core @ 160MHz, Wi-Fi 6, Bluetooth 5.3 LE
 * Arduino IDE:   v2.x (Install "esp32" by Espressif Systems v3.0.0 or later)
 * Board Target:  "XIAO_ESP32C6" (under Seeed Studio) or "ESP32C6 Dev Module"
 * USB CDC:       USB CDC On Boot -> "Enabled" (Required for Native USB-C Serial)
 * Flash Mode:    QIO 80MHz, Partition: "Default 4MB with SPIFFS" or "Huge APP"
 * ============================================================================
 * MULTI-BEACON SYSTEM ROLE:
 *   - Beacon #1 (Ground Floor / Wing A): HG-BEACON-BLKA-01 (Existing Board)
 *   - Beacon #2 (1st Floor / Wing B):    HG-BEACON-BLKA-02 (This XIAO ESP32C6)
 *
 * HARDWARE FEATURES UTILIZED:
 *   1. Native USB-C Communication (USB-CDC Virtual COM Port)
 *   2. Onboard Status LED (GPIO 15 - Active LOW)
 *      - 3 Fast Blinks: Boot & BLE Initialized
 *      - 1 Short Pulse: 30-Second Rolling TOTP Token Advanced
 *      - 2 Fast Pulses: Student Mobile Client Connected
 *   3. Native Silicon Power-Bank Keep-Alive (Zero Hardware Resistors Needed)
 *   4. Zero External RTC Chip (DS3231) Needed:
 *      - Boot Wi-Fi NTP clock sync with 8s timeout, then disables Wi-Fi radio.
 *      - Accepts signed Phone-to-ESP32 Crowdsourced Time Relay over BLE.
 * ============================================================================
 */

#include <WiFi.h>
#include <time.h>
#include <sys/time.h>
#include <Preferences.h>
#include <mbedtls/md.h>

// Fix 4 & 7: Dual NimBLE-Arduino (9 concurrent links) & standard BLEDevice fallback
#if __has_include(<NimBLEDevice.h>)
  #include <NimBLEDevice.h>
  #define USE_NIMBLE 1
#else
  #include <BLEDevice.h>
  #include <BLEServer.h>
  #include <BLEUtils.h>
  #include <BLE2902.h>
  #define USE_NIMBLE 0
#endif

// ----------------------------------------------------------------------------
// 1. BEACON IDENTITY & CRYPTOGRAPHIC CONFIGURATION
// ----------------------------------------------------------------------------
// Unique Public ID for this 2nd Beacon & Fix 9: 29-Byte Legacy BLE Payload (HG-A02)
const char* BEACON_PUBLIC_ID  = "HG-BEACON-BLKA-02";
const char* BEACON_SHORT_NAME = "HG-A02"; // Fits in 29 bytes: 3B Flags + 18B UUID + 8B Name
const char* BEACON_NAME       = "HostelGuard XIAO-C6 Beacon";

// 32-Byte (64 hex characters) Shared Secret bound to HG-BEACON-BLKA-02
const char* SHARED_SECRET_HEX = "5737e7a308d843d6d5a63d512167d7a89702853d9e8ef53195e08472cc1d2859";

// Optional Wi-Fi Credentials for Initial NTP Time Sync (Leave as-is if using Phone Time Relay)
const char* WIFI_SSID         = "HOSTEL_WIFI_SSID";
const char* WIFI_PASSWORD     = "HOSTEL_WIFI_PASSWORD";
const char* WIFI_SSID_ALT     = "iPhone";

// Onboard Yellow/Orange User LED on Seeed Studio XIAO ESP32C6 (GPIO 15, Active LOW)
#define STATUS_LED_PIN        15

// BLE UUID Definitions (HostelGuard Air-Anchor Standard)
#define SERVICE_UUID              "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID       "beb5483e-36e1-4688-b7f5-ea07361b26a8" // Rolling TOTP (Read/Notify)
#define TIME_SYNC_CHAR_UUID       "beb5483e-36e1-4688-b7f5-ea07361b26a9" // Crowdsourced Time Relay (Write)
#define OFFLINE_SIGN_CHAR_UUID    "beb5483e-36e1-4688-b7f5-ea07361b26aa" // Offline Selfie Signing (Write/Notify)

// NTP Time Parameters
const char* NTP_SERVER        = "pool.ntp.org";
const long  GMT_OFFSET_SEC    = 19800; // +05:30 Asia/Kolkata
const int   DAYLIGHT_OFFSET   = 0;

// ----------------------------------------------------------------------------
// 2. STATE VARIABLES
// ----------------------------------------------------------------------------
#if USE_NIMBLE
NimBLEServer*         pServer = NULL;
NimBLECharacteristic* pRollingChar = NULL;
NimBLECharacteristic* pTimeSyncChar = NULL;
NimBLECharacteristic* pOfflineSignChar = NULL;
#else
BLEServer*         pServer = NULL;
BLECharacteristic* pRollingChar = NULL;
BLECharacteristic* pTimeSyncChar = NULL;
BLECharacteristic* pOfflineSignChar = NULL;
#endif

Preferences        nvsPrefs;
bool               deviceConnected = false;
uint32_t           lastComputedSlot = 0;
String             currentRollingToken = "INIT0000";
unsigned long      lastKeepAlivePulse = 0;
bool               rtcCalibrated = false;

// ----------------------------------------------------------------------------
// 3. HARDWARE LED HELPER (Active LOW on XIAO ESP32C6)
// ----------------------------------------------------------------------------
void pulseLed(int count, int onMs, int offMs) {
  for (int i = 0; i < count; i++) {
    digitalWrite(STATUS_LED_PIN, LOW);  // ON (Active LOW)
    delay(onMs);
    digitalWrite(STATUS_LED_PIN, HIGH); // OFF
    if (i < count - 1) delay(offMs);
  }
}

// ----------------------------------------------------------------------------
// 4. CRYPTOGRAPHIC HMAC-SHA256 TOKEN COMPUTATION
// ----------------------------------------------------------------------------
uint8_t hexPairToByte(char high, char low) {
  auto hexVal = [](char c) -> uint8_t {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return 0;
  };
  return (hexVal(high) << 4) | hexVal(low);
}

String computeHmacHex(const char* secretHex, const char* payload, int outLength) {
  uint8_t keyBytes[32];
  for (int i = 0; i < 32; i++) {
    keyBytes[i] = hexPairToByte(secretHex[i * 2], secretHex[i * 2 + 1]);
  }
  uint8_t hmacOutput[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  mbedtls_md_hmac_starts(&ctx, keyBytes, 32);
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)payload, strlen(payload));
  mbedtls_md_hmac_finish(&ctx, hmacOutput);
  mbedtls_md_free(&ctx);

  char hexBuf[65];
  for (int i = 0; i < 32; i++) {
    snprintf(&hexBuf[i * 2], 3, "%02X", hmacOutput[i]);
  }
  hexBuf[outLength] = '\0';
  return String(hexBuf);
}

// ----------------------------------------------------------------------------
// 5. BLE SERVER & CHARACTERISTIC CALLBACKS
// ----------------------------------------------------------------------------
class ServerCallbacks: public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    Serial.println("📱 [BLE] Student Mobile Device Connected to XIAO-C6 Beacon!");
    pulseLed(2, 60, 60);
  }

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    Serial.println("📡 [BLE] Device Disconnected. Resuming Advertising...");
    pServer->startAdvertising();
  }
};

// Mode C: Crowdsourced Phone-to-ESP32 Time Calibration Relay
class TimeSyncCallbacks: public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pChar) {
    String val = pChar->getValue().c_str();
    if (val.length() > 0) {
      int sep = val.indexOf(':');
      if (sep > 0) {
        String epochStr = val.substring(0, sep);
        String hmacStr = val.substring(sep + 1);
        time_t epoch = (time_t)epochStr.toInt();
        String payload = "TIMESYNC|" + String(BEACON_PUBLIC_ID) + "|" + epochStr;
        String expectedHmac = computeHmacHex(SHARED_SECRET_HEX, payload.c_str(), 16);

        if (hmacStr.equalsIgnoreCase(expectedHmac)) {
          struct timeval tv = { epoch, 0 };
          settimeofday(&tv, NULL);
          rtcCalibrated = true;

          // Fix 8: NVS linear clock drift calibration factor
          nvsPrefs.begin("hg_c6_anchor", false);
          int32_t lastEpoch = nvsPrefs.getInt("sync_epoch", 0);
          uint32_t lastMillis = nvsPrefs.getUInt("sync_millis", 0);
          uint32_t nowMillis = millis();

          if (lastEpoch > 0 && nowMillis > lastMillis) {
            int32_t expectedEpoch = lastEpoch + (nowMillis - lastMillis) / 1000;
            int32_t driftSec = (int32_t)epoch - expectedEpoch;
            nvsPrefs.putInt("drift_sec", driftSec);
            Serial.printf("⏱ [DRIFT COMPENSATOR] Measured drift: %d seconds. NVS factor updated.\n", driftSec);
          }
          nvsPrefs.putInt("sync_epoch", (int32_t)epoch);
          nvsPrefs.putUInt("sync_millis", nowMillis);
          nvsPrefs.end();

          pulseLed(3, 100, 100);
          Serial.printf("⚡ [TIME RELAY] Clock Calibrated from Student Phone! Unix Epoch: %ld\n", epoch);
        } else {
          Serial.println("⚠️ [TIME RELAY] Rejected: HMAC signature mismatch!");
        }
      }
    }
  }
};

// Mode B: Offline Hardware-Signed Selfie Verification Callback
class OfflineSignCallbacks: public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pChar) {
    String val = pChar->getValue().c_str();
    if (val.startsWith("SIGN:")) {
      int firstSep = val.indexOf(':', 5);
      String imgHash = firstSep > 0 ? val.substring(5, firstSep) : val.substring(5);

      time_t now = time(nullptr);
      uint32_t slot = (uint32_t)(now / 30);

      // Hardware Signature: HMAC-SHA256(Secret, ImageHash:BeaconID:Slot)
      String payload = imgHash + ":" + String(BEACON_PUBLIC_ID) + ":" + String(slot);
      String sig = computeHmacHex(SHARED_SECRET_HEX, payload.c_str(), 32);

      // Response: "<BEACON_ID>:<SLOT>:<HW_SIGNATURE>"
      String response = String(BEACON_PUBLIC_ID) + ":" + String(slot) + ":" + sig;
      pChar->setValue((uint8_t*)response.c_str(), response.length());
      pChar->notify();

      Serial.printf("🔐 [OFFLINE SIGN] Generated Hardware Signature for Slot #%u\n", slot);
      pulseLed(1, 150, 0);
    }
  }
};

// ----------------------------------------------------------------------------
// 6. NATIVE SILICON POWER-BANK KEEP-ALIVE
// ----------------------------------------------------------------------------
void keepPowerBankAwake() {
  if (millis() - lastKeepAlivePulse > 20000) {
    lastKeepAlivePulse = millis();
    // Brief CPU burst draws ~60mA to reset power bank auto-cutoff timers
    volatile uint32_t dummy = 0;
    for (int i = 0; i < 200000; i++) dummy += i;
  }
}

// ----------------------------------------------------------------------------
// 7. SETUP & INITIALIZATION
// ----------------------------------------------------------------------------
void setup() {
  // 1. Initialize Onboard LED
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, HIGH); // OFF by default (Active LOW)

  // 2. Initialize Native USB CDC Serial
  Serial.begin(115200);
  unsigned long startWait = millis();
  while (!Serial && (millis() - startWait < 2000)); // Non-blocking wait for USB Serial

  Serial.println("\n=======================================================");
  Serial.printf("  HOSTELGUARD AIR-ANCHOR BEACON #2\n");
  Serial.printf("  Hardware: Seeed Studio XIAO ESP32-C6 (14-Pin)\n");
  Serial.printf("  Public ID: %s | Location: %s\n", BEACON_PUBLIC_ID, BEACON_NAME);
  Serial.println("=======================================================");

  pulseLed(3, 80, 80); // 3 quick blinks indicating successful boot

  // 3. Attempt Wi-Fi NTP Time Synchronization
  Serial.printf("Attempting Wi-Fi clock synchronization with '%s'...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int retry = 0;
  while (WiFi.status() != WL_CONNECTED && retry < 12) {
    delay(500);
    Serial.print(".");
    retry++;
  }

  // Fallback to Alternative Wi-Fi SSID
  if (WiFi.status() != WL_CONNECTED && strlen(WIFI_SSID_ALT) > 0) {
    Serial.printf("\nRetrying with alternative SSID '%s'...\n", WIFI_SSID_ALT);
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID_ALT, WIFI_PASSWORD);
    retry = 0;
    while (WiFi.status() != WL_CONNECTED && retry < 12) {
      delay(500);
      Serial.print(".");
      retry++;
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[Wi-Fi Connected!] Syncing RTC with NTP (pool.ntp.org)...");
    configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET, NTP_SERVER);
    struct tm ti;
    if (getLocalTime(&ti)) {
      rtcCalibrated = true;
      Serial.printf("✅ RTC Clock Synchronized! Current Time: %02d:%02d:%02d\n",
                    ti.tm_hour, ti.tm_min, ti.tm_sec);
    }
    // Shut down Wi-Fi to dedicate 100% antenna power to BLE
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
    Serial.println("[Wi-Fi Closed] Dedicated 100% RF to BLE Air-Anchor Broadcasting.");
  } else {
    Serial.println("\n[Notice] Wi-Fi offline. Monotonic clock active; awaiting Web Bluetooth Time Relay.");
  }

  // 4. Initialize BLE 5.3 Subsystem
  Serial.println("Initializing BLE Subsystem (Zero-Cloud Radio Anchor)...");
  BLEDevice::init(BEACON_SHORT_NAME);
  BLEDevice::setPower(ESP_PWR_LVL_N6); // Fix 10: -6 dBm TX power stops floor bleed-through

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);

  // Characteristic 1: Rolling TOTP Token (Mode A: Live Proximity Beacon)
  pRollingChar = pService->createCharacteristic(
                   CHARACTERISTIC_UUID,
                   BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
                 );
  pRollingChar->addDescriptor(new BLE2902());

  // Characteristic 2: Phone-to-ESP32 Crowdsourced Time Calibration Relay
  pTimeSyncChar = pService->createCharacteristic(
                    TIME_SYNC_CHAR_UUID,
                    BLECharacteristic::PROPERTY_WRITE
                  );
  pTimeSyncChar->setCallbacks(new TimeSyncCallbacks());

  // Characteristic 3: Offline Hardware-Signed Selfie (Mode B)
  pOfflineSignChar = pService->createCharacteristic(
                       OFFLINE_SIGN_CHAR_UUID,
                       BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
                     );
  pOfflineSignChar->setCallbacks(new OfflineSignCallbacks());
  pOfflineSignChar->addDescriptor(new BLE2902());

  pService->start();

  // 5. Configure BLE Advertising: Fix 9: 29-byte primary frame (3B Flags + 18B UUID + 8B Name)
  BLEAdvertising* pAdv = BLEDevice::getAdvertising();
  pAdv->addServiceUUID(SERVICE_UUID);

  BLEAdvertisementData advData;
  advData.setName(BEACON_SHORT_NAME);
  advData.setCompleteServices(BLEUUID(SERVICE_UUID));
  pAdv->setAdvertisementData(advData);

  BLEAdvertisementData scanData;
  scanData.setName(BEACON_NAME);
  pAdv->setScanResponseData(scanData);

  pAdv->setScanResponse(true);
  pAdv->setMinPreferred(0x06); // 7.5ms fast interval for instant mobile detection
  pAdv->setMaxPreferred(0x12); // 22.5ms max interval for stable iOS CoreBluetooth pairing
  BLEDevice::startAdvertising();

  Serial.println("=======================================================");
  Serial.println("✅ SEEED XIAO ESP32-C6 BEACON IS BROADCASTING LIVE!");
  Serial.printf("   - Advertised Name: %s (Short ID: %s)\n", BEACON_PUBLIC_ID, BEACON_SHORT_NAME);
  Serial.printf("   - Location:        %s\n", BEACON_NAME);
  Serial.printf("   - RF TX Power:     -6 dBm (Floor Boundary Calibrated)\n");
  Serial.printf("   - Service UUID:    %s\n", SERVICE_UUID);
  Serial.printf("   - Status LED:      GPIO 15 (Active LOW)\n");
  Serial.println("=======================================================\n");
}

// ----------------------------------------------------------------------------
// 8. MAIN LOOP (30-SECOND TOKEN ADVANCEMENT)
// ----------------------------------------------------------------------------
void loop() {
  keepPowerBankAwake();

  time_t now = time(nullptr);
  uint32_t currentSlot = (uint32_t)(now / 30);

  // Advance rolling HMAC token every 30 seconds
  if (currentSlot != lastComputedSlot) {
    lastComputedSlot = currentSlot;

    char payload[64];
    snprintf(payload, sizeof(payload), "%s:%u", BEACON_PUBLIC_ID, currentSlot);
    currentRollingToken = computeHmacHex(SHARED_SECRET_HEX, payload, 8);

    char buffer[128];
    snprintf(buffer, sizeof(buffer), "{\"id\":\"%s\",\"code\":\"%s\",\"slot\":%u}",
             BEACON_SHORT_NAME, currentRollingToken.c_str(), currentSlot);

    pRollingChar->setValue((uint8_t*)buffer, strlen(buffer));
    pRollingChar->notify();

    // Fix 1: Visual optical heartbeat on slot advance
    pulseLed(3, 50, 50);

    Serial.printf("[BLE TICK] Slot #%u -> Rolling Token: %s (Advertised: %s)\n", currentSlot, currentRollingToken.c_str(), BEACON_SHORT_NAME);
  }

  delay(1000);
}

