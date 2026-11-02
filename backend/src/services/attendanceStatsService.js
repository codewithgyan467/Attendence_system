/**
 * Attendance Statistics & Hostel Presence Ledger Service
 * 
 * Provides month-by-month and annual day-count attendance summaries
 * (strictly day counts: Days Present, Days Absent, Active Days excluding Holidays;
 * eliminates course-percentage misconceptions in residential hostels).
 */

const { getQuery, allQuery } = require('../db/database');

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

/**
 * Computes individual student attendance summary:
 * - Current month presence / absence out of total days in month
 * - Annual session presence out of total year days (excluding official holidays)
 * - Lifetime present & absent days
 * - 12-month historical breakdown
 */
const getStudentAttendanceSummary = async (studentId, customYear = null) => {
  const now = new Date();
  const year = customYear ? parseInt(customYear, 10) : now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12
  const currentMonthIndex = now.getMonth();
  const currentMonthStr = String(currentMonth).padStart(2, '0');
  const daysInCurrentMonth = getDaysInMonth(year, currentMonth);
  const daysInCurrentYear = isLeapYear(year) ? 366 : 365;

  const currentMonthPrefix = `${year}-${currentMonthStr}`;
  const currentYearPrefix = `${year}-`;

  // 1. Current Month Stats for Student
  const monthlyPresentRow = await getQuery(`
    SELECT COUNT(*) as count FROM attendance_records 
    WHERE student_id = ? AND date LIKE ? AND status IN ('PRESENT', 'EXCUSED')
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
  const monthlyAbsent = monthlyAbsentRow?.count || 0;
  const monthlyHolidays = monthlyHolidaysRow?.count || 0;
  const monthlyActiveDays = Math.max(0, daysInCurrentMonth - monthlyHolidays);

  // 2. Current Year Stats for Student
  const yearlyPresentRow = await getQuery(`
    SELECT COUNT(*) as count FROM attendance_records 
    WHERE student_id = ? AND date LIKE ? AND status IN ('PRESENT', 'EXCUSED')
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
  const yearlyAbsent = yearlyAbsentRow?.count || 0;
  const yearlyHolidays = yearlyHolidaysRow?.count || 0;
  const yearlyActiveDays = Math.max(0, daysInCurrentYear - yearlyHolidays);

  // 3. Lifetime Totals
  const totalPresentRow = await getQuery(`
    SELECT COUNT(*) as count FROM attendance_records 
    WHERE student_id = ? AND status IN ('PRESENT', 'EXCUSED')
  `, [studentId]);

  const totalAbsentRow = await getQuery(`
    SELECT COUNT(*) as count FROM attendance_records 
    WHERE student_id = ? AND status = 'ABSENT'
  `, [studentId]);

  const totalPresent = totalPresentRow?.count || 0;
  const totalAbsent = totalAbsentRow?.count || 0;

  // 4. Monthly Breakdown for the entire year
  const monthlyRecords = await allQuery(`
    SELECT 
      substr(date, 1, 7) as month_key,
      SUM(CASE WHEN status IN ('PRESENT', 'EXCUSED') THEN 1 ELSE 0 END) as present_count,
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
  const maxMonth = (year === now.getFullYear()) ? currentMonth : 12;
  for (let m = 1; m <= maxMonth; m++) {
    const mStr = String(m).padStart(2, '0');
    const monthKey = `${year}-${mStr}`;
    const daysInM = getDaysInMonth(year, m);
    const holidaysInM = holidaysMap[monthKey] || 0;
    const activeDaysInM = Math.max(0, daysInM - holidaysInM);
    const rec = recordsMap[monthKey] || { present_count: 0, absent_count: 0 };
    const pCount = rec.present_count || 0;
    const aCount = rec.absent_count || 0;

    monthlyBreakdown.push({
      month: monthKey,
      monthName: `${getMonthName(m - 1)} ${year}`,
      monthShort: getMonthName(m - 1).slice(0, 3),
      daysInMonth: daysInM,
      holidaysExcluded: holidaysInM,
      activeDays: activeDaysInM,
      daysPresent: pCount,
      daysAbsent: aCount,
      ratio: `${pCount} / ${daysInM} Days Present`,
      activeRatio: `${pCount} / ${activeDaysInM} Active Days`
    });
  }

  monthlyBreakdown.reverse();

  return {
    currentMonth: {
      monthKey: currentMonthPrefix,
      monthName: `${getMonthName(currentMonthIndex)} ${year}`,
      daysInMonth: daysInCurrentMonth,
      holidaysExcluded: monthlyHolidays,
      activeDays: monthlyActiveDays,
      daysPresent: monthlyPresent,
      daysAbsent: monthlyAbsent,
      ratio: `${monthlyPresent} / ${daysInCurrentMonth} Days`,
      activeRatio: `${monthlyPresent} / ${monthlyActiveDays} Active Days`
    },
    yearlySummary: {
      year,
      daysInYear: daysInCurrentYear,
      holidaysExcluded: yearlyHolidays,
      activeDays: yearlyActiveDays,
      daysPresent: yearlyPresent,
      daysAbsent: yearlyAbsent,
      ratio: `${yearlyPresent} / ${yearlyActiveDays} Active Days`,
      subtext: `Year ${year} (${yearlyHolidays} holidays excluded)`
    },
    lifetime: {
      totalPresent,
      totalAbsent,
      totalRecorded: totalPresent + totalAbsent
    },
    monthlyBreakdown
  };
};

/**
 * Computes hostel-wide attendance ledger across all students for a specific month and year
 * (for Admin and Warden supervision).
 */
const getAllStudentsAttendanceSummary = async (customYear = null, customMonth = null) => {
  const now = new Date();
  const year = customYear ? parseInt(customYear, 10) : now.getFullYear();
  const month = customMonth ? parseInt(customMonth, 10) : now.getMonth() + 1;
  const monthStr = String(month).padStart(2, '0');
  const daysInMonth = getDaysInMonth(year, month);
  const daysInYear = isLeapYear(year) ? 366 : 365;

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

  const students = await allQuery(`
    SELECT 
      s.id,
      s.roll_number,
      s.full_name,
      s.hostel_block,
      s.room_number,
      s.course,
      s.phone,
      COALESCE(m.monthly_present, 0) as monthly_present,
      COALESCE(m.monthly_absent, 0) as monthly_absent,
      COALESCE(y.yearly_present, 0) as yearly_present,
      COALESCE(y.yearly_absent, 0) as yearly_absent
    FROM students s
    LEFT JOIN (
      SELECT 
        student_id,
        SUM(CASE WHEN status IN ('PRESENT', 'EXCUSED') THEN 1 ELSE 0 END) as monthly_present,
        SUM(CASE WHEN status = 'ABSENT' THEN 1 ELSE 0 END) as monthly_absent
      FROM attendance_records
      WHERE date LIKE ?
      GROUP BY student_id
    ) m ON s.id = m.student_id
    LEFT JOIN (
      SELECT 
        student_id,
        SUM(CASE WHEN status IN ('PRESENT', 'EXCUSED') THEN 1 ELSE 0 END) as yearly_present,
        SUM(CASE WHEN status = 'ABSENT' THEN 1 ELSE 0 END) as yearly_absent
      FROM attendance_records
      WHERE date LIKE ?
      GROUP BY student_id
    ) y ON s.id = y.student_id
    WHERE s.is_active = 1
    ORDER BY s.hostel_block ASC, s.room_number ASC, s.roll_number ASC
  `, [`${monthPrefix}%`, `${yearPrefix}%`]);

  return {
    year,
    month,
    monthName: `${getMonthName(month - 1)} ${year}`,
    daysInMonth,
    monthlyHolidays,
    monthlyActiveDays,
    daysInYear,
    yearlyHolidays,
    yearlyActiveDays,
    students: (students || []).map(st => ({
      ...st,
      monthlyRatio: `${st.monthly_present} / ${daysInMonth} Days`,
      yearlyRatio: `${st.yearly_present} / ${yearlyActiveDays} Active Days`
    }))
  };
};

module.exports = {
  getDaysInMonth,
  getMonthName,
  isLeapYear,
  getStudentAttendanceSummary,
  getAllStudentsAttendanceSummary
};
