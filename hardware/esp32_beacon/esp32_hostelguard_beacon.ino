/**
 * ============================================================================
 * HOSTELGUARD ENTERPRISE v3.2: BARE ESP32 AIR-ANCHOR FIRMWARE
 * ============================================================================
 * Hardware Target: ESP32-WROOM-32 / ESP32 Dev Module (30-pin, CP2102)
 * Arduino IDE:     v2.3.10
 * Board Selection: "ESP32 Dev Module"
 * Partition Scheme: "Huge APP (3MB No OTA/1MB SPIFFS)"
 * Baud Rate:       9600 baud (to match Arduino IDE Serial Monitor default)
 *
 * ZERO EXTRA HARDWARE ARCHITECTURE:
 *   1. Zero external RTC chip (DS3231):
 *      - Boots and attempts 10-second Wi-Fi NTP clock synchronization.
 *      - If Wi-Fi is unavailable, accepts signed Phone-to-ESP32 Time Relay packets
 *        over Web Bluetooth GATT to calibrate internal RTC via settimeofday().
 *   2. Zero external resistors / dummy loads:
 *      - Native Silicon Power-Bank Keep-Alive: triggers a brief 100ms internal CPU/RF
 *        pulse every 20s to draw ~80mA, preventing modern power banks from auto-sleeping.
 *   3. Bidirectional BLE GATT:
 *      - Characteristic 1 (Read/Notify): 30-Second Rolling TOTP Proximity Beacon.
 *      - Characteristic 2 (Write): Web Bluetooth Crowdsourced Time Calibration Relay.
 *      - Characteristic 3 (Write/Notify): Offline Hardware-Signed Selfie Verification.
 * ============================================================================
 */

#include <WiFi.h>
#include <time.h>
#include <sys/time.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <mbedtls/md.h>

// ----------------------------------------------------------------------------
// 1. CONFIGURATION PARAMETERS (Auto-Injected or Set by Admin)
// ----------------------------------------------------------------------------
const char* WIFI_SSID         = "iPhone ";     // Primary Wi-Fi SSID
const char* WIFI_SSID_ALT     = "iPhone";      // Alternative SSID (fallback)
const char* WIFI_PASSWORD     = "paword123";  // Wi-Fi Password

// Floor Public Identifier (e.g. "FLR_0", "Ground Floor", "1st Floor")
const char* BEACON_PUBLIC_ID  = "HG-BEACON-BLKA-01";
const char* BEACON_NAME       = "Ground Floor Air-Anchor";

// 32-Byte (64 hex characters) Shared Secret generated in Admin Dashboard
const char* SHARED_SECRET_HEX = "4a8f9c1b2e3d4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a";

// BLE UUID Definitions for HostelGuard Air-Anchor Service
#define SERVICE_UUID              "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID       "beb5483e-36e1-4688-b7f5-ea07361b26a8" // Rolling TOTP (Read/Notify)
#define TIME_SYNC_CHAR_UUID       "beb5483e-36e1-4688-b7f5-ea07361b26a9" // Crowdsourced Time Relay (Write)
#define OFFLINE_SIGN_CHAR_UUID    "beb5483e-36e1-4688-b7f5-ea07361b26aa" // Offline Selfie Signing (Write/Notify)

// NTP Time Configuration
const char* NTP_SERVER        = "pool.ntp.org";
const long  GMT_OFFSET_SEC    = 19800; // +05:30 Asia/Kolkata
const int   DAYLIGHT_OFFSET   = 0;

// ----------------------------------------------------------------------------
// 2. STATE VARIABLES
// ----------------------------------------------------------------------------
BLEServer*         pServer = NULL;
BLECharacteristic* pRollingChar = NULL;
BLECharacteristic* pTimeSyncChar = NULL;
BLECharacteristic* pOfflineSignChar = NULL;

bool               deviceConnected = false;
uint32_t           lastComputedSlot = 0;
String             currentRollingToken = "INIT0000";
unsigned long      lastKeepAlivePulse = 0;
bool               rtcCalibrated = false;

// ----------------------------------------------------------------------------
// 3. CRYPTOGRAPHIC HMAC-SHA256 TOKEN COMPUTATION
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
// 4. BLE SERVER & CHARACTERISTIC CALLBACKS
// ----------------------------------------------------------------------------
class ServerCallbacks: public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    Serial.println("📱 Mobile Client Connected to HostelGuard Air-Anchor!");
  }

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    Serial.println("📡 Client Disconnected. Resuming BLE Advertising...");
    pServer->startAdvertising();
  }
};

// Phone-to-ESP32 Crowdsourced Time Relay Callback
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
          Serial.printf("⚡ [CROWDSOURCED TIME RELAY] RTC Synchronized from Phone! Unix Epoch: %ld\n", epoch);
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

      Serial.printf("🔐 [OFFLINE SIGN] Hardware HMAC Signature Generated for Slot #%u\n", slot);
    }
  }
};

// ----------------------------------------------------------------------------
// 5. NATIVE SILICON POWER-BANK KEEP-ALIVE (ZERO HARDWARE RESISTORS)
// ----------------------------------------------------------------------------
void keepPowerBankAwake() {
  if (millis() - lastKeepAlivePulse > 20000) {
    lastKeepAlivePulse = millis();
    // Brief 100ms CPU activity burst draws ~80mA to reset power-bank auto-shutoff timer
    volatile uint32_t dummy = 0;
    for (int i = 0; i < 200000; i++) dummy += i;
  }
}

