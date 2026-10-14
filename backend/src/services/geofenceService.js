/**
 * 100% Free & Open-Source Geofencing Engine using the Haversine Formula.
 * Pure mathematical calculation with Zero external Google Maps API requests.
 */

const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Calculates distance in meters between two GPS coordinates using the Haversine formula.
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const distanceMeters = EARTH_RADIUS_METERS * c;
  return Math.round(distanceMeters * 100) / 100; // 2 decimal precision
}

/**
 * Validates whether client device is properly within the permitted geofence radius.
 */
function validateLocation({
  deviceLat,
  deviceLon,
  accuracy = 10,
  isMockLocation = false,
  hostelLat,
  hostelLon,
  permittedRadiusMeters = 20.0,
  maxAccuracyMeters = 65.0
}) {
  // 1. Device Mock Location Check
  const mockDetected = Boolean(isMockLocation === true || isMockLocation === 'true' || isMockLocation === 1);
  if (mockDetected) {
    return {
      isValid: false,
      isMockLocationDetected: true,
      reason: 'MOCK_LOCATION_ACTIVE',
      message: 'Mock location app / GPS spoofer detected on device. Real hardware GPS required.',
      distanceMeters: null,
      permittedRadiusMeters
    };
  }

  // 2. Accuracy threshold check (allow realistic indoor hostel tolerance, default 65m)
  const allowedCoarseLimit = Math.max(maxAccuracyMeters, permittedRadiusMeters * 1.5);
  if (accuracy > allowedCoarseLimit) {
    return {
      isValid: false,
      isMockLocationDetected: false,
      reason: 'POOR_GPS_ACCURACY',
      message: `GPS signal accuracy too coarse (${Math.round(accuracy)}m > limit ${Math.round(allowedCoarseLimit)}m). Please step near a window or enable high-accuracy mode.`,
      distanceMeters: null,
      permittedRadiusMeters
    };
  }

  // 3. Haversine distance calculation
  const distance = calculateHaversineDistance(deviceLat, deviceLon, hostelLat, hostelLon);

  const isWithinRadius = distance <= permittedRadiusMeters;

  return {
    isValid: isWithinRadius,
    isMockLocationDetected: false,
    distanceMeters: distance,
    permittedRadiusMeters,
    reason: isWithinRadius ? 'WITHIN_GEOFENCE' : 'OUTSIDE_GEOFENCE',
    message: isWithinRadius
      ? `Proper location verified (${distance}m from hostel center, limit is ${permittedRadiusMeters}m).`
      : `Location rejected: You are ${distance}m away from the hostel. Permitted boundary is ${permittedRadiusMeters}m.`
  };
}

module.exports = {
  calculateHaversineDistance,
  calculateDistanceMeters: calculateHaversineDistance,
  validateLocation
};
