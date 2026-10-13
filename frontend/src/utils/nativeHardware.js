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
 * - Gracefully falls back to HTML5 navigator.geolocation in web browsers.
 */
export async function getNativeOrBrowserLocation() {
  if (isNativeMobile()) {
    try {
      // 1. Check and request location permission on native device
      let perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted') {
        perm = await Geolocation.requestPermissions();
        if (perm.location !== 'granted') {
          throw new Error('Location permission denied on device.');
        }
      }

      // 2. Fetch high-accuracy native Android/iOS coordinates
      const coordinates = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      });

      // 3. Inspect native coordinate properties for mock spoofer indicators
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

  // Fallback: Browser Geolocation API
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(new Error('Geolocation is not supported on this device.'));
    }

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
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
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
