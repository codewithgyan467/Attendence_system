/**
 * Indian Standard Time (IST, UTC+05:30) & 12-Hour (AM/PM) Utilities for HostelGuard Backend
 */

const TIMEZONE = 'Asia/Kolkata';

/**
 * Returns time formatted in 12-hour IST format (e.g. "08:30:15 PM")
 */
function getIstTime12h(date = new Date()) {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  const valid = isNaN(d.getTime()) ? new Date() : d;
  return valid.toLocaleTimeString('en-US', {
    timeZone: TIMEZONE,
    hour12: true,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * Returns current date formatted as YYYY-MM-DD in IST
 */
function getIstDateString(date = new Date()) {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  const valid = isNaN(d.getTime()) ? new Date() : d;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(valid);
}

/**
 * Returns full date and time string in IST (e.g. "Nov 6, 2026, 08:30:15 PM")
 */
function getIstFullDateTime12h(date = new Date()) {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  const valid = isNaN(d.getTime()) ? new Date() : d;
  return valid.toLocaleString('en-US', {
    timeZone: TIMEZONE,
    hour12: true,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * Normalizes any time string (e.g. "20:30", "14:15:00", "08:30 PM", ISO string) to 12-hour AM/PM format
 */
function formatTime12h(timeVal) {
  if (!timeVal) return '';
  const str = String(timeVal).trim();

  // Already 12-hour AM/PM
  if (/\b(AM|PM)\b/i.test(str)) {
    return str.toUpperCase();
  }

  // ISO string
  if (str.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(str)) {
    let parseStr = str;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(str) && !str.includes('Z') && !str.includes('+')) {
      parseStr = str.replace(' ', 'T') + 'Z';
    }
    const d = new Date(parseStr);
    if (!isNaN(d.getTime())) {
      return getIstTime12h(d);
    }
  }

  // HH:MM or HH:MM:SS
  const parts = str.split(':');
  if (parts.length >= 2) {
    let h = parseInt(parts[0], 10);
    const m = parts[1].slice(0, 2);
    const s = parts[2] ? parts[2].slice(0, 2) : null;
    if (!isNaN(h)) {
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      const hh = h < 10 ? `0${h}` : `${h}`;
      return s ? `${hh}:${m}:${s} ${ampm}` : `${hh}:${m} ${ampm}`;
    }
  }

  return str;
}

module.exports = {
  TIMEZONE,
  getIstTime12h,
  getIstDateString,
  getIstFullDateTime12h,
  formatTime12h
};

