const { runQuery, getQuery } = require('../db/database');
const { v4: uuidv4 } = require('uuid');

const MAX_FAILED_ATTEMPTS = 3;

/**
 * Handles consecutive failed location attempts, flags student if 3 attempts reached,
 * and records security audit trail.
 */
async function recordFailedLocationAttempt(studentId, rollNumber, calculatedDistance, incidentType = 'OUTSIDE_GEOFENCE', details = '') {
  // 1. Fetch current student record
  const student = await getQuery(`SELECT * FROM students WHERE id = ? OR roll_number = ?`, [studentId, rollNumber]);
  if (!student) {
    return { flagged: false, currentFailedAttempts: 0 };
  }

  const newFailedCount = (student.failed_attempts || 0) + 1;
  const isNowFlagged = newFailedCount >= MAX_FAILED_ATTEMPTS;

  // 2. Update student state
  await runQuery(`
    UPDATE students
    SET failed_attempts = ?, is_flagged_forge = ?
    WHERE id = ?
  `, [newFailedCount, isNowFlagged ? 1 : student.is_flagged_forge, student.id]);

  // 3. Log security incident
  const logId = uuidv4();
  await runQuery(`
    INSERT INTO security_audit_logs (id, student_id, roll_number, incident_type, calculated_distance, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    logId,
    student.id,
    student.roll_number,
    isNowFlagged ? 'FORGE_LOCATION_FLAGGED' : incidentType,
    calculatedDistance,
    details || `Failed location check #${newFailedCount}/${MAX_FAILED_ATTEMPTS}. Distance: ${calculatedDistance}m`
  ]);

  return {
    studentId: student.id,
    rollNumber: student.roll_number,
    studentName: student.full_name,
    failedAttempts: newFailedCount,
    isFlaggedForge: isNowFlagged,
    alertTriggered: isNowFlagged
  };
}

/**
 * Resets the failed attempts counter when a student successfully passes geofence check.
 */
async function resetFailedLocationAttempt(studentId) {
  await runQuery(`
    UPDATE students
    SET failed_attempts = 0
    WHERE id = ? OR roll_number = ?
  `, [studentId, studentId]);
}

/**
 * Allows admin to manually clear a student's flagged forge status after investigation.
 */
async function clearForgeFlag(identifier) {
  const result = await runQuery(`
    UPDATE students
    SET failed_attempts = 0, is_flagged_forge = 0
    WHERE roll_number = ? OR id = ?
  `, [identifier, identifier]);

  return result.changes > 0;
}

module.exports = {
  recordFailedLocationAttempt,
  resetFailedLocationAttempt,
  clearForgeFlag,
  MAX_FAILED_ATTEMPTS
};
