/**
 * Attendance Statistics & Hostel Residence Ledger Service
 * 
 * Provides:
 * 1. Month-to-Date (MTD) Clarity: Days passed vs. remaining in month/year.
 * 2. 3-Tier Residence State: Present (In Hostel) vs. Approved Leave (Pass) vs. Unauthorized Defaulter.
 * 3. Consecutive Missed Nights Safety Alerts: Automatic detection of students missing >= 2 consecutive nights.
 */

const { getQuery, allQuery } = require('../db/database');
const { getIstDateString } = require('../utils/istTime');

const isLeapYear = (year) => {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
};

const getDaysInMonth = (year, month) => {
  // month: 1-12
  return new Date(year, month, 0).getDate();
};

const getMonthName = (monthIndex) => {
  // monthIndex: 0-11
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return monthNames[monthIndex] || 'Unknown';
};

const getDayOfYear = (date, year) => {
  const startOfYear = new Date(year, 0, 1);
  const diff = date - startOfYear;
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay) + 1;
};

/**
 * Computes individual student attendance summary:
 * - Month-to-date presence, approved leaves, and unauthorized absences
 * - Annual session presence and active days (excluding holidays)
 * - 12-month historical breakdown (Jan-Dec) with 3-tier state
 * - Consecutive missed nights safety status
 */
