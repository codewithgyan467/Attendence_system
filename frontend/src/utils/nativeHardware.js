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
