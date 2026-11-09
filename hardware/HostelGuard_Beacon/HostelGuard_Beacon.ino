/**
 * HostelGuard Enterprise v4.2 - Layer 2 Hardware BLE Anchor Firmware
 * Target MCU: Seeed Studio XIAO ESP32C6 / ESP32-WROOM / ESP32-S3
 * Framework: Arduino-ESP32 (v2.0.x or v3.0.x) / PlatformIO
 */

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include "mbedtls/md.h"

// ============================================================================
// 1. MULTI-FLOOR CONFIGURATION (Change per floor board)
// ============================================================================
#define FLOOR_ANCHOR_ID      "A01"                  // 3 chars max (e.g., A01, A02, B01)
#define BLE_DEVICE_NAME      "HG-BEACON-BLKA-01"    // Must start with "HG-BEACON-" or "HG-"
#define ANCHOR_HMAC_SECRET   "HG_STRICT_ANCHOR_SECRET_2026" // Must match backend .env

// Must match SERVICE_UUID and CHARACTERISTIC_UUID in frontend/src/utils/nativeHardware.js
#define HG_SERVICE_UUID              "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define HG_CHARACTERISTIC_UUID       "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define HG_TIME_SYNC_CHAR_UUID       "beb5483e-36e1-4688-b7f5-ea07361b26a9"

// ============================================================================
// 2. TIMING & WATCHDOG CONSTANTS
// ============================================================================
#define TOTP_STEP_MS         30000ULL  // 30-second rolling window
#define MAX_CONN_HOLD_MS     3500UL    // Force-disconnect hung clients after 3.5s
#define TOKEN_UPDATE_MS      1000UL    // Refresh cached payload every 1s

#ifndef LED_BUILTIN
  #if defined(CONFIG_IDF_TARGET_ESP32C6)
    #define LED_BUILTIN 15             // XIAO ESP32C6 onboard yellow LED
  #else
    #define LED_BUILTIN 2              // Standard ESP32 onboard LED
  #endif
#endif

// ============================================================================
// 3. GLOBAL BLE STATE
// ============================================================================
BLEServer* pServer = nullptr;
BLECharacteristic* pTokenCharacteristic = nullptr;

volatile bool deviceConnected = false;
volatile uint16_t activeConnId = 0;
volatile unsigned long connectedTimestampMs = 0;
unsigned long lastTokenUpdateMs = 0;
uint32_t lastComputedStep = 0xFFFFFFFF;
char currentPayload[20] = {0}; // Strictly 19 chars + null terminator (<20-byte BLE MTU)

// ============================================================================
// 4. CRYPTOGRAPHIC HMAC-SHA256 GENERATOR (19-Byte Compact Frame)
// ============================================================================
/**
 * Generates a 19-byte ASCII payload: "<ID>|<STEP_HEX>|<HMAC_8HEX>"
 * Example: "A01|0001A4|9F8E7D6C" (19 bytes total -> 0% truncation on iOS Bluefy)
 */
void updateRollingToken(bool forceUpdate = false) {
  // If clock was synced via BLE or NTP (epoch > 2023), use real 30s epoch step
  time_t nowSec;
  time(&nowSec);
  uint32_t currentStep = 0;
  if (nowSec > 1700000000LL) {
    currentStep = (uint32_t)(nowSec / 30);
  } else {
    uint64_t uptimeMs = esp_timer_get_time() / 1000ULL;
    currentStep = (uint32_t)(uptimeMs / TOTP_STEP_MS);
  }

  if (!forceUpdate && currentStep == lastComputedStep) {
    return;
  }
  lastComputedStep = currentStep;

  // Format message to sign: "<FLOOR_ANCHOR_ID>:<STEP_DECIMAL>"
  char messageToSign[32];
  snprintf(messageToSign, sizeof(messageToSign), "%s:%lu", FLOOR_ANCHOR_ID, (unsigned long)currentStep);

  // Compute HMAC-SHA256 in hardware via mbedTLS
  uint8_t hmacResult[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_type_t md_type = MBEDTLS_MD_SHA256;

  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(md_type), 1);
  mbedtls_md_hmac_starts(&ctx, (const unsigned char*)ANCHOR_HMAC_SECRET, strlen(ANCHOR_HMAC_SECRET));
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)messageToSign, strlen(messageToSign));
  mbedtls_md_hmac_finish(&ctx, hmacResult);
  mbedtls_md_free(&ctx);

  // Extract first 4 bytes (8 hex chars) of HMAC-SHA256
  // Total length: 3 (ID) + 1 ('|') + 6 (STEP_HEX) + 1 ('|') + 8 (HMAC_HEX) = 19 bytes
  snprintf(
    currentPayload,
    sizeof(currentPayload),
    "%-3.3s|%06lX|%02X%02X%02X%02X",
    FLOOR_ANCHOR_ID,
    (unsigned long)(currentStep & 0xFFFFFF),
    hmacResult[0], hmacResult[1], hmacResult[2], hmacResult[3]
  );

  if (pTokenCharacteristic != nullptr) {
    pTokenCharacteristic->setValue((uint8_t*)currentPayload, strlen(currentPayload));
  }

  Serial.printf("[HG-ANCHOR] Step: %lu | GATT Payload (%uB): %s\n",
                (unsigned long)currentStep,
                (unsigned int)strlen(currentPayload),
                currentPayload);
}

