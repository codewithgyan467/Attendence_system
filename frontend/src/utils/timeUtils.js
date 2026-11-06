/**
 * HostelGuard Standard Indian Standard Time (IST, UTC+05:30) & 12-Hour (AM/PM) Utilities
 * Enforces uniform 12-hour time representation across the entire platform
 */

export const IST_TIMEZONE = 'Asia/Kolkata';

/**
 * Formats any timestamp, time string, or ISO date into 12-hour IST time with AM/PM
 * Example outputs: "08:30:15 PM", "09:15 AM"
 */
export function formatTime12h(timeVal, includeSeconds = true) {
  if (!timeVal) return '—';
  const str = String(timeVal).trim();

  // If already formatted with AM/PM (e.g., "08:30:15 PM"), ensure clean formatting
  if (/\b(AM|PM)\b/i.test(str)) {
    return str.toUpperCase();
  }

  // Handle ISO string or date string (e.g. "2026-11-06T14:30:00Z" or "2026-11-06 14:30:00")
  if (str.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(str)) {
    let parseStr = str;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(str) && !str.includes('Z') && !str.includes('+')) {
      parseStr = str.replace(' ', 'T') + 'Z';
    }
    const d = new Date(parseStr);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('en-US', {
        timeZone: IST_TIMEZONE,
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
        ...(includeSeconds ? { second: '2-digit' } : {})
      });
    }
  }

  // Handle "HH:MM" or "HH:MM:SS" (24-hour time string)
  const parts = str.split(':');
  if (parts.length >= 2) {
    let h = parseInt(parts[0], 10);
    const m = parts[1].slice(0, 2);
    const s = parts[2] ? parts[2].slice(0, 2) : null;
    if (!isNaN(h)) {
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      const hh = h < 10 ? `0${h}` : `${h}`;
      return includeSeconds && s ? `${hh}:${m}:${s} ${ampm}` : `${hh}:${m} ${ampm}`;
    }
  }

  return str;
}

/**
 * Formats any datetime to full IST 12-hour format: "Nov 6, 2026, 08:30:15 PM"
 */
export function formatDateTime12h(dateVal, includeSeconds = true) {
  if (!dateVal) return '—';
  const str = String(dateVal).trim();

  let parseStr = str;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(str) && !str.includes('Z') && !str.includes('+')) {
    parseStr = str.replace(' ', 'T') + 'Z';
  }
  const d = new Date(parseStr);
  if (isNaN(d.getTime())) return str;

  return d.toLocaleString('en-US', {
    timeZone: IST_TIMEZONE,
    hour12: true,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' } : {})
  });
}

/**
 * Returns current date in IST as YYYY-MM-DD
 */
export function getTodayDateIST() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

/**
 * Returns current time in IST in 12-hour format (e.g. "08:30:15 PM")
 */
export function getCurrentTimeIST12h(includeSeconds = true) {
  return new Date().toLocaleTimeString('en-US', {
    timeZone: IST_TIMEZONE,
    hour12: true,
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' } : {})
  });
}

/**
 * Formats a date as "Friday, Nov 6, 2026" in IST
 */
export function formatDateIST(dateVal) {
  if (!dateVal) return '';
  const str = String(dateVal).trim();
  const d = new Date(str.includes('T') ? str : `${str}T00:00:00Z`);
  const valid = isNaN(d.getTime()) ? new Date(dateVal) : d;
  if (isNaN(valid.getTime())) return String(dateVal);
  return valid.toLocaleDateString('en-US', {
    timeZone: IST_TIMEZONE,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

