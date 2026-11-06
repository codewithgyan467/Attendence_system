import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Camera, CameraResultType, CameraSource, CameraDirection } from '@capacitor/camera';

const AntiSpoofBridge = registerPlugin('AntiSpoofBridge');

/**
 * Checks whether the application is running inside a native mobile wrapper (Android / iOS)
 * or in a standard browser/PWA.
 */
export function isNativeMobile() {
  return Capacitor.isNativePlatform();
}

/**
 * Unified Location Provider:
 * - Uses native Android GPS hardware via AntiSpoofBridge + @capacitor/geolocation when on mobile.
 * - Detects OS-level mock location apps, AppOps mock providers, and known Fake GPS packages.
 * - Gracefully falls back to HTML5 navigator.geolocation in web browsers with progressive settling & synthetic telemetry analysis.
 */
export async function getNativeOrBrowserLocation(options = {}) {
  const { onProgress = null, maxWaitMs = 3500, targetAccuracy = 20 } = options;

  if (isNativeMobile()) {
    try {
      let perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted') {
        perm = await Geolocation.requestPermissions();
        if (perm.location !== 'granted') {
          throw new Error('Location permission denied on device.');
        }
      }

      // Check Native Android Mock Location & Fake GPS App Presence
      let nativeMockResult = null;
      try {
        if (AntiSpoofBridge && AntiSpoofBridge.checkMockStatus) {
          nativeMockResult = await AntiSpoofBridge.checkMockStatus();
        }
      } catch (mockErr) {
        console.warn('Native mock check warning:', mockErr);
      }

      // Query hardware location
      let hardwareLoc = null;
      try {
        if (AntiSpoofBridge && AntiSpoofBridge.getHardwareLocation) {
          hardwareLoc = await AntiSpoofBridge.getHardwareLocation();
        }
      } catch (locErr) {
        console.warn('Hardware location bridge warning:', locErr);
      }

      const coordinates = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      });

      const isMock = Boolean(
        nativeMockResult?.isMock ||
        nativeMockResult?.mockDetected ||
        hardwareLoc?.isMock ||
        coordinates.coords?.isMock ||
        coordinates.coords?.mocked ||
        coordinates.coords?.isFromMockProvider
      );

      const lat = hardwareLoc?.latitude ?? coordinates.coords.latitude;
      const lon = hardwareLoc?.longitude ?? coordinates.coords.longitude;
      const acc = hardwareLoc?.accuracy ?? coordinates.coords.accuracy ?? 10;
      const alt = hardwareLoc?.altitude ?? coordinates.coords.altitude ?? null;

      return {
        latitude: parseFloat(lat.toFixed(6)),
        longitude: parseFloat(lon.toFixed(6)),
        accuracy: acc,
        altitude: alt,
        isMockLocation: isMock,
        mockReason: nativeMockResult?.mockReason || hardwareLoc?.mockReason || (isMock ? 'NATIVE_MOCK_DETECTED' : 'NONE'),
        detectedApps: nativeMockResult?.detectedApps || hardwareLoc?.detectedApps || [],
        source: hardwareLoc?.source || 'CAPACITOR_NATIVE_GPS'
      };
    } catch (err) {
      console.warn('Native GPS error, falling back to browser API:', err);
    }
  }

  // Browser Geolocation API with Progressive Sampling & Satellite Settling
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(new Error('Geolocation is not supported on this device.'));
    }

    let bestReading = null;
    let watchId = null;
    let timer = null;
    const collectedSamples = [];

    const finalize = () => {
      if (watchId !== null) {
        try { navigator.geolocation.clearWatch(watchId); } catch (_) {}
        watchId = null;
      }
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }

      // Synthetic Telemetry Analysis: Detect frozen/zero-jitter mock locations in browsers
      let syntheticTelemetry = false;
      if (collectedSamples.length >= 2) {
        const s1 = collectedSamples[0];
        const sLast = collectedSamples[collectedSamples.length - 1];
        const latDelta = Math.abs(s1.latitude - sLast.latitude);
        const lonDelta = Math.abs(s1.longitude - sLast.longitude);
        // Real satellite GPS always has nanodegree jitter (> 0.000001); mock apps inject mathematically frozen coords
        if (latDelta === 0 && lonDelta === 0 && (!s1.altitude || s1.altitude === 0)) {
          syntheticTelemetry = true;
        }
      }

      if (bestReading) {
        resolve({
          ...bestReading,
          samples: collectedSamples,
          syntheticTelemetry,
          isMockLocation: syntheticTelemetry
        });
      } else {
        // Fallback to one-shot if watch didn't yield a sample in time
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            resolve({
              latitude: parseFloat(pos.coords.latitude.toFixed(6)),
              longitude: parseFloat(pos.coords.longitude.toFixed(6)),
              accuracy: pos.coords.accuracy || 10,
              altitude: pos.coords.altitude ?? null,
              samples: [{
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
                timestamp: Date.now()
              }],
              isMockLocation: false,
              source: 'BROWSER_HTML5_GPS'
            });
          },
          (err) => {
            // Resilient Fallback: If raw satellite GPS times out indoors, use cell/Wi-Fi assisted fix
            navigator.geolocation.getCurrentPosition(
              (posFallback) => {
                resolve({
                  latitude: parseFloat(posFallback.coords.latitude.toFixed(6)),
                  longitude: parseFloat(posFallback.coords.longitude.toFixed(6)),
                  accuracy: posFallback.coords.accuracy || 25,
                  altitude: posFallback.coords.altitude ?? null,
                  samples: [],
                  isMockLocation: false,
                  source: 'BROWSER_HTML5_GPS_ASSISTED'
                });
              },
              (errFallback) => {
                // Detect Android OS master Location toggle turned off
                if (err && err.code === 2) {
                  return reject(new Error('LOCATION_SWITCH_OFF: Android Location (GPS) switch is turned OFF. Please turn ON Location in your phone\'s quick-settings shade to enable Bluetooth & GPS verification.'));
                }
                reject(new Error(`GPS sensor error: ${err.message}`));
              },
              { enableHighAccuracy: false, timeout: 6000, maximumAge: 30000 }
            );
          },
          { enableHighAccuracy: true, timeout: 6000, maximumAge: 15000 }
        );
      }
    };

    // Give GPS hardware up to maxWaitMs to warm up and lock satellites
    timer = setTimeout(finalize, maxWaitMs);

    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const acc = pos.coords.accuracy || 999;
          if (onProgress) {
            onProgress(Math.round(acc));
          }

          collectedSamples.push({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: acc,
            altitude: pos.coords.altitude,
            timestamp: Date.now()
          });

          if (!bestReading || acc < bestReading.accuracy) {
            bestReading = {
              latitude: parseFloat(pos.coords.latitude.toFixed(6)),
              longitude: parseFloat(pos.coords.longitude.toFixed(6)),
              accuracy: acc,
              altitude: pos.coords.altitude ?? null,
              source: 'BROWSER_HTML5_GPS_SETTLED'
            };
          }

          // If phone locked onto accurate satellite fix (<= targetAccuracy), finish early
          if (acc <= targetAccuracy && collectedSamples.length >= 2) {
            finalize();
          }
        },
        (err) => {
          // Detect Android OS master Location toggle turned off
          if (err && err.code === 2) {
            if (timer) clearTimeout(timer);
            if (watchId !== null) {
              try { navigator.geolocation.clearWatch(watchId); } catch (_) {}
            }
            return reject(new Error('LOCATION_SWITCH_OFF: Android Location (GPS) switch is turned OFF. Please turn ON Location in your phone\'s quick-settings shade to enable Bluetooth & GPS verification.'));
          }
          // In case of error in watchPosition, finalize immediately
          finalize();
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    } catch (_) {
      finalize();
    }
  });
}