const getStudentAttendanceSummary = async (studentId, customYear = null) => {
  const now = new Date();
  const year = customYear ? parseInt(customYear, 10) : now.getFullYear();
  const isCurrentYear = (year === now.getFullYear());
  const currentMonth = now.getMonth() + 1; // 1-12
  const currentMonthIndex = now.getMonth();
  const currentMonthStr = String(currentMonth).padStart(2, '0');
  const daysInCurrentMonth = getDaysInMonth(year, currentMonth);
  const daysInCurrentYear = isLeapYear(year) ? 366 : 365;

  // Month-to-Date (MTD) calculations
  const daysElapsedInMonth = isCurrentYear ? Math.min(now.getDate(), daysInCurrentMonth) : daysInCurrentMonth;
  const daysRemainingInMonth = Math.max(0, daysInCurrentMonth - daysElapsedInMonth);

  const dayOfYear = isCurrentYear ? Math.min(getDayOfYear(now, year), daysInCurrentYear) : daysInCurrentYear;
  const daysRemainingInYear = Math.max(0, daysInCurrentYear - dayOfYear);

  const currentMonthPrefix = `${year}-${currentMonthStr}`;
  const currentYearPrefix = `${year}-`;

  // 1. Current Month Counts (3-Tier: Present vs Approved Leave vs Absent)
  const monthlyPresentRow = await getQuery(`
    SELECT COUNT(*) as count FROM attendance_records 
    WHERE student_id = ? AND date LIKE ? AND status IN ('PRESENT', 'LATE')
  `, [studentId, `${currentMonthPrefix}%`]);

  const monthlyLeaveRow = await getQuery(`
    SELECT COUNT(*) as count FROM attendance_records 
    WHERE student_id = ? AND date LIKE ? AND status = 'EXCUSED'
  `, [studentId, `${currentMonthPrefix}%`]);

  const monthlyAbsentRow = await getQuery(`
    SELECT COUNT(*) as count FROM attendance_records 
    WHERE student_id = ? AND date LIKE ? AND status = 'ABSENT'
  `, [studentId, `${currentMonthPrefix}%`]);

  // Holidays in Current Month
  const monthlyHolidaysRow = await getQuery(`
    SELECT COUNT(*) as count FROM attendance_schedule_overrides 
    WHERE is_holiday = 1 AND override_date LIKE ?
  `, [`${currentMonthPrefix}%`]);

  const monthlyPresent = monthlyPresentRow?.count || 0;
  const monthlyLeave = monthlyLeaveRow?.count || 0;
  const monthlyAbsent = monthlyAbsentRow?.count || 0;
  const monthlyHolidays = monthlyHolidaysRow?.count || 0;
  const monthlyActiveDays = Math.max(0, daysInCurrentMonth - monthlyHolidays);

  // 2. Current Year Counts (3-Tier)
  const yearlyPresentRow = await getQuery(`
    SELECT COUNT(*) as count FROM attendance_records 
    WHERE student_id = ? AND date LIKE ? AND status IN ('PRESENT', 'LATE')
  `, [studentId, `${currentYearPrefix}%`]);

  const yearlyLeaveRow = await getQuery(`
    SELECT COUNT(*) as count FROM attendance_records 
    WHERE student_id = ? AND date LIKE ? AND status = 'EXCUSED'
  `, [studentId, `${currentYearPrefix}%`]);

  const yearlyAbsentRow = await getQuery(`
    SELECT COUNT(*) as count FROM attendance_records 
    WHERE student_id = ? AND date LIKE ? AND status = 'ABSENT'
  `, [studentId, `${currentYearPrefix}%`]);

  // Holidays in Current Year (excluded from active total)
  const yearlyHolidaysRow = await getQuery(`
    SELECT COUNT(*) as count FROM attendance_schedule_overrides 
    WHERE is_holiday = 1 AND override_date LIKE ?
  `, [`${currentYearPrefix}%`]);

  const yearlyPresent = yearlyPresentRow?.count || 0;
  const yearlyLeave = yearlyLeaveRow?.count || 0;
  const yearlyAbsent = yearlyAbsentRow?.count || 0;
  const yearlyHolidays = yearlyHolidaysRow?.count || 0;
  const yearlyActiveDays = Math.max(0, daysInCurrentYear - yearlyHolidays);

  // 3. Lifetime Totals
  const totalPresentRow = await getQuery(`
    SELECT COUNT(*) as count FROM attendance_records 
    WHERE student_id = ? AND status IN ('PRESENT', 'LATE')
  `, [studentId]);

  const totalLeaveRow = await getQuery(`
    SELECT COUNT(*) as count FROM attendance_records 
    WHERE student_id = ? AND status = 'EXCUSED'
  `, [studentId]);

  const totalAbsentRow = await getQuery(`
    SELECT COUNT(*) as count FROM attendance_records 
    WHERE student_id = ? AND status = 'ABSENT'
  `, [studentId]);

  const totalPresent = totalPresentRow?.count || 0;
  const totalLeave = totalLeaveRow?.count || 0;
  const totalAbsent = totalAbsentRow?.count || 0;

  // 4. Monthly Breakdown for the entire year (3-Tier: Present, Leave, Absent)
  const monthlyRecords = await allQuery(`
    SELECT 
      substr(date, 1, 7) as month_key,
      SUM(CASE WHEN status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END) as present_count,
      SUM(CASE WHEN status = 'EXCUSED' THEN 1 ELSE 0 END) as leave_count,
      SUM(CASE WHEN status = 'ABSENT' THEN 1 ELSE 0 END) as absent_count
    FROM attendance_records
    WHERE student_id = ? AND date LIKE ?
    GROUP BY substr(date, 1, 7)
  `, [studentId, `${currentYearPrefix}%`]);

  const monthlyHolidaysList = await allQuery(`
    SELECT 
      substr(override_date, 1, 7) as month_key,
      COUNT(*) as holiday_count
    FROM attendance_schedule_overrides
    WHERE is_holiday = 1 AND override_date LIKE ?
    GROUP BY substr(override_date, 1, 7)
  `, [`${currentYearPrefix}%`]);

  const recordsMap = {};
  for (const r of (monthlyRecords || [])) {
    recordsMap[r.month_key] = r;
  }
  const holidaysMap = {};
  for (const h of (monthlyHolidaysList || [])) {
    holidaysMap[h.month_key] = h.holiday_count;
  }

  const monthlyBreakdown = [];
  const maxMonth = isCurrentYear ? currentMonth : 12;
  for (let m = 1; m <= maxMonth; m++) {
    const mStr = String(m).padStart(2, '0');
    const monthKey = `${year}-${mStr}`;
    const daysInM = getDaysInMonth(year, m);
    const holidaysInM = holidaysMap[monthKey] || 0;
    const activeDaysInM = Math.max(0, daysInM - holidaysInM);
    const rec = recordsMap[monthKey] || { present_count: 0, leave_count: 0, absent_count: 0 };
    const pCount = rec.present_count || 0;
    const lCount = rec.leave_count || 0;
    const aCount = rec.absent_count || 0;

    const isCurrentM = isCurrentYear && (m === currentMonth);
    const daysElapsedM = isCurrentM ? Math.min(now.getDate(), daysInM) : daysInM;
    const daysRemainingM = Math.max(0, daysInM - daysElapsedM);

    monthlyBreakdown.push({
      month: monthKey,
      monthName: `${getMonthName(m - 1)} ${year}`,
      monthShort: getMonthName(m - 1).slice(0, 3),
      daysInMonth: daysInM,
      daysElapsed: daysElapsedM,
      daysRemaining: daysRemainingM,
      holidaysExcluded: holidaysInM,
      activeDays: activeDaysInM,
      daysPresent: pCount,
      daysLeave: lCount,
      daysAbsent: aCount,
      isOnTrack: aCount === 0,
      mtdText: isCurrentM ? `${pCount} of ${daysElapsedM} days passed (${daysRemainingM} days remaining)` : `${pCount} / ${daysInM} days`,
      ratio: `${pCount} / ${daysInM} Days Present`,
      activeRatio: `${pCount} / ${activeDaysInM} Active Days`,
      statusSummary: `${pCount} Present · ${lCount} Leave · ${aCount} Absent`
    });
  }

  monthlyBreakdown.reverse();

  // 5. Consecutive Missed Nights Safety Check for this student
  const student = await getQuery(`SELECT created_at FROM students WHERE id = ?`, [studentId]);
  const createdDate = student?.created_at ? student.created_at.split(' ')[0] : '2020-01-01';

  const past14Days = [];
  for (let i = 1; i <= 14; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    past14Days.push(getIstDateString(d));
  }

  const holidays14 = await allQuery(
    `SELECT override_date FROM attendance_schedule_overrides WHERE is_holiday = 1 AND override_date IN (${past14Days.map(() => '?').join(',')})`,
    past14Days
  );
  const holidaySet14 = new Set((holidays14 || []).map(h => h.override_date));

  const recent14Records = await allQuery(
    `SELECT date, status FROM attendance_records WHERE student_id = ? AND date IN (${past14Days.map(() => '?').join(',')})`,
    [studentId, ...past14Days]
  );
  const recent14Map = new Map();
  for (const r of (recent14Records || [])) {
    recent14Map.set(r.date, r.status);
  }

  let consecutiveMissedNights = 0;
  for (const dStr of past14Days) {
    if (dStr < createdDate) break;
    if (holidaySet14.has(dStr)) continue;

    const st = recent14Map.get(dStr);
    if (st === 'PRESENT' || st === 'LATE' || st === 'EXCUSED') {
      break;
    } else {
      consecutiveMissedNights++;
    }
  }

  return {
    currentMonth: {
      monthKey: currentMonthPrefix,
      monthName: `${getMonthName(currentMonthIndex)} ${year}`,
      monthShort: getMonthName(currentMonthIndex).slice(0, 3),
      daysInMonth: daysInCurrentMonth,
      daysElapsed: daysElapsedInMonth,
      daysRemaining: daysRemainingInMonth,
      holidaysExcluded: monthlyHolidays,
      activeDays: monthlyActiveDays,
      daysPresent: monthlyPresent,
      daysLeave: monthlyLeave,
      daysAbsent: monthlyAbsent,
      isOnTrack: monthlyAbsent === 0,
      mtdText: `${monthlyPresent} of ${daysElapsedInMonth} days passed (${daysRemainingInMonth} days remaining in ${getMonthName(currentMonthIndex).slice(0, 3)})`,
      ratio: `${monthlyPresent} / ${daysInCurrentMonth} Days`,
      activeRatio: `${monthlyPresent} / ${monthlyActiveDays} Active Days`
    },
    yearlySummary: {
      year,
      daysInYear: daysInCurrentYear,
      dayOfYear,
      daysRemainingInYear,
      holidaysExcluded: yearlyHolidays,
      activeDays: yearlyActiveDays,
      daysPresent: yearlyPresent,
      daysLeave: yearlyLeave,
      daysAbsent: yearlyAbsent,
      ratio: `${yearlyPresent} / ${yearlyActiveDays} Active Days`,
      subtext: `Day ${dayOfYear} of ${daysInCurrentYear} (Session ${year}) · ${yearlyHolidays} holidays excl.`
    },
    lifetime: {
      totalPresent,
      totalLeave,
      totalAbsent,
      totalRecorded: totalPresent + totalLeave + totalAbsent
    },
    safetyAlert: {
      consecutiveMissedNights,
      isSafetyAlert: consecutiveMissedNights >= 2
    },
    monthlyBreakdown
  };
};

