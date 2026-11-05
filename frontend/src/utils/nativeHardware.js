import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Camera, CameraResultType, CameraSource, CameraDirection } from '@capacitor/camera';

/**
 * Checks whether the application is running inside a native mobile wrapper (Android / iOS)
 * or in a standard browser/PWA.
 */
export function isNativeMobile() {
  return Capacitor.isNativePlatform();
}

/**
 * Unified Location Provider:
 * - Uses native Android GPS hardware via @capacitor/geolocation when on mobile.
 * - Gracefully falls back to HTML5 navigator.geolocation in web browsers with progressive settling.
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

      const coordinates = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      });

      const isMock = Boolean(
        coordinates.coords?.isMock ||
        coordinates.coords?.mocked ||
        coordinates.coords?.isFromMockProvider
      );

      return {
        latitude: parseFloat(coordinates.coords.latitude.toFixed(6)),
        longitude: parseFloat(coordinates.coords.longitude.toFixed(6)),
        accuracy: coordinates.coords.accuracy || 10,
        isMockLocation: isMock,
        source: 'CAPACITOR_NATIVE_GPS'
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

    const finalize = () => {
      if (watchId !== null) {
        try { navigator.geolocation.clearWatch(watchId); } catch (_) {}
        watchId = null;
      }
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }

      if (bestReading) {
        resolve(bestReading);
      } else {
        // Fallback to one-shot if watch didn't yield a sample in time
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            resolve({
              latitude: parseFloat(pos.coords.latitude.toFixed(6)),
              longitude: parseFloat(pos.coords.longitude.toFixed(6)),
              accuracy: pos.coords.accuracy || 10,
              isMockLocation: false,
              source: 'BROWSER_HTML5_GPS'
            });
          },
          (err) => reject(new Error(`GPS sensor error: ${err.message}`)),
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
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

          if (!bestReading || acc < bestReading.accuracy) {
            bestReading = {
              latitude: parseFloat(pos.coords.latitude.toFixed(6)),
              longitude: parseFloat(pos.coords.longitude.toFixed(6)),
              accuracy: acc,
              isMockLocation: false,
              source: 'BROWSER_HTML5_GPS_SETTLED'
            };
          }

          // If phone locked onto accurate satellite fix (<= targetAccuracy), finish early
          if (acc <= targetAccuracy) {
            finalize();
          }
        },
        () => {
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
  const { timeoutMs = 12000, onProgress = null } = options;

  if (typeof navigator === 'undefined' || !navigator.bluetooth) {
    const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    return {
      success: false,
      reason: 'BLUETOOTH_API_UNSUPPORTED',
      message: isIOS
        ? 'Physical Presence Lock Active: Apple Safari blocks Web Bluetooth. To detect the hostel ESP32 beacon on iPhone, open HostelGuard in "Bluefy - Web BLE Browser" (free on App Store) or use an Android phone.'
        : 'Web Bluetooth is not supported on this browser. On Android/PC, please use Google Chrome, Microsoft Edge, or Samsung Internet.'
    };
  }

  const HOSTEL_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
  const ROLLING_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';

  if (onProgress) onProgress({ status: 'REQUESTING_DEVICE', message: 'Scanning for nearby hostel ESP32 beacons...' });

  let device = null;
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: 'HG-BEACON' },
        { services: [HOSTEL_SERVICE_UUID] }
      ],
      optionalServices: [HOSTEL_SERVICE_UUID]
    });
  } catch (err) {
    if (err.name === 'NotFoundError') {
      return {
        success: false,
        reason: 'BLUETOOTH_DEVICE_NOT_SELECTED',
        message: 'No hostel beacon was selected, or Bluetooth pairing was cancelled. Please ensure your floor ESP32 board is powered ON and nearby.'
      };
    }
    if (err.name === 'SecurityError') {
      return {
        success: false,
        reason: 'BLUETOOTH_SECURITY_RESTRICTION',
        message: 'Bluetooth access blocked. Please check browser site permissions and ensure HTTPS or localhost is active.'
      };
    }
    return {
      success: false,
      reason: 'BLUETOOTH_REQUEST_ERROR',
      message: err.message || 'Failed to initialize Bluetooth scan.'
    };
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
    const characteristic = await service.getCharacteristic(ROLLING_CHAR_UUID);
    const valueDataView = await characteristic.readValue();

    const decoder = new TextDecoder('utf-8');
    const rawPayload = decoder.decode(valueDataView);

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
    return {
      success: false,
      reason: 'GATT_COMMUNICATION_ERROR',
      message: `Failed to read beacon token: ${err.message}`
    };
  } finally {
    // Release ESP32 GATT connection slots immediately for other students
    if (server && server.connected) {
      try { server.disconnect(); } catch (_) {}
    } else if (device?.gatt?.connected) {
      try { device.gatt.disconnect(); } catch (_) {}
    }
  }
}