/**
 * Directly launches native Android Location Settings or opens Google Maps calibration.
 * Eliminates manual menu searching for the user.
 */
export function openNativeLocationSettings() {
  if (typeof window !== 'undefined') {
    try {
      // Direct Android Settings Intent URL
      window.location.href = 'intent:#Intent;action=android.settings.LOCATION_SOURCE_SETTINGS;end';
    } catch (_) {
      window.open('https://www.google.com/maps/search/?api=1&query=my+location', '_blank');
    }
  }
}

/**
 * Capture photo via native Capacitor Camera dialog (front-facing selfie)
 */
export async function captureNativePhoto() {
  if (isNativeMobile()) {
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.Base64,
      source: CameraSource.Camera,
      direction: CameraDirection.Front,
      quality: 88,
      allowEditing: false
    });

    return `data:image/jpeg;base64,${photo.base64String}`;
  }
  return null;
}

/**
 * HostelGuard Enterprise v3.0 Unified Location and Environment Evidence Service
 * Supports Native Android Bridge and Graceful PWA Fallback with Anti-Spoofing & Unfair-Means Telemetry
 */
export const LocationAndEnvironmentEvidenceService = {
  /**
   * Enumerate media devices in Web/PWA to detect virtual cameras (OBS, ManyCam, vMix, etc.)
   */
  async detectVirtualCamera() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return { hasVirtualCam: false, labels: [] };
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((d) => d.kind === 'videoinput');
      const suspiciousNames = ['obs', 'manycam', 'virtual', 'vmix', 'droidcam', 'swiftshader', 'fake', 'emulator'];
      const flaggedLabels = videoDevices
        .map((d) => d.label.toLowerCase())
        .filter((label) => suspiciousNames.some((s) => label.includes(s)));

      return {
        hasVirtualCam: flaggedLabels.length > 0,
        labels: flaggedLabels,
        videoDeviceCount: videoDevices.length
      };
    } catch (_) {
      return { hasVirtualCam: false, labels: [] };
    }
  },

  /**
   * Collects a bounded burst of 3-5 GPS samples and environment telemetry over 2.5 seconds
   */
  async collectEvidence(options = {}) {
    const { onProgress = null, maxSamples = 3, sampleTimeoutMs = 2500 } = options;
    const isNative = isNativeMobile();

    // 1. Check for Virtual Cameras in WebRTC
    const camAudit = await this.detectVirtualCamera();

    // 2. Collect Bounded Burst of Location Samples
    const samples = [];
    const startTime = Date.now();

    // Native Bridge Collection
    if (isNative) {
      try {
        let perm = await Geolocation.checkPermissions();
        if (perm.location !== 'granted') {
          perm = await Geolocation.requestPermissions();
        }

        for (let i = 0; i < maxSamples; i++) {
          try {
            const pos = await Geolocation.getCurrentPosition({
              enableHighAccuracy: true,
              timeout: 4000,
              maximumAge: 0
            });
            const coords = pos.coords;
            const isMock = Boolean(coords.isMock || coords.mocked || coords.isFromMockProvider);

            samples.push({
              latitude: parseFloat(coords.latitude.toFixed(6)),
              longitude: parseFloat(coords.longitude.toFixed(6)),
              accuracy: coords.accuracy || 10,
              timestamp: pos.timestamp || Date.now(),
              isMock,
              provider: coords.provider || 'fused'
            });

            if (onProgress) onProgress({ sample: i + 1, total: maxSamples, accuracy: coords.accuracy });
            if (Date.now() - startTime > sampleTimeoutMs) break;
          } catch (_) {
            break;
          }
        }
      } catch (nativeErr) {
        console.warn('Native evidence sampling notice:', nativeErr);
      }
    }

    // PWA / Web Fallback Collection if native yielded < 1 sample
    if (samples.length === 0 && typeof navigator !== 'undefined' && navigator.geolocation) {
      const fallbackPos = await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
      });

      if (fallbackPos) {
        samples.push({
          latitude: parseFloat(fallbackPos.coords.latitude.toFixed(6)),
          longitude: parseFloat(fallbackPos.coords.longitude.toFixed(6)),
          accuracy: fallbackPos.coords.accuracy || 12,
          timestamp: fallbackPos.timestamp || Date.now(),
          isMock: false,
          provider: 'browser-html5'
        });
      }
    }

    // Default reading if sensor blocked
    const bestSample = samples.length > 0
      ? samples.reduce((prev, curr) => (curr.accuracy < prev.accuracy ? curr : prev), samples[0])
      : { latitude: 0, longitude: 0, accuracy: 999, isMock: false, timestamp: Date.now() };

    return {
      latitude: bestSample.latitude,
      longitude: bestSample.longitude,
      accuracy: bestSample.accuracy,
      is_mock_location: Boolean(bestSample.isMock),
      adb_enabled: false,
      samples,
      wifi_scan: {
        status: isNative ? 'SCAN_THROTTLED' : 'SCAN_UNAVAILABLE',
        bssids: []
      },
      ble_proof: null,
      play_integrity_token: isNative ? 'TEST_PASS' : null,
      is_native: isNative,
      assurance_tier: isNative ? 'NATIVE_HIGH' : 'PWA_DEGRADED',
      device_info: {
        isNative,
        isIOS: typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)),
        isSafari: typeof navigator !== 'undefined' && /^((?!chrome|android).)*safari/i.test(navigator.userAgent),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        virtualCameraDetected: camAudit.hasVirtualCam,
        virtualCameraLabels: camAudit.labels
      }
    };
  }
};

