/**
 * ============================================================================
 * HOSTELGUARD ENTERPRISE v3.1: PHYSICAL RADIO BLE BEACON FIRMWARE
 * ============================================================================
 * Hardware Target: ESP32-WROOM-32 / ESP32-S3 / ESP32-C3
 * Description:     Broadcasts cryptographically signed 30-second rolling
 *                  HMAC-SHA256 proximity tokens for zero-trust residential
 *                  attendance physical anchoring.
 *
 * Plug-and-Play Horizon:
 *   - The HostelGuard server operates in 'STANDBY_OPTIONAL' today with zero hardware.
 *   - On Day 6 (when board arrives), set your Wi-Fi credentials & Shared Secret below,
 *     flash this sketch, and toggle BLE mode in the Admin Dashboard to SOFT_ANCHOR or STRICT_REQUIRED.
 * ============================================================================
 */

#include <WiFi.h>
#include <time.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <mbedtls/md.h>

// ----------------------------------------------------------------------------
// 1. CONFIGURATION PARAMETERS (Paste from HostelGuard Admin Dashboard)
// ----------------------------------------------------------------------------
const char* WIFI_SSID     = "YOUR_HOSTEL_WIFI_SSID";     // Local Wi-Fi for NTP Time Sync
const char* WIFI_PASSWORD = "YOUR_HOSTEL_WIFI_PASSWORD"; // Wi-Fi Password

// Public Beacon Identifier (Must match ID in Admin Dashboard)
const char* BEACON_PUBLIC_ID = "HG-BEACON-BLKA-01";

// 32-Byte (64 hex characters) Shared Secret generated in Admin Dashboard
const char* SHARED_SECRET_HEX = "4a8f9c1b2e3d4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a";

// BLE UUID Definitions for HostelGuard
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

// NTP Time Configuration
const char* NTP_SERVER       = "pool.ntp.org";
const long  GMT_OFFSET_SEC   = 19800; // +05:30 for Asia/Kolkata
const int   DAYLIGHT_OFFSET_SEC = 0;

// ----------------------------------------------------------------------------
// 2. STATE VARIABLES
// ----------------------------------------------------------------------------
BLEServer*         pServer = NULL;
BLECharacteristic* pCharacteristic = NULL;
bool               deviceConnected = false;
uint32_t           lastComputedSlot = 0;
String             currentRollingToken = "INIT0000";

// ----------------------------------------------------------------------------
// 3. CRYPTOGRAPHIC HMAC-SHA256 TOKEN COMPUTATION
// ----------------------------------------------------------------------------
// Converts 2 hex characters to 1 byte
uint8_t hexPairToByte(char high, char low) {
  auto hexVal = [](char c) -> uint8_t {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return 0;
  };
  return (hexVal(high) << 4) | hexVal(low);
}

// Computes 8-character rolling HMAC token matching Node.js BleBeaconService
String computeRollingHmac(const char* secretHex, const char* publicId, uint32_t slot) {
  uint8_t keyBytes[32];
  for (int i = 0; i < 32; i++) {
    keyBytes[i] = hexPairToByte(secretHex[i * 2], secretHex[i * 2 + 1]);
  }

  char payload[64];
  snprintf(payload, sizeof(payload), "%s:%u", publicId, slot);

  uint8_t hmacOutput[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_type_t md_type = MBEDTLS_MD_SHA256;

  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(md_type), 1);
  mbedtls_md_hmac_starts(&ctx, keyBytes, 32);
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)payload, strlen(payload));
  mbedtls_md_hmac_finish(&ctx, hmacOutput);
  mbedtls_md_free(&ctx);

  // Take first 4 bytes (8 hex chars)
  char tokenHex[9];
  for (int i = 0; i < 4; i++) {
    snprintf(&tokenHex[i * 2], 3, "%02X", hmacOutput[i]);
  }
  tokenHex[8] = '\0';
  return String(tokenHex);
}

// ----------------------------------------------------------------------------
// 4. BLE SERVER CALLBACKS
// ----------------------------------------------------------------------------
class ServerCallbacks: public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    Serial.println("📱 Mobile Client Connected to HostelGuard Beacon!");
  }

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    Serial.println("📡 Client Disconnected. Resuming BLE Advertising...");
    pServer->startAdvertising();
  }
};

// ----------------------------------------------------------------------------
// 5. SETUP & INITIALIZATION
// ----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=======================================================");
  Serial.println("  HOSTELGUARD ENTERPRISE v3.1: ESP32 BLE BEACON FIRMWARE");
  Serial.println("=======================================================");

  // Connect to Wi-Fi for initial NTP time synchronization
  Serial.printf("Connecting to Wi-Fi SSID '%s' for NTP Time Sync...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int retry = 0;
  while (WiFi.status() != WL_CONNECTED && retry < 20) {
    delay(500);
    Serial.print(".");
    retry++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[Wi-Fi Connected!] Synchronizing Real-Time Clock with NTP...");
    configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);
    struct tm timeinfo;
    if (getLocalTime(&timeinfo)) {
      Serial.printf("RTC Clock Synchronized! Current Time: %02d:%02d:%02d\n",
                    timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
    }
  } else {
    Serial.println("\n[Warning] Wi-Fi connection timed out. Falling back to monotonic RTC epoch counter.");
  }

  // Initialize BLE Stack
  Serial.println("Initializing BLE Subsystem (Zero-Cloud Radio Anchor)...");
  BLEDevice::init(BEACON_PUBLIC_ID);
  BLEDevice::setPower(ESP_PWR_LVL_P9); // Maximum broadcast power (+9dBm)

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);

  pCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ |
                      BLECharacteristic::PROPERTY_NOTIFY
                    );

  pCharacteristic->addDescriptor(new BLE2902());
  pService->start();

  // Configure BLE Advertising
  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06); // iPhone connection helper
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("✅ HostelGuard BLE Beacon is actively broadcasting!");
  Serial.printf("   - Public ID: %s\n", BEACON_PUBLIC_ID);
  Serial.printf("   - Service UUID: %s\n", SERVICE_UUID);
  Serial.println("=======================================================\n");
}

// ----------------------------------------------------------------------------
// 6. MAIN REFRESH LOOP (Computes fresh HMAC token every 30 seconds)
// ----------------------------------------------------------------------------
void loop() {
  time_t now = time(nullptr);
  uint32_t currentSlot = (uint32_t)(now / 30);

  // If time slot advanced (every 30 seconds)
  if (currentSlot != lastComputedSlot) {
    lastComputedSlot = currentSlot;
    currentRollingToken = computeRollingHmac(SHARED_SECRET_HEX, BEACON_PUBLIC_ID, currentSlot);

    // Payload formatted as JSON for mobile client parser
    char buffer[128];
    snprintf(buffer, sizeof(buffer), "{\"id\":\"%s\",\"code\":\"%s\",\"slot\":%u}",
             BEACON_PUBLIC_ID, currentRollingToken.c_str(), currentSlot);

    pCharacteristic->setValue((uint8_t*)buffer, strlen(buffer));
    pCharacteristic->notify();

    Serial.printf("[BLE TICK] Slot #%u -> Rolling Token: %s\n", currentSlot, currentRollingToken.c_str());
  }

  delay(1000);
}