/**
 * Computes consecutive absence safety alerts across all active students:
 * Detects students missing >= 2 consecutive active nights without approved leave.
 */
const getConsecutiveAbsenceAlerts = async () => {
  const now = new Date();
  const past14Days = [];
  for (let i = 1; i <= 14; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    past14Days.push(getIstDateString(d));
  }

  const holidays = await allQuery(
    `SELECT override_date FROM attendance_schedule_overrides WHERE is_holiday = 1 AND override_date IN (${past14Days.map(() => '?').join(',')})`,
    past14Days
  );
  const holidaySet = new Set((holidays || []).map(h => h.override_date));

  const allRecords = await allQuery(
    `SELECT student_id, date, status FROM attendance_records WHERE date IN (${past14Days.map(() => '?').join(',')})`,
    past14Days
  );

  const studentRecordMap = new Map();
  for (const r of (allRecords || [])) {
    if (!studentRecordMap.has(r.student_id)) {
      studentRecordMap.set(r.student_id, new Map());
    }
    studentRecordMap.get(r.student_id).set(r.date, r.status);
  }

  const students = await allQuery(`
    SELECT id, roll_number, full_name, hostel_block, room_number, course, phone, created_at 
    FROM students 
    WHERE is_active = 1
    ORDER BY hostel_block, room_number, roll_number
  `);

  const alerts = [];
  for (const s of (students || [])) {
    const recMap = studentRecordMap.get(s.id);
    const createdDate = s.created_at ? s.created_at.split(' ')[0] : '2020-01-01';
    let streak = 0;
    let lastSeenDate = null;

    for (const dStr of past14Days) {
      if (dStr < createdDate) break;
      if (holidaySet.has(dStr)) continue;

      const st = recMap ? recMap.get(dStr) : null;
      if (st === 'PRESENT' || st === 'LATE' || st === 'EXCUSED') {
        if (!lastSeenDate) lastSeenDate = dStr;
        break;
      } else {
        streak++;
      }
    }

    if (streak >= 2) {
      alerts.push({
        student_id: s.id,
        roll_number: s.roll_number,
        full_name: s.full_name,
        hostel_block: s.hostel_block,
        room_number: s.room_number,
        course: s.course,
        phone: s.phone,
        consecutive_nights_missed: streak,
        last_seen_date: lastSeenDate,
        alert_level: streak >= 3 ? 'CRITICAL' : 'WARNING'
      });
    }
  }

  alerts.sort((a, b) => b.consecutive_nights_missed - a.consecutive_nights_missed);
  return alerts;
};

