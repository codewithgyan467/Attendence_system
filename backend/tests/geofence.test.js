const { calculateDistanceMeters, validateLocation } = require('../src/services/geofenceService');

describe('Geofence & Haversine Math Verification', () => {
  const HOSTEL_LAT = 28.535512;
  const HOSTEL_LON = 77.391028;
  const RADIUS_METERS = 20.0;

  test('Haversine distance is 0 meters at identical coordinates', () => {
    const dist = calculateDistanceMeters(HOSTEL_LAT, HOSTEL_LON, HOSTEL_LAT, HOSTEL_LON);
    expect(dist).toBeCloseTo(0, 1);
  });

  test('Validates location inside 20m permitted radius (e.g., 5m away)', () => {
    // 0.00004 deg latitude ~ 4.4 meters
    const clientLat = HOSTEL_LAT + 0.00004;
    const clientLon = HOSTEL_LON;

    const result = validateLocation({
      deviceLat: clientLat,
      deviceLon: clientLon,
      accuracy: 8,
      isMockLocation: false,
      hostelLat: HOSTEL_LAT,
      hostelLon: HOSTEL_LON,
      permittedRadiusMeters: RADIUS_METERS
    });

    expect(result.isValid).toBe(true);
    expect(result.distanceMeters).toBeLessThanOrEqual(RADIUS_METERS);
    expect(result.isMockLocationDetected).toBe(false);
  });

  test('Rejects location outside permitted radius (e.g., 200m away)', () => {
    // 0.002 deg latitude ~ 222 meters
    const clientLat = HOSTEL_LAT + 0.002;
    const clientLon = HOSTEL_LON;

    const result = validateLocation({
      deviceLat: clientLat,
      deviceLon: clientLon,
      accuracy: 10,
      isMockLocation: false,
      hostelLat: HOSTEL_LAT,
      hostelLon: HOSTEL_LON,
      permittedRadiusMeters: RADIUS_METERS
    });

    expect(result.isValid).toBe(false);
    expect(result.distanceMeters).toBeGreaterThan(RADIUS_METERS);
  });

  test('Rejects mock location spoofer even if coordinates are inside perimeter', () => {
    const result = validateLocation({
      deviceLat: HOSTEL_LAT,
      deviceLon: HOSTEL_LON,
      accuracy: 5,
      isMockLocation: true, // Device reported mock provider
      hostelLat: HOSTEL_LAT,
      hostelLon: HOSTEL_LON,
      permittedRadiusMeters: RADIUS_METERS
    });

    expect(result.isValid).toBe(false);
    expect(result.isMockLocationDetected).toBe(true);
  });
});
