const { v4: uuidv4 } = require('uuid');
const { getQuery, allQuery, runQuery } = require('../db/database');

/**
 * Format 24-hour time "HH:MM" to human-friendly 12-hour "H:MM AM/PM"
 */
function formatTime12h(timeStr) {
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  if (isNaN(h)) return timeStr;
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${period}`;
}

/**
 * Convert "HH:MM" string to minutes from midnight
 */
function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map((v) => parseInt(v, 10));
  return (h || 0) * 60 + (m || 0);
}

/**
 * Get current date (YYYY-MM-DD) and current time (HH:MM) in specified timezone
 */
function getZonedTime(now = new Date(), timezone = 'Asia/Kolkata') {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(now);
    const lookup = {};
    for (const p of parts) {
      lookup[p.type] = p.value;
    }
    const dateStr = `${lookup.year}-${lookup.month}-${lookup.day}`;
    const timeStr = `${lookup.hour}:${lookup.minute}`;
    return { dateStr, timeStr };
  } catch (_) {
    // Fallback to local system time if timezone string is invalid
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().slice(0, 5);
    return { dateStr, timeStr };
  }
}

/**
 * Determine live attendance window status for today
 */
async function getAttendanceWindowStatus(customDate = null, customTime = null) {
  const config = (await getQuery(`SELECT * FROM attendance_schedule_configs WHERE id = 'default_schedule' LIMIT 1`)) || {
    default_start_time: '19:00',
    default_end_time: '19:30',
    is_enabled: 1,
    timezone: 'Asia/Kolkata'
  };

  const tz = config.timezone || 'Asia/Kolkata';
  const now = new Date();
  const zoned = getZonedTime(now, tz);

  const effectiveDate = customDate || zoned.dateStr;
  const effectiveTime = customTime || zoned.timeStr;

  // If time management enforcement is disabled by admin
  if (config.is_enabled !== 1) {
    return {
      enforced: false,
      isOpen: true,
      isHoliday: false,
      date: effectiveDate,
      currentTime: effectiveTime,
      timezone: tz,
      message: 'Attendance time window enforcement is currently disabled by administrator (Open 24/7).'
    };
  }

  // Check for day-specific override (delayed feast, cultural festival, or holiday list item)
  const override = await getQuery(
    `SELECT * FROM attendance_schedule_overrides WHERE override_date = ? LIMIT 1`,
    [effectiveDate]
  );

  if (override && override.is_holiday === 1) {
    return {
      enforced: true,
      isOpen: false,
      isHoliday: true,
      date: effectiveDate,
      currentTime: effectiveTime,
      timezone: tz,
      title: override.title || 'Campus Holiday',
      notes: override.notes || '',
      message: `Today (${effectiveDate}) is marked as a Holiday: "${override.title || 'Exempt'}". Daily attendance is suspended/exempt for today.`
    };
  }

  const startTime = override?.start_time || config.default_start_time || '19:00';
  const endTime = override?.end_time || config.default_end_time || '19:30';
  const isOverride = Boolean(override && (override.start_time || override.end_time));
  const eventTitle = override?.title || (isOverride ? 'Special Schedule' : 'Regular Evening Attendance');

  const curMins = timeToMinutes(effectiveTime);
  const startMins = timeToMinutes(startTime);
  const endMins = timeToMinutes(endTime);

  const start12 = formatTime12h(startTime);
  const end12 = formatTime12h(endTime);

  if (curMins >= startMins && curMins <= endMins) {
    const remaining = endMins - curMins;
    return {
      enforced: true,
      isOpen: true,
      isHoliday: false,
      isOverride,
      title: eventTitle,
      date: effectiveDate,
      currentTime: effectiveTime,
      startTime,
      endTime,
      startTime12: start12,
      endTime12: end12,
      remainingMinutes: remaining,
      timezone: tz,
      notes: override?.notes || '',
      message: `Attendance is OPEN (${start12} – ${end12}). ${remaining} minute${remaining === 1 ? '' : 's'} remaining.`
    };
  }

  if (curMins < startMins) {
    const startsIn = startMins - curMins;
    return {
      enforced: true,
      isOpen: false,
      isHoliday: false,
      isOverride,
      title: eventTitle,
      date: effectiveDate,
      currentTime: effectiveTime,
      startTime,
      endTime,
      startTime12: start12,
      endTime12: end12,
      startsInMinutes: startsIn,
      timezone: tz,
      notes: override?.notes || '',
      message: `Attendance window is currently CLOSED. Attendance opens tonight at ${start12} (${startsIn} min remaining). Scheduled window: ${start12} to ${end12}.`
    };
  }

  // curMins > endMins
  return {
    enforced: true,
    isOpen: false,
    isHoliday: false,
    isOverride,
    title: eventTitle,
    date: effectiveDate,
    currentTime: effectiveTime,
    startTime,
    endTime,
    startTime12: start12,
    endTime12: end12,
    isPastEnd: true,
    timezone: tz,
    notes: override?.notes || '',
    message: `Attendance window closed for today at ${end12}. Regular window is ${start12} to ${end12}.`
  };
}

module.exports = {
  formatTime12h,
  timeToMinutes,
  getZonedTime,
  getAttendanceWindowStatus
};