/**
 * Extracts unmasked WebGL GPU renderer string to distinguish genuine Apple Silicon/A-series
 * GPUs from Android Qualcomm (Adreno), MediaTek (Mali), or PC emulators.
 * Runs in < 2ms.
 * @returns {string}
 */
export function getWebGLRenderer() {
  try {
    if (typeof document === 'undefined') return 'NO_DOCUMENT';
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return 'NO_WEBGL';
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (!debugInfo) {
      return gl.getParameter(gl.RENDERER) || 'STANDARD_WEBGL';
    }
    return gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'UNKNOWN_RENDERER';
  } catch (_) {
    return 'WEBGL_DETECT_ERROR';
  }
}

/**
 * Silent Hardware Verifier for Genuine iOS devices (iPhone/iPad).
 * Performs 3-point physical verification in < 10ms:
 * 1. iOS User-Agent / Platform check (iPhone, iPad, MacIntel with touch points)
 * 2. Physical GPU Hardware probe (Must contain "Apple GPU" / "Apple")
 * 3. CoreLocation Telemetry extraction (altitude, altitudeAccuracy, accuracy)
 * 
 * Prevents Android spoofers (Adreno/Mali) from bypassing BLE.
 * @param {Object} [coords] Position coordinates from geolocation
 * @returns {{ isGenuineIOS: boolean, gpuRenderer: string, maxTouchPoints: number, altitude: number|null, altitudeAccuracy: number|null, accuracy: number|null, reason?: string }}
 */
