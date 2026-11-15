import { api } from './api';

const DB_NAME = 'AttendraOfflineDB';
const DB_VERSION = 1;
const STORE_NAME = 'attendance_queue';

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB not supported in this environment.'));
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('studentId', 'studentId', { unique: false });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * Calculates SHA-256 hash using native Web Crypto API
 */
export async function computeImageSha256(base64Data) {
  try {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
      const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
      const binaryString = atob(cleanBase64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', bytes);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (err) {
    console.warn('[OfflineQueue] Web Crypto SHA-256 fallback error:', err);
  }
  return null;
}

/**
 * Enqueue an attendance verification payload for offline storage
 */
export async function enqueueOfflineAttendance(record) {
  try {
    const db = await openOfflineDB();
    const frameBase64 = record.frameBase64 || record.live_photo || record.livePhoto;
    const computedHash = record.imageHash || record.image_hash || (frameBase64 ? await computeImageSha256(frameBase64) : null);

    const queueItem = {
      studentId: record.studentId || record.student_id || null,
      rollNumber: record.rollNumber || record.roll_number || null,
      frameBase64: frameBase64,
      imageHash: computedHash,
      beaconId: record.beaconId || record.beacon_id || record.beaconPublicId || 'HG-BEACON-BLKA-01',
      slot30s: record.slot30s !== undefined ? record.slot30s : (record.slot !== undefined ? record.slot : Math.floor(Date.now() / 30000)),
      hwSignature: record.hwSignature || record.hw_signature || record.signature || record.rollingCode || 'OFFLINE_FALLBACK_SIG',
      rawPayload: record.rawPayload || null,
      gpsCoords: record.gpsCoords || null,
      timestamp: Date.now(),
      syncAttempts: 0,
      createdAt: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.add(queueItem);

      req.onsuccess = () => {
        console.log(`[OfflineQueue] Attendance enqueued successfully (Queue ID: ${req.result})`);
        resolve({ success: true, queueId: req.result, queueItem });
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('[OfflineQueue] Failed to enqueue offline attendance:', err);
    throw err;
  }
}

/**
 * Retrieve all queued offline attendance submissions
 */
export async function getQueuedAttendance() {
  try {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[OfflineQueue] Could not read queue:', err);
    return [];
  }
}

/**
 * Delete a specific queued attendance item by ID
 */
export async function deleteQueuedAttendance(id) {
  try {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);

      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[OfflineQueue] Could not delete item:', id, err);
    return false;
  }
}

/**
 * Flush all queued offline attendance records to the backend /api/v1/attendance/offline-sync
 */
export async function flushOfflineQueue() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    console.log('[OfflineQueue] Device is currently offline. Postponing flush.');
    return { flushed: 0, remaining: (await getQueuedAttendance()).length, offline: true };
  }

  const items = await getQueuedAttendance();
  if (items.length === 0) {
    return { flushed: 0, remaining: 0 };
  }

  console.log(`[OfflineQueue] Flushing ${items.length} offline attendance record(s)...`);
  let flushed = 0;

  for (const item of items) {
    try {
      const payload = {
        student_id: item.studentId,
        studentId: item.studentId,
        roll_number: item.rollNumber,
        rollNumber: item.rollNumber,
        live_photo: item.frameBase64,
        frame_base64: item.frameBase64,
        image_hash: item.imageHash,
        beacon_id: item.beaconId,
        beacon_public_id: item.beaconId,
        slot_30s: item.slot30s,
        hw_signature: item.hwSignature,
        signature: item.hwSignature,
        raw_payload: item.rawPayload
      };

      const syncFn = api.offlineSync || api.attendance?.offlineSync;
      if (typeof syncFn !== 'function') {
        throw new Error('Attendance offlineSync API method is not registered.');
      }
      const res = await syncFn(payload);
      if (res && (res.success || res.status === 'ALREADY_RECORDED' || res.status === 'RECONCILED')) {
        await deleteQueuedAttendance(item.id);
        flushed++;
      } else {
        console.warn(`[OfflineQueue] Item ${item.id} sync returned unhandled response:`, res);
      }
    } catch (err) {
      // 409 Conflict means it was already marked, so safe to delete from local queue
      if (err.status === 409) {
        console.log(`[OfflineQueue] Item ${item.id} already verified on server (409 Conflict). Purging.`);
        await deleteQueuedAttendance(item.id);
        flushed++;
      } else {
        console.error(`[OfflineQueue] Failed to sync item ${item.id}:`, err.message || err);
        // If network error, stop flushing to preserve battery/network and retry later
        break;
      }
    }
  }

  const remaining = (await getQueuedAttendance()).length;
  console.log(`[OfflineQueue] Flush complete. Flushed: ${flushed}, Remaining: ${remaining}`);
  return { flushed, remaining };
}

// Auto-flush queue when network connection is restored
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[OfflineQueue] Network connection restored. Initiating automatic sync...');
    flushOfflineQueue().catch(err => {
      console.warn('[OfflineQueue] Background auto-flush error:', err);
    });
  });
}