/**
 * Computes hostel-wide attendance ledger across all students for a specific month and year
 * (for Admin and Warden supervision). Includes 3-tier metrics, MTD progress, and safety alerts.
 */
const getAllStudentsAttendanceSummary = async (customYear = null, customMonth = null) => {
  const now = new Date();
  const year = customYear ? parseInt(customYear, 10) : now.getFullYear();
  const month = customMonth ? parseInt(customMonth, 10) : now.getMonth() + 1;
  const isCurrentYear = (year === now.getFullYear());
  const isCurrentMonth = isCurrentYear && (month === now.getMonth() + 1);

  const monthStr = String(month).padStart(2, '0');
  const daysInMonth = getDaysInMonth(year, month);
  const daysInYear = isLeapYear(year) ? 366 : 365;

  const daysElapsedInMonth = isCurrentMonth ? Math.min(now.getDate(), daysInMonth) : daysInMonth;
  const daysRemainingInMonth = Math.max(0, daysInMonth - daysElapsedInMonth);

  const monthPrefix = `${year}-${monthStr}`;
  const yearPrefix = `${year}-`;

  const monthlyHolidaysRow = await getQuery(`
    SELECT COUNT(*) as count FROM attendance_schedule_overrides 
    WHERE is_holiday = 1 AND override_date LIKE ?
  `, [`${monthPrefix}%`]);

  const yearlyHolidaysRow = await getQuery(`
    SELECT COUNT(*) as count FROM attendance_schedule_overrides 
    WHERE is_holiday = 1 AND override_date LIKE ?
  `, [`${yearPrefix}%`]);

  const monthlyHolidays = monthlyHolidaysRow?.count || 0;
  const yearlyHolidays = yearlyHolidaysRow?.count || 0;
  const monthlyActiveDays = Math.max(0, daysInMonth - monthlyHolidays);
  const yearlyActiveDays = Math.max(0, daysInYear - yearlyHolidays);

  // 3-Tier aggregation: Present vs Approved Leave vs Absent
  const students = await allQuery(`
    SELECT 
      s.id,
      s.roll_number,
      s.full_name,
      s.hostel_block,
      s.room_number,
      s.course,
      s.phone,
      s.created_at,
      COALESCE(m.monthly_present, 0) as monthly_present,
      COALESCE(m.monthly_leave, 0) as monthly_leave,
      COALESCE(m.monthly_absent, 0) as monthly_absent,
      COALESCE(y.yearly_present, 0) as yearly_present,
      COALESCE(y.yearly_leave, 0) as yearly_leave,
      COALESCE(y.yearly_absent, 0) as yearly_absent
    FROM students s
    LEFT JOIN (
      SELECT 
        student_id,
        SUM(CASE WHEN status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END) as monthly_present,
        SUM(CASE WHEN status = 'EXCUSED' THEN 1 ELSE 0 END) as monthly_leave,
        SUM(CASE WHEN status = 'ABSENT' THEN 1 ELSE 0 END) as monthly_absent
      FROM attendance_records
      WHERE date LIKE ?
      GROUP BY student_id
    ) m ON s.id = m.student_id
    LEFT JOIN (
      SELECT 
        student_id,
        SUM(CASE WHEN status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END) as yearly_present,
        SUM(CASE WHEN status = 'EXCUSED' THEN 1 ELSE 0 END) as yearly_leave,
        SUM(CASE WHEN status = 'ABSENT' THEN 1 ELSE 0 END) as yearly_absent
      FROM attendance_records
      WHERE date LIKE ?
      GROUP BY student_id
    ) y ON s.id = y.student_id
    WHERE s.is_active = 1
    ORDER BY s.hostel_block ASC, s.room_number ASC, s.roll_number ASC
  `, [`${monthPrefix}%`, `${yearPrefix}%`]);

  // Compute consecutive absence alerts
  const safetyAlerts = await getConsecutiveAbsenceAlerts();
  const alertMap = new Map();
  for (const a of safetyAlerts) {
    alertMap.set(a.student_id, a);
  }

  const enrichedStudents = (students || []).map(st => {
    const alert = alertMap.get(st.id);
    return {
      ...st,
      consecutive_absent_nights: alert ? alert.consecutive_nights_missed : 0,
      is_safety_alert: Boolean(alert),
      safety_alert_level: alert ? alert.alert_level : null,
      monthlyRatio: `${st.monthly_present} / ${daysInMonth} Days`,
      monthlyActiveRatio: `${st.monthly_present} / ${monthlyActiveDays} Active Days`,
      yearlyRatio: `${st.yearly_present} / ${yearlyActiveDays} Active Days`
    };
  });

  return {
    year,
    month,
    monthName: `${getMonthName(month - 1)} ${year}`,
    monthShort: getMonthName(month - 1).slice(0, 3),
    daysInMonth,
    daysElapsed: daysElapsedInMonth,
    daysRemaining: daysRemainingInMonth,
    isCurrentMonth,
    monthlyHolidays,
    monthlyActiveDays,
    daysInYear,
    yearlyHolidays,
    yearlyActiveDays,
    safetyAlerts,
    safetyAlertCount: safetyAlerts.length,
    students: enrichedStudents
  };
};

module.exports = {
  getDaysInMonth,
  getMonthName,
  isLeapYear,
  getStudentAttendanceSummary,
  getConsecutiveAbsenceAlerts,
  getAllStudentsAttendanceSummary
};