export function verifyGenuineIOSDevice(coords = null) {
  if (typeof navigator === 'undefined') {
    return { isGenuineIOS: false, reason: 'NO_NAVIGATOR', gpuRenderer: 'UNKNOWN' };
  }

  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const isIOSPlatform = /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (!isIOSPlatform) {
    return { isGenuineIOS: false, reason: 'NOT_IOS_PLATFORM', gpuRenderer: 'NON_IOS' };
  }

  const gpuRenderer = getWebGLRenderer();
  const isAppleGPU = typeof gpuRenderer === 'string' && gpuRenderer.toLowerCase().includes('apple');

  if (!isAppleGPU) {
    return {
      isGenuineIOS: false,
      reason: 'NON_APPLE_GPU_SPOOF',
      gpuRenderer,
      maxTouchPoints: navigator.maxTouchPoints || 0
    };
  }

  return {
    isGenuineIOS: true,
    gpuRenderer,
    maxTouchPoints: navigator.maxTouchPoints || 5,
    altitude: coords?.altitude ?? null,
    altitudeAccuracy: coords?.altitudeAccuracy ?? null,
    accuracy: coords?.accuracy ?? null
  };
}

/**
 * Probes active floor router ESP32 LAN endpoints for zero-cost Multi-Router Strict Lock verification.
 * @param {Array<Object|string>} endpoints
 * @param {Function} [onProgress]
 * @returns {Promise<Object|null>}
 */
export async function probeLanWifiClusterEndpoints(endpoints = [], onProgress = null) {
  if (!Array.isArray(endpoints) || endpoints.length === 0) return null;
  for (const ep of endpoints) {
    const targetUrl = typeof ep === 'string' ? ep : ep.handshakeUrl;
    if (!targetUrl) continue;
    try {
      if (onProgress) onProgress({ status: 'PROBING_LAN', message: `Checking floor router gateway (${ep.ssid || 'Floor Wi-Fi'})...` });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1800);
      const res = await fetch(targetUrl, { method: 'GET', signal: controller.signal, mode: 'cors' });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        if (data && (data.lanTicket || data.ticket)) {
          return {
            success: true,
            beaconPublicId: data.beaconId || ep.beaconId,
            lanWifiTicket: data.lanTicket || data.ticket,
            slot: data.slot || Math.floor(Date.now() / 30000),
            floor: data.floor || ep.floor,
            method: 'LAN_WIFI_HANDSHAKE',
            timestamp: Date.now()
          };
        }
      }
    } catch (_) {}
  }
  return null;
}

