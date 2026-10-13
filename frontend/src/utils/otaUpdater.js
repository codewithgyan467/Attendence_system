import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { getApiBaseUrl } from './api';

/**
 * Self-Hosted Over-The-Air (OTA) Live Updater
 * Powered by @capgo/capacitor-updater (100% Free & Open-Source)
 * 
 * - Communicates with self-hosted /api/v1/ota/latest endpoint
 * - Downloads new web assets silently in the background
 * - Applies updates without requiring users to reinstall an APK
 */
export async function initOtaUpdater() {
  // Only execute inside native Android/iOS mobile wrapper
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  try {
    // 1. Signal to updater that the current bundle loaded cleanly (prevents rollback)
    await CapacitorUpdater.notifyAppReady();

    // 2. Fetch latest version info from self-hosted backend
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/ota/latest`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);

    if (res && res.success && res.available && res.downloadUrl) {
      const current = await CapacitorUpdater.current();
      const currentVersion = current?.bundle?.version || '1.0.0';

      if (currentVersion !== res.version) {
        console.log(`[OTA Live Update] Found newer web bundle: v${res.version} (current: v${currentVersion})`);
        
        // 3. Download the zipped web assets in the background
        const bundle = await CapacitorUpdater.download({
          url: res.downloadUrl,
          version: res.version
        });

        console.log(`[OTA Live Update] v${res.version} downloaded. Staging update for next launch...`);

        // 4. Set bundle to activate
        await CapacitorUpdater.set(bundle);

        // If marked mandatory by administrator, reload webview immediately
        if (res.mandatory) {
          console.log('[OTA Live Update] Mandatory update flagged. Reloading UI...');
          await CapacitorUpdater.reload();
        }
      } else {
        console.log(`[OTA Live Update] App is already on latest web version: v${currentVersion}`);
      }
    }
  } catch (err) {
    console.warn('[OTA Live Update] Background check completed with notice:', err.message || err);
  }
}

/**
 * Manual check for updates (can be called from a button or settings screen)
 */
export async function checkForOtaUpdateManual() {
  if (!Capacitor.isNativePlatform()) {
    return { success: false, message: 'OTA updates are only active inside native mobile applications.' };
  }

  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/ota/latest`).then((r) => r.json());
    if (!res || !res.available) {
      return { success: true, message: 'You are on the latest version.' };
    }

    const current = await CapacitorUpdater.current();
    if (current?.bundle?.version === res.version) {
      return { success: true, message: `Already up to date (v${res.version}).` };
    }

    const bundle = await CapacitorUpdater.download({
      url: res.downloadUrl,
      version: res.version
    });
    await CapacitorUpdater.set(bundle);

    return {
      success: true,
      hasUpdate: true,
      version: res.version,
      message: `Update v${res.version} downloaded! Restart the app to apply.`
    };
  } catch (err) {
    return { success: false, message: err.message || 'Failed to check for updates' };
  }
}