// ----------------------------------------------------------------------------
// 6. SETUP & INITIALIZATION
// ----------------------------------------------------------------------------
void setup() {
  Serial.begin(9600);
  delay(1000);
  Serial.println("\n=======================================================");
  Serial.printf("  HOSTELGUARD v3.2 AIR-ANCHOR: %s (%s)\n", BEACON_NAME, BEACON_PUBLIC_ID);
  Serial.println("  Bare ESP32 Dev Module | Zero Add-On Hardware Edition");
  Serial.println("=======================================================");

  // Connect to Wi-Fi for initial NTP time sync
  Serial.printf("Attempting Wi-Fi clock synchronization with '%s'...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int retry = 0;
  while (WiFi.status() != WL_CONNECTED && retry < 16) {
    delay(500);
    Serial.print(".");
    retry++;
  }

  // Fallback to alternative SSID if primary failed
  if (WiFi.status() != WL_CONNECTED && strlen(WIFI_SSID_ALT) > 0) {
    Serial.printf("\nRetrying with alternative SSID '%s'...\n", WIFI_SSID_ALT);
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID_ALT, WIFI_PASSWORD);
    retry = 0;
    while (WiFi.status() != WL_CONNECTED && retry < 16) {
      delay(500);
      Serial.print(".");
      retry++;
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[Wi-Fi Connected!] Synchronizing Real-Time Clock with NTP...");
    configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET, NTP_SERVER);
    struct tm ti;
    if (getLocalTime(&ti)) {
      rtcCalibrated = true;
      Serial.printf("RTC Clock Synchronized! Current Time: %02d:%02d:%02d\n",
                    ti.tm_hour, ti.tm_min, ti.tm_sec);
    }
    // Shut down Wi-Fi to dedicate 100% RF to BLE
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
    Serial.println("[Wi-Fi Closed] 100% RF Transceiver dedicated to BLE Air-Anchor Broadcasting.");
  } else {
    Serial.println("\n[Notice] Wi-Fi offline. Monotonic clock active; awaiting Web Bluetooth Time Relay.");
  }

  // Initialize BLE Subsystem
  Serial.println("Initializing BLE Subsystem (Zero-Cloud Radio Anchor)...");
  BLEDevice::init(BEACON_PUBLIC_ID);
  BLEDevice::setPower(ESP_PWR_LVL_P9); // Maximum broadcast power (+9dBm)

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);

  // 1. Rolling TOTP Characteristic (Mode A: Live Proximity Beacon)
  pRollingChar = pService->createCharacteristic(
                   CHARACTERISTIC_UUID,
                   BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
                 );
  pRollingChar->addDescriptor(new BLE2902());

  // 2. Crowdsourced Time Sync Relay Characteristic (Phone -> ESP32)
  pTimeSyncChar = pService->createCharacteristic(
                    TIME_SYNC_CHAR_UUID,
                    BLECharacteristic::PROPERTY_WRITE
                  );
  pTimeSyncChar->setCallbacks(new TimeSyncCallbacks());

  // 3. Offline Hardware-Signed Selfie Characteristic (Mode B: Store & Forward)
  pOfflineSignChar = pService->createCharacteristic(
                       OFFLINE_SIGN_CHAR_UUID,
                       BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
                     );
  pOfflineSignChar->setCallbacks(new OfflineSignCallbacks());
  pOfflineSignChar->addDescriptor(new BLE2902());

  pService->start();

  // Configure BLE Advertising
  BLEAdvertising* pAdv = BLEDevice::getAdvertising();
  pAdv->addServiceUUID(SERVICE_UUID);

  BLEAdvertisementData advData;
  advData.setName(BEACON_PUBLIC_ID);
  advData.setCompleteServices(BLEUUID(SERVICE_UUID));
  pAdv->setAdvertisementData(advData);

  BLEAdvertisementData scanData;
  scanData.setName(BEACON_NAME);
  pAdv->setScanResponseData(scanData);

  pAdv->setScanResponse(true);
  pAdv->setMinPreferred(0x06); // 7.5ms min interval for fast iOS discovery
  pAdv->setMaxPreferred(0x12); // 22.5ms max interval for stable iOS CoreBluetooth link
  BLEDevice::startAdvertising();

  Serial.println("✅ HostelGuard v3.2 BLE Air-Anchor is actively broadcasting!");
  Serial.printf("   - Public ID: %s\n", BEACON_PUBLIC_ID);
  Serial.printf("   - Floor Location: %s\n", BEACON_NAME);
  Serial.printf("   - Service UUID: %s\n", SERVICE_UUID);
  Serial.println("=======================================================\n");
}

// ----------------------------------------------------------------------------
// 7. MAIN REFRESH LOOP
// ----------------------------------------------------------------------------
void loop() {
  keepPowerBankAwake();

  time_t now = time(nullptr);
  uint32_t currentSlot = (uint32_t)(now / 30);

  // Advance rolling code every 30 seconds
  if (currentSlot != lastComputedSlot) {
    lastComputedSlot = currentSlot;
    char payload[64];
    snprintf(payload, sizeof(payload), "%s:%u", BEACON_PUBLIC_ID, currentSlot);
    currentRollingToken = computeHmacHex(SHARED_SECRET_HEX, payload, 8);

    char buffer[128];
    snprintf(buffer, sizeof(buffer), "{\"id\":\"%s\",\"code\":\"%s\",\"slot\":%u}",
             BEACON_PUBLIC_ID, currentRollingToken.c_str(), currentSlot);

    pRollingChar->setValue((uint8_t*)buffer, strlen(buffer));
    pRollingChar->notify();

    Serial.printf("[BLE TICK] Slot #%u -> Rolling Token: %s\n", currentSlot, currentRollingToken.c_str());
  }

  delay(1000);
}
