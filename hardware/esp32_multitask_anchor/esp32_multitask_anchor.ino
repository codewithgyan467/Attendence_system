#include "esp_wifi.h"
#include "mbedtls/md.h"
#include "time.h"
#include <Arduino.h>
#include <HTTPClient.h>
#include <NimBLEDevice.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiMulti.h>

// ==================== FLOOR CONFIGURATION ====================
#define BEACON_ID "HG-BEACON-BLKA-01"
#define SHORT_BLE_NAME "HG-A01" // 6 bytes -> Fits 29B primary packet
#define FLOOR_NUMBER 1

// Multi-Wi-Fi Network Credentials (Auto-Fallback)
#define WIFI_SSID_1 "AEC_Student_5.0"
#define WIFI_PASS_1 "password"

#define WIFI_SSID_2 "Shashanka’s iPhone"
#define WIFI_PASS_2 "Random123"

#define WIFI_SSID_3 "iphone"
#define WIFI_PASS_3 "paword123"

#define BACKEND_SYNC_URL \
  "https://hostelguard-backend-oimp.onrender.com/api/v1/admin/wifi-cluster/esp32-heartbeat"
#define SHARED_SECRET "hostelguard_super_secret_32b_key"

#define SERVICE_UUID "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define TOKEN_CHAR_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

WebServer lanServer(80);
WiFiMulti wifiMulti;
NimBLECharacteristic *pTokenChar = nullptr;
unsigned long lastHeartbeatMs = 0;

String generateRollingToken(uint32_t slot, const String &prefix = "") {
  String payload = String(BEACON_ID) + ":" + String(slot) +
                   (prefix.length() ? (":" + prefix) : "");
  byte hmacResult[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  mbedtls_md_hmac_starts(&ctx, (const unsigned char *)SHARED_SECRET,
                         strlen(SHARED_SECRET));
  mbedtls_md_hmac_update(&ctx, (const unsigned char *)payload.c_str(),
                         payload.length());
  mbedtls_md_finish(&ctx, hmacResult);
  mbedtls_md_free(&ctx);

  char hexToken[9];
  snprintf(hexToken, sizeof(hexToken), "%02X%02X%02X%02X", hmacResult[0],
           hmacResult[1], hmacResult[2], hmacResult[3]);
  return String(hexToken);
}

uint32_t getCurrentSlot() {
  time_t now;
  time(&now);
  if (now > 1700000000)
    return (uint32_t)(now / 30);
  return (uint32_t)(millis() / 30000);
}

class TokenCharCallbacks : public NimBLECharacteristicCallbacks {
  void onRead(NimBLECharacteristic *pCharacteristic,
              NimBLEConnInfo &connInfo) override {
    uint32_t slot = getCurrentSlot();
    String token = generateRollingToken(slot);
    // Compact 19-byte ASCII payload: <ANCHOR_ID>|<STEP_HEX>|<HMAC_8HEX>
    // e.g. A01|0001A4|9F8E7D6C (never truncates on iOS CoreBluetooth 20-byte default MTU)
    char compactPayload[24];
    snprintf(compactPayload, sizeof(compactPayload), "%s|%06X|%s",
             "A01", (unsigned int)(slot & 0xFFFFFF), token.c_str());
    pCharacteristic->setValue(compactPayload);
  }
};

void setupLanRoutes() {
  lanServer.on("/lan-handshake", HTTP_GET, []() {
    lanServer.sendHeader("Access-Control-Allow-Origin", "*");
    uint32_t slot = getCurrentSlot();
    String clientIp = lanServer.client().remoteIP().toString();
    String lanSig = generateRollingToken(slot, clientIp);

    String returnUrl = lanServer.arg("returnUrl");
    String ticket = String(BEACON_ID) + "|" + String(FLOOR_NUMBER) + "|" +
                    clientIp + "|" + String(slot) + "|" + lanSig;

    if (returnUrl.length() > 0) {
      String sep = (returnUrl.indexOf('?') >= 0) ? "&" : "?";
      lanServer.sendHeader("Location",
                           returnUrl + sep + "lan_wifi_ticket=" + ticket, true);
      lanServer.send(302, "text/plain", "Redirecting to HostelGuard...");
    } else {
      String json = "{\"ok\":true,\"beaconId\":\"" + String(BEACON_ID) +
                    "\",\"floor\":" + String(FLOOR_NUMBER) +
                    ",\"clientLanIp\":\"" + clientIp +
                    "\",\"slot\":" + String(slot) + ",\"lanTicket\":\"" +
                    ticket + "\"}";
      lanServer.send(200, "application/json", json);
    }
  });

  lanServer.begin();
}

void sendCloudHeartbeat() {
  if (WiFi.status() != WL_CONNECTED)
    return;
  HTTPClient http;
  http.begin(BACKEND_SYNC_URL);
  http.addHeader("Content-Type", "application/json");
  uint32_t slot = getCurrentSlot();
  String body = "{\"beaconId\":\"" + String(BEACON_ID) + "\",\"shortName\":\"" +
                String(SHORT_BLE_NAME) +
                "\",\"floor\":" + String(FLOOR_NUMBER) + ",\"ssid\":\"" +
                WiFi.SSID() + "\",\"localIp\":\"" + WiFi.localIP().toString() +
                "\",\"slot\":" + String(slot) + ",\"signature\":\"" +
                generateRollingToken(slot, WiFi.localIP().toString()) + "\"}";
  http.POST(body);
  http.end();
}

void setup() {
  Serial.begin(115200);

  WiFi.mode(WIFI_STA);
  esp_wifi_set_ps(WIFI_PS_NONE);

  // Register multi-Wi-Fi APs: ESP32 connects automatically to whichever is active
  wifiMulti.addAP(WIFI_SSID_1, WIFI_PASS_1);
  wifiMulti.addAP(WIFI_SSID_2, WIFI_PASS_2);
  wifiMulti.addAP("Shashanka's iPhone", WIFI_PASS_2); // ASCII apostrophe fallback
  wifiMulti.addAP("iphone", WIFI_PASS_3);
  wifiMulti.addAP("iPhone", WIFI_PASS_3);
  wifiMulti.addAP("iPhone", "password123");
  wifiMulti.addAP("iphone", "password123");

  Serial.println("[WIFI] Scanning and connecting to authorized Wi-Fi...");
  wifiMulti.run();

  NimBLEDevice::init(SHORT_BLE_NAME);
  NimBLEDevice::setMTU(128);
  NimBLEDevice::setPower(ESP_PWR_LVL_N6);

  NimBLEServer *pServer = NimBLEDevice::createServer();
  pServer->advertiseOnDisconnect(true);

  NimBLEService *pService = pServer->createService(SERVICE_UUID);
  pTokenChar =
      pService->createCharacteristic(TOKEN_CHAR_UUID, NIMBLE_PROPERTY::READ);
  pTokenChar->setCallbacks(new TokenCharCallbacks());
  pService->start();

  NimBLEAdvertising *pAdvertising = NimBLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setName(SHORT_BLE_NAME);
  pAdvertising->start();

  configTime(0, 0, "pool.ntp.org", "time.google.com");
  setupLanRoutes();
}

void loop() {
  lanServer.handleClient();

  if (WiFi.status() != WL_CONNECTED) {
    wifiMulti.run();
  }

  if (WiFi.status() == WL_CONNECTED &&
      (millis() - lastHeartbeatMs > 60000 || lastHeartbeatMs == 0)) {
    lastHeartbeatMs = millis();
    sendCloudHeartbeat();
  }
  delay(2);
}