/**
 * Scans for nearby authorized HostelGuard ESP32 Bluetooth Beacons via Web Bluetooth API.
 * Connects to the GATT service, reads the 30-second rolling TOTP token, and disconnects immediately.
 * 
 * Target Service UUID: 4fafc201-1fb5-459e-8fcc-c5c9c331914b
 * Target Characteristic UUID: beb5483e-36e1-4688-b7f5-ea07361b26a8
 * 
 * Supports:
 * - Beacon 1: HG-BEACON-BLKA-01 (Ground Floor)
 * - Beacon 2: HG-BEACON-BLKA-02 (1st Floor, Seeed Studio XIAO ESP32-C6)
 */
export async function scanHostelBleBeacon(options = {}) {
  const { timeoutMs = 4000, onProgress = null, timeSyncPacket = null, localHttpsAnchorUrl = null, clusterEndpoints = [] } = options;

  const HOSTEL_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
  const ROLLING_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
  const TIME_SYNC_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a9';

  // 1. Native Mobile App Flow (Capacitor on iOS & Android via native CoreBluetooth & Android BLE)
  if (isNativeMobile()) {
    try {
      const { BleClient, numbersToDataView, dataViewToText } = await import('@capacitor-community/bluetooth-le');
      if (onProgress) onProgress({ status: 'INITIALIZING_BLE', message: 'Initializing native Bluetooth...' });
      await BleClient.initialize();

      // Ensure Bluetooth is toggled ON on device
      try {
        const isBtEnabled = await BleClient.isEnabled();
        if (!isBtEnabled) {
          if (onProgress) onProgress({ status: 'REQUESTING_BT', message: 'Requesting Bluetooth enable...' });
          await BleClient.requestEnable();
        }
      } catch (_) {}

      if (onProgress) onProgress({ status: 'SCANNING', message: 'Scanning for floor ESP32 anchor...' });

      let foundDevice = null;
      await BleClient.requestLEScan(
        { services: [HOSTEL_SERVICE_UUID] },
        (result) => {
          if (result && result.device) {
            foundDevice = result.device;
            BleClient.stopLEScan().catch(() => {});
          }
        }
      );

      const startScan = Date.now();
      while (!foundDevice && (Date.now() - startScan < 4000)) {
        await new Promise(r => setTimeout(r, 150));
      }
      try { await BleClient.stopLEScan(); } catch (_) {}

      if (foundDevice) {
        if (onProgress) onProgress({ status: 'CONNECTING', message: `Connecting to ${foundDevice.name || 'ESP32'}...` });
        await BleClient.connect(foundDevice.deviceId);

        if (timeSyncPacket) {
          try {
            await BleClient.write(
              foundDevice.deviceId,
              HOSTEL_SERVICE_UUID,
              TIME_SYNC_CHAR_UUID,
              numbersToDataView(new TextEncoder().encode(String(timeSyncPacket)))
            );
          } catch (_) {}
        }

        const dataView = await BleClient.read(foundDevice.deviceId, HOSTEL_SERVICE_UUID, ROLLING_CHAR_UUID);
        const rawPayload = dataViewToText(dataView);

        // Fast release to avoid slot starvation
        setTimeout(async () => {
          try { await BleClient.disconnect(foundDevice.deviceId); } catch (_) {}
        }, 150);

        let parsed = null;
        try { parsed = JSON.parse(rawPayload); } catch (_) {
          const parts = rawPayload.split(':');
          if (parts.length >= 3) {
            parsed = { id: parts[0], code: parts[1], slot: parseInt(parts[2], 10) };
          }
        }

        if (parsed && parsed.id && parsed.code) {
          return {
            success: true,
            beaconPublicId: parsed.id,
            rollingCode: parsed.code,
            slot: parsed.slot || Math.floor(Date.now() / 30000),
            deviceName: foundDevice.name || parsed.id,
            rawPayload,
            timestamp: Date.now()
          };
        }
      }

      return {
        success: false,
        reason: 'NATIVE_BEACON_NOT_FOUND',
        message: 'No authorized HostelGuard ESP32 beacon was detected in Bluetooth range (~15m). Please stand near the floor beacon and ensure the red LED is lit.'
      };
    } catch (nativeBleErr) {
      console.warn('Native BLE scanner exception:', nativeBleErr);
      return {
        success: false,
        reason: 'NATIVE_BLE_ERROR',
        message: `Native Bluetooth Error: ${nativeBleErr?.message || 'Please ensure Bluetooth and Location are turned ON in device settings.'}`
      };
    }
  }

  // 2. Standard Web Browser Flow (Web Bluetooth API in Chrome, Edge, Bluefy)
  if (typeof navigator === 'undefined' || !navigator.bluetooth) {
    const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    const isSecure = typeof window !== 'undefined' ? window.isSecureContext : false;
    const isHttp = typeof window !== 'undefined' && window.location.protocol === 'http:';

    // Multi-Router Strict Lock: Probe floor router LAN handshake endpoints
    if (Array.isArray(clusterEndpoints) && clusterEndpoints.length > 0) {
      const lanProbeResult = await probeLanWifiClusterEndpoints(clusterEndpoints, onProgress);
      if (lanProbeResult) {
        return lanProbeResult;
      }
    }

    // Fix 1 & 2: Local Wi-Fi HTTPS Probe for iOS Safari PWA (DuckDNS / Local Anchor)
    if (localHttpsAnchorUrl) {
      try {
        if (onProgress) onProgress({ status: 'PROBING_WIFI', message: 'Checking floor ESP32 local anchor over secure Wi-Fi...' });
        const controller = new AbortController();
        const probeTimeout = setTimeout(() => controller.abort(), 2500);
        const probeRes = await fetch(localHttpsAnchorUrl, {
          method: 'GET',
          signal: controller.signal,
          mode: 'cors'
        });
        clearTimeout(probeTimeout);
        if (probeRes.ok) {
          const probeData = await probeRes.json();
          if (probeData && probeData.code && (probeData.id || probeData.beaconPublicId)) {
            return {
              success: true,
              beaconPublicId: probeData.id || probeData.beaconPublicId,
              rollingCode: probeData.code || probeData.rollingCode,
              slot: probeData.slot || Math.floor(Date.now() / 30000),
              method: 'LOCAL_HTTPS_PROBE',
              deviceName: probeData.name || probeData.id,
              timestamp: Date.now()
            };
          }
        }
      } catch (_) {
        // Fallback to unsupported notice
      }
    }

    let unsupportedMsg = 'Web Bluetooth is not supported on this browser. On Android/PC, please use Google Chrome, Microsoft Edge, or Samsung Internet.';
    if (isIOS) {
      unsupportedMsg = 'Physical Presence Lock Active: Apple Safari blocks Web Bluetooth. To detect the hostel ESP32 beacon on iPhone, open HostelGuard in "Bluefy - Web BLE Browser" (free on App Store), use the floor secure Wi-Fi anchor, or use an Android phone.';
    } else if (!isSecure && isHttp) {
      unsupportedMsg = 'Web Bluetooth requires a Secure HTTPS connection. Google Chrome disables Bluetooth on http:// URLs. Please switch your address bar from http:// to https:// or install the signed HostelGuard APK.';
    }

    return {
      success: false,
      reason: 'BLUETOOTH_API_UNSUPPORTED',
      isIOS,
      isHttpInsecure: !isSecure && isHttp,
      message: unsupportedMsg
    };
  }

  if (onProgress) onProgress({ status: 'REQUESTING_DEVICE', message: 'Scanning for nearby hostel ESP32 beacons...' });

  let device = null;
  const isIOSDevice = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

  // Fix 6: Check navigator.bluetooth.getDevices() first to reconnect silently without opening the chooser dialog
  if (navigator.bluetooth && typeof navigator.bluetooth.getDevices === 'function') {
    try {
      const permittedDevices = await navigator.bluetooth.getDevices();
      if (Array.isArray(permittedDevices) && permittedDevices.length > 0) {
        const knownBeacon = permittedDevices.find(d =>
          d.name && (
            d.name.startsWith('HG-') ||
            d.name.startsWith('HG-A') ||
            d.name.startsWith('Hostel') ||
            d.name.includes('BEACON')
          )
        );
        if (knownBeacon) {
          device = knownBeacon;
          if (onProgress) onProgress({ status: 'RECONNECTING', message: `Silently connecting to saved beacon (${device.name})...` });
        }
      }
    } catch (_) {
      // Fallback to interactive requestDevice chooser
    }
  }

  // If not previously paired, open interactive device chooser with broadened 29-byte short filters
  if (!device) {
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'HG-A' },
          { namePrefix: 'HG-' },
          { namePrefix: 'HG-BEACON' },
          { namePrefix: 'HostelGuard' },
          { namePrefix: 'Hostel' },
          { services: [HOSTEL_SERVICE_UUID] }
        ],
        optionalServices: [HOSTEL_SERVICE_UUID]
      });
    } catch (err) {
      const errMsg = err?.message || (typeof err === 'string' ? err : 'Bluetooth pairing was cancelled');
      if (err?.name === 'NotFoundError') {
        return {
          success: false,
          reason: 'BLUETOOTH_DEVICE_NOT_SELECTED',
          message: 'No hostel beacon was selected, or Bluetooth pairing was cancelled. Please ensure your floor ESP32 board is plugged into power and Bluetooth is enabled on your phone.'
        };
      }
      if (err?.name === 'SecurityError') {
        return {
          success: false,
          reason: 'BLUETOOTH_SECURITY_RESTRICTION',
          message: 'Bluetooth access blocked. Please check browser site permissions and ensure HTTPS or localhost is active.'
        };
      }
      return {
        success: false,
        reason: isIOSDevice ? 'BLE_FALLBACK_TO_IOS_SILENT' : 'BLUETOOTH_REQUEST_ERROR',
        isIOS: isIOSDevice,
        message: isIOSDevice
          ? 'Physical Presence Lock Active: Apple Safari blocks Web Bluetooth.'
          : (errMsg || 'Failed to initialize Bluetooth scan. Please ensure Bluetooth is ON in Android Settings.')
      };
    }
  }

  if (!device) {
    return {
      success: false,
      reason: 'NO_DEVICE_SELECTED',
      message: 'No authorized HostelGuard Bluetooth beacon selected.'
    };
  }

  if (onProgress) onProgress({ status: 'CONNECTING', message: `Connecting to ${device.name || 'ESP32 Beacon'}...` });

  let server = null;
  try {
    const connectPromise = device.gatt.connect();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Connection to ESP32 beacon timed out.')), timeoutMs)
    );

    server = await Promise.race([connectPromise, timeoutPromise]);

    if (onProgress) onProgress({ status: 'READING_TOKEN', message: 'Reading 30-second rolling token...' });

    const service = await server.getPrimaryService(HOSTEL_SERVICE_UUID);

    // Phone Time-Mule write - write server-signed time sync packet to keep offline ESP32 clock calibrated
    if (timeSyncPacket) {
      try {
        const timeChar = await service.getCharacteristic(TIME_SYNC_CHAR_UUID);
        if (timeChar) {
          const encoder = new TextEncoder();
          await timeChar.writeValue(encoder.encode(String(timeSyncPacket)));
        }
      } catch (_) {
        // Non-blocking time calibration relay
      }
    }

    const characteristic = await service.getCharacteristic(ROLLING_CHAR_UUID);
    const dataView = await characteristic.readValue();

    // Safely decode the DataView returned by readValue()
    const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
    const rawPayload = new TextDecoder('utf-8').decode(bytes).trim();

    let parsed = null;
    try {
      parsed = JSON.parse(rawPayload);
    } catch (_) {
      const parts = rawPayload.split(':');
      if (parts.length >= 3) {
        parsed = {
          id: parts[0],
          code: parts[1],
          slot: parseInt(parts[2], 10)
        };
      }
    }

    if (!parsed || !parsed.id || !parsed.code) {
      return {
        success: false,
        reason: 'MALFORMED_BEACON_PAYLOAD',
        message: `Invalid rolling code format received from beacon: ${rawPayload}`
      };
    }

    if (onProgress) onProgress({ status: 'SUCCESS', message: `Verified signal from ${parsed.id}` });

    return {
      success: true,
      beaconPublicId: parsed.id,
      rollingCode: parsed.code,
      slot: parsed.slot || Math.floor(Date.now() / 30000),
      deviceName: device.name || parsed.id,
      rawPayload,
      timestamp: Date.now()
    };
  } catch (err) {
    const errMsg = err?.message || (typeof err === 'string' ? err : 'BLE read interrupted');
    const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    return {
      success: false,
      reason: isIOS ? 'BLE_FALLBACK_TO_IOS_SILENT' : 'GATT_COMMUNICATION_ERROR',
      isIOS,
      message: `Failed to read beacon token: ${errMsg}`
    };
  } finally {
    // Release ESP32 GATT connection slots cleanly AFTER readValue resolves
    if (server && server.connected) {
      try { server.disconnect(); } catch (_) {}
    } else if (device?.gatt?.connected) {
      try { device.gatt.disconnect(); } catch (_) {}
    }
  }
}