// ============================================================================
// 5. BLE SERVER & CHARACTERISTIC CALLBACKS
// ============================================================================
class HGServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* server, esp_ble_gatts_cb_param_t* param) override {
    deviceConnected = true;
    activeConnId = param->connect.conn_id;
    connectedTimestampMs = millis();
    digitalWrite(LED_BUILTIN, LOW); // Active-low LED ON on XIAO ESP32C6

    // Request fast connection interval (15ms - 30ms) for sub-300ms iOS Bluefy read
    server->updateConnParams(param->connect.remote_bda, 0x0C, 0x18, 0, 200);

    // Continue advertising so passive scanners can still see the board
    BLEDevice::startAdvertising();
  }

  void onDisconnect(BLEServer* server) override {
    deviceConnected = false;
    digitalWrite(LED_BUILTIN, HIGH);
    // CRITICAL: Immediately restart advertising so the next check-in never fails
    BLEDevice::startAdvertising();
  }
};

class HGCharacteristicCallbacks : public BLECharacteristicCallbacks {
  void onRead(BLECharacteristic* pCharacteristic) override {
    // Refresh token right before returning value to student's phone
    updateRollingToken(true);
  }
};

class HGTimeSyncCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) override {
    std::string rxValue = pCharacteristic->getValue();
    if (rxValue.length() > 0) {
      long long receivedEpoch = 0;
      if (rxValue.find(':') != std::string::npos) {
        receivedEpoch = atoll(rxValue.substr(0, rxValue.find(':')).c_str());
      } else {
        receivedEpoch = atoll(rxValue.c_str());
      }
      if (receivedEpoch > 1700000000LL) {
        struct timeval tv;
        tv.tv_sec = (time_t)receivedEpoch;
        tv.tv_usec = 0;
        settimeofday(&tv, NULL);
        Serial.printf("[HG-ANCHOR] Clock synced via BLE to epoch: %lld\n", receivedEpoch);
        updateRollingToken(true);
      }
    }
  }
};

// ============================================================================
// 6. XIAO ESP32C6 HARDWARE RF ANTENNA INITIALIZATION
// ============================================================================
void initRadioHardware() {
#if defined(CONFIG_IDF_TARGET_ESP32C6)
  // Seeed Studio XIAO ESP32C6 requires GPIO3 LOW to enable RF switch
  // and GPIO14 LOW for onboard ceramic antenna (set GPIO14 HIGH if using external U.FL antenna)
  pinMode(3, OUTPUT);
  digitalWrite(3, LOW);
  pinMode(14, OUTPUT);
  digitalWrite(14, LOW);
#endif
}

// ============================================================================
// 7. SETUP & LOOP
// ============================================================================
void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH);

  initRadioHardware();

  // Initialize BLE stack and expand ATT MTU to 128 bytes
  BLEDevice::init(BLE_DEVICE_NAME);
  BLEDevice::setMTU(128);

  // Boost BLE TX Power to +9 dBm for reliable 15-meter indoor room penetration
  BLEDevice::setPower(ESP_PWR_LVL_P9, ESP_BLE_PWR_TYPE_DEFAULT);
  BLEDevice::setPower(ESP_PWR_LVL_P9, ESP_BLE_PWR_TYPE_ADV);
  BLEDevice::setPower(ESP_PWR_LVL_P9, ESP_BLE_PWR_TYPE_CONN_HDL0);

  // Create GATT Server & Service
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new HGServerCallbacks());

  BLEService* pService = pServer->createService(HG_SERVICE_UUID);

  pTokenCharacteristic = pService->createCharacteristic(
    HG_CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  pTokenCharacteristic->addDescriptor(new BLE2902());
  pTokenCharacteristic->setCallbacks(new HGCharacteristicCallbacks());

  // Characteristic for zero-config BLE Clock Sync from student phone
  BLECharacteristic* pTimeSyncChar = pService->createCharacteristic(
    HG_TIME_SYNC_CHAR_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  pTimeSyncChar->setCallbacks(new HGTimeSyncCallbacks());

  // Populate initial cryptographic token
  updateRollingToken(true);

  pService->start();

  // Configure high-visibility BLE Advertising (100ms interval)
  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(HG_SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinInterval(0xA0); // 100ms
  pAdvertising->setMaxInterval(0xF0); // 150ms
  // Helps iOS CoreBluetooth / Bluefy resolve GATT services without pairing prompts
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMaxPreferred(0x12);

  BLEDevice::startAdvertising();
  Serial.println("[HG-ANCHOR] BLE Hardware Anchor Active & Advertising!");
}

void loop() {
  unsigned long now = millis();

  // 1. Periodic rolling token update
  if (now - lastTokenUpdateMs >= TOKEN_UPDATE_MS) {
    lastTokenUpdateMs = now;
    updateRollingToken(false);
  }

  // 2. Stale Connection Watchdog:
  // If a phone stays connected >3.5s (e.g., user closed Bluefy mid-read),
  // drop the connection so the anchor is immediately free for the next student.
  if (deviceConnected && (now - connectedTimestampMs > MAX_CONN_HOLD_MS)) {
    Serial.println("[HG-ANCHOR] Watchdog: Dropping stale BLE peer & restarting advertising");
    pServer->disconnect(activeConnId);
    deviceConnected = false;
    BLEDevice::startAdvertising();
  }

  delay(20);
}

