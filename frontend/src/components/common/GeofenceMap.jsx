import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './GeofenceMap.css';

// Custom Institution Center Pin Icon
const createCenterIcon = (name) =>
  L.divIcon({
    className: 'custom-map-icon-wrap',
    html: `
      <div class="institution-pin" title="${name || 'Hostel Geofence Center'}">
        <span class="pin-icon">📍</span>
      </div>
    `,
    iconSize: [36, 42],
    iconAnchor: [18, 40],
    popupAnchor: [0, -38],
  });

// Custom Live Student Pulsing Beacon Icon
const createStudentIcon = (isInside) =>
  L.divIcon({
    className: 'custom-map-icon-wrap',
    html: `
      <div class="student-marker-beacon ${isInside ? 'inside' : 'outside'}">
        <div class="beacon-pulse"></div>
        <div class="beacon-core"></div>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });

export default function GeofenceMap({
  centerLat = null,
  centerLng = null,
  latitude = null,
  longitude = null,
  radius = 20,
  studentLat = null,
  studentLng = null,
  gpsAccuracy = null,
  locationName = null,
  facilityName = null,
  interactive = false,
  onLocationChange = null,
  height = '360px',
  showLegend = true,
  showDistanceBanner = true,
  beacons = [],
  bleMode = 'STANDBY_OPTIONAL',
  beaconRadius = 15,
  showBeaconZone = true,
  isBeaconDetected = false,
  verifiedBeacon = null,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const centerMarkerRef = useRef(null);
  const geofenceCircleRef = useRef(null);
  const beaconCircleRef = useRef(null);
  const studentMarkerRef = useRef(null);
  const accuracyCircleRef = useRef(null);
  const polylineRef = useRef(null);

  // Active beacon calculations (Glowing Yellow Radio Anchor Coverage)
  const activeBeaconsList = Array.isArray(beacons) ? beacons.filter((b) => b.is_active === 1) : [];
  const hasActiveBeacons = activeBeaconsList.length > 0;
  const hasAnyBeacons = Array.isArray(beacons) && beacons.length > 0;

  // Robust prop fallback: accept both centerLat/centerLng and latitude/longitude
  const rawLat = centerLat !== null && centerLat !== undefined ? centerLat : latitude;
  const rawLng = centerLng !== null && centerLng !== undefined ? centerLng : longitude;
  const resolvedName = locationName || facilityName || 'Hostel Campus Boundary';

  // Default to AEC Guwahati anchor (26.140462, 91.656606) instead of generic Noida
  const validCenterLat = Number.isFinite(Number(rawLat)) ? Number(rawLat) : 26.140462;
  const validCenterLng = Number.isFinite(Number(rawLng)) ? Number(rawLng) : 91.656606;
  const validRadius = Math.max(5, Number(radius) || 20);

  const hasStudentPos =
    studentLat !== null &&
    studentLng !== null &&
    Number.isFinite(Number(studentLat)) &&
    Number.isFinite(Number(studentLng));

  // Distance computation (if student position is available)
  let calculatedDistance = null;
  let isStudentInside = false;

  if (hasStudentPos) {
    const lat1 = validCenterLat * (Math.PI / 180);
    const lon1 = validCenterLng * (Math.PI / 180);
    const lat2 = Number(studentLat) * (Math.PI / 180);
    const lon2 = Number(studentLng) * (Math.PI / 180);
    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    calculatedDistance = Math.round(6371000 * c * 10) / 10;
    isStudentInside = calculatedDistance <= validRadius;
  }

  // Specific physical Bluetooth radio range covered by the ESP32 inside the geofence (~15m corridor zone)
  const effectiveBeaconRadius = Math.min(Math.max(8, Number(beaconRadius) || 15), Math.max(10, validRadius * 0.85));
  const isStudentInBeaconRange = hasStudentPos && calculatedDistance !== null && calculatedDistance <= effectiveBeaconRadius;

  // 1. Initialize Map instance on mount
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Defend against stale Leaflet container id across fast remounts or StrictMode
    if (containerRef.current._leaflet_id) {
      delete containerRef.current._leaflet_id;
    }

    let map;
    try {
      map = L.map(containerRef.current, {
        center: [validCenterLat, validCenterLng],
        zoom: 17,
        zoomControl: true,
        scrollWheelZoom: false,
        attributionControl: true,
      });
    } catch (mapInitErr) {
      console.warn('Leaflet map initialization guarded:', mapInitErr);
      if (containerRef.current) delete containerRef.current._leaflet_id;
      return;
    }

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    // Initial boundary circle
    const circle = L.circle([validCenterLat, validCenterLng], {
      radius: validRadius,
      color: '#4f46e5',
      weight: 2,
      fillColor: '#4f46e5',
      fillOpacity: 0.16,
      dashArray: '5, 6',
    }).addTo(map);

    // Initial center marker (draggable in interactive admin mode)
    const centerMarker = L.marker([validCenterLat, validCenterLng], {
      icon: createCenterIcon(resolvedName),
      draggable: Boolean(interactive),
    })
      .addTo(map)
      .bindPopup(`<strong>${resolvedName}</strong><br/>Permitted Radius: ${validRadius}m`);

    if (interactive && onLocationChange) {
      centerMarker.on('dragend', (e) => {
        const pos = e.target.getLatLng();
        onLocationChange({
          latitude: parseFloat(pos.lat.toFixed(6)),
          longitude: parseFloat(pos.lng.toFixed(6)),
        });
      });
    }

    mapRef.current = map;
    geofenceCircleRef.current = circle;
    centerMarkerRef.current = centerMarker;

    const resizeTimer = setTimeout(() => {
      try { map.invalidateSize(); } catch (_) {}
    }, 250);

    return () => {
      clearTimeout(resizeTimer);
      if (beaconCircleRef.current) {
        try { beaconCircleRef.current.remove(); } catch (_) {}
        beaconCircleRef.current = null;
      }
      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch (_) {}
        mapRef.current = null;
      }
      if (containerRef.current) {
        delete containerRef.current._leaflet_id;
      }
    };
  }, []);

  // 2. Interactive map click listener (Admin Mode)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    function handleClick(e) {
      if (interactive && onLocationChange) {
        onLocationChange({
          latitude: parseFloat(e.latlng.lat.toFixed(6)),
          longitude: parseFloat(e.latlng.lng.toFixed(6)),
        });
      }
    }

    if (interactive) {
      map.on('click', handleClick);
    } else {
      map.off('click', handleClick);
    }

    return () => {
      map.off('click', handleClick);
    };
  }, [interactive, onLocationChange]);

  // 3. Update center anchor & geofence circle dynamically
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const centerLatLng = [validCenterLat, validCenterLng];

    if (centerMarkerRef.current) {
      centerMarkerRef.current.setLatLng(centerLatLng);
      centerMarkerRef.current.setPopupContent(
        `<strong>${resolvedName}</strong><br/>Permitted Radius: <b>${validRadius}m</b>`
      );
    }

    if (geofenceCircleRef.current) {
      geofenceCircleRef.current.setLatLng(centerLatLng);
      geofenceCircleRef.current.setRadius(validRadius);
    }

    if (!hasStudentPos) {
      map.setView(centerLatLng, map.getZoom() || 17, { animate: true });
    }
  }, [validCenterLat, validCenterLng, validRadius, resolvedName, hasStudentPos]);

  // 3b. Update glowing yellow ESP32 Bluetooth beacon circle inside geofence perimeter
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const centerLatLng = [validCenterLat, validCenterLng];
    const shouldShow = showBeaconZone && (hasAnyBeacons || bleMode === 'STRICT_REQUIRED' || bleMode === 'SOFT_ANCHOR');

    if (!shouldShow) {
      if (beaconCircleRef.current) {
        beaconCircleRef.current.remove();
        beaconCircleRef.current = null;
      }
      return;
    }

    const beaconNames = activeBeaconsList.map(b => b.block_name || b.beacon_public_id).join(', ') || 'No active beacons broadcasting';
    const statusLabel = isBeaconDetected
      ? '<span class="badge-status-on">● LIVE SIGNAL VERIFIED (Board Powered ON)</span>'
      : hasActiveBeacons
      ? '<span style="color:#d97706; font-weight:700;">● ANCHOR CONFIGURED (Physical Scan on Check-in)</span>'
      : '<span class="badge-status-off">✕ INACTIVE (Disabled in Admin)</span>';

    const detectionNote = isBeaconDetected
      ? `<div style="color:#15803d; font-size:11px; margin-top:2px;">✓ Verified by local Bluetooth scan from <b>${verifiedBeacon?.beaconPublicId || 'Corridor ESP32'}</b></div>`
      : `<div style="color:#64748b; font-size:11px; margin-top:2px;">📡 Hardware Detection: The ESP32 is offline hardware. Your phone senses if it is powered ON by scanning Bluetooth during check-in.</div>`;

    const popupContent = `
      <div class="beacon-map-popup">
        <div class="beacon-popup-header">
          <span class="${isBeaconDetected ? 'beacon-popup-pulse-dot' : hasActiveBeacons ? 'beacon-popup-amber-dot' : 'beacon-popup-off-dot'}"></span>
          <strong>Hostel ESP32 Bluetooth Anchor</strong>
        </div>
        <div class="beacon-popup-status">
          Status: ${statusLabel}
        </div>
        <div class="beacon-popup-details">
          <div>Physical Range: <b>~${effectiveBeaconRadius}m corridor zone</b></div>
          <div>Configured Anchors: <b>${beaconNames}</b></div>
          ${detectionNote}
          ${bleMode === 'STRICT_REQUIRED'
            ? '<div class="strict-lock-notice">🔒 Strict Lock: Device must be physically inside this yellow circle to mark attendance</div>'
            : '<div style="color:#15803d; font-size:11px; margin-top:2px;">✓ Smart Proximity Anchor Active</div>'}
        </div>
      </div>
    `;

    if (!beaconCircleRef.current) {
      const beaconCircle = L.circle(centerLatLng, {
        radius: effectiveBeaconRadius,
        color: hasActiveBeacons ? '#eab308' : '#94a3b8',
        weight: hasActiveBeacons ? 2.5 : 1.5,
        fillColor: hasActiveBeacons ? '#f59e0b' : '#64748b',
        fillOpacity: hasActiveBeacons ? 0.26 : 0.08,
        dashArray: hasActiveBeacons ? null : '4, 4',
        className: hasActiveBeacons ? 'glowing-beacon-radio-circle' : 'muted-beacon-circle',
      }).addTo(map);

      beaconCircle.bindPopup(popupContent);
      beaconCircleRef.current = beaconCircle;
    } else {
      beaconCircleRef.current.setLatLng(centerLatLng);
      beaconCircleRef.current.setRadius(effectiveBeaconRadius);
      beaconCircleRef.current.setStyle({
        color: hasActiveBeacons ? '#eab308' : '#94a3b8',
        weight: hasActiveBeacons ? 2.5 : 1.5,
        fillColor: hasActiveBeacons ? '#f59e0b' : '#64748b',
        fillOpacity: hasActiveBeacons ? 0.26 : 0.08,
        dashArray: hasActiveBeacons ? null : '4, 4',
        className: hasActiveBeacons ? 'glowing-beacon-radio-circle' : 'muted-beacon-circle',
      });
      beaconCircleRef.current.setPopupContent(popupContent);
    }
  }, [
    validCenterLat,
    validCenterLng,
    effectiveBeaconRadius,
    hasActiveBeacons,
    hasAnyBeacons,
    showBeaconZone,
    bleMode,
    activeBeaconsList
  ]);

  // 4. Update student position, GPS accuracy, and connecting guide polyline
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (hasStudentPos) {
      const studentLatLng = [Number(studentLat), Number(studentLng)];
      const centerLatLng = [validCenterLat, validCenterLng];

      const distance = map.distance(centerLatLng, studentLatLng);
      const isInside = distance <= validRadius;

      // Student marker
      if (!studentMarkerRef.current) {
        studentMarkerRef.current = L.marker(studentLatLng, {
          icon: createStudentIcon(isInside),
          zIndexOffset: 1000,
        }).addTo(map);
      } else {
        studentMarkerRef.current.setLatLng(studentLatLng);
        studentMarkerRef.current.setIcon(createStudentIcon(isInside));
      }

      studentMarkerRef.current.bindPopup(
        `<strong>Your Reported Position</strong><br/>` +
        `Distance to center: <b>${Math.round(distance)}m</b><br/>` +
        `Status: <span style="color:${isInside ? '#10b981' : '#ef4444'}; font-weight:700;">${
          isInside ? '✓ Inside Geofence' : '✕ Outside Geofence'
        }</span>`
      );

      // Accuracy circle
      if (gpsAccuracy && Number(gpsAccuracy) > 0) {
        if (!accuracyCircleRef.current) {
          accuracyCircleRef.current = L.circle(studentLatLng, {
            radius: Number(gpsAccuracy),
            color: '#64748b',
            weight: 1,
            fillColor: '#94a3b8',
            fillOpacity: 0.12,
            dashArray: '3, 4',
          }).addTo(map);
        } else {
          accuracyCircleRef.current.setLatLng(studentLatLng);
          accuracyCircleRef.current.setRadius(Number(gpsAccuracy));
        }
      } else if (accuracyCircleRef.current) {
        accuracyCircleRef.current.remove();
        accuracyCircleRef.current = null;
      }

      // Connecting guide polyline
      const lineColor = isInside ? '#10b981' : '#ef4444';
      if (!polylineRef.current) {
        polylineRef.current = L.polyline([centerLatLng, studentLatLng], {
          color: lineColor,
          weight: 2.5,
          dashArray: '6, 6',
          opacity: 0.85,
        }).addTo(map);
      } else {
        polylineRef.current.setLatLngs([centerLatLng, studentLatLng]);
        polylineRef.current.setStyle({ color: lineColor });
      }

      // Smoothly fit bounds to encompass both geofence circle and student
      const circleBounds = geofenceCircleRef.current?.getBounds();
      const bounds = L.latLngBounds([
        centerLatLng,
        studentLatLng,
        ...(circleBounds ? [circleBounds.getNorthEast(), circleBounds.getSouthWest()] : []),
      ]);
      map.fitBounds(bounds, { padding: [45, 45], maxZoom: 18, animate: true });
    } else {
      // Clear student layers
      if (studentMarkerRef.current) {
        studentMarkerRef.current.remove();
        studentMarkerRef.current = null;
      }
      if (accuracyCircleRef.current) {
        accuracyCircleRef.current.remove();
        accuracyCircleRef.current = null;
      }
      if (polylineRef.current) {
        polylineRef.current.remove();
        polylineRef.current = null;
      }
    }
  }, [hasStudentPos, studentLat, studentLng, validCenterLat, validCenterLng, validRadius, gpsAccuracy]);

  return (
    <div className="geofence-map-wrapper" style={{ height }}>
      <div ref={containerRef} className="geofence-map-container" />

      {interactive && (
        <div className="map-interactive-banner">
          <span>👆 Click anywhere on the map to set geofence coordinates</span>
        </div>
      )}

      {showDistanceBanner && hasStudentPos && calculatedDistance !== null && (
        <div className="map-distance-banner">
          <span>Distance: <strong>{calculatedDistance}m</strong></span>
          <span className={`map-distance-badge ${isStudentInside ? 'inside' : 'outside'}`}>
            {isStudentInside ? '✓ Inside Geofence' : `✕ Exceeds ${validRadius}m Limit`}
          </span>
          {hasActiveBeacons && (
            <span className={`map-beacon-badge ${isBeaconDetected ? 'beacon-verified' : isStudentInBeaconRange ? 'beacon-in-range' : 'beacon-out-range'}`}>
              {isBeaconDetected
                ? `📡 ESP32 Live Signal Verified`
                : isStudentInBeaconRange
                ? `📍 In ESP32 Anchor Zone (~${effectiveBeaconRadius}m)`
                : `📍 Outside Anchor Zone (~${effectiveBeaconRadius}m)`}
            </span>
          )}
        </div>
      )}

      {showLegend && (
        <div className="map-legend-overlay">
          <div className="legend-item">
            <span className="legend-dot center-dot"></span>
            <span>Permitted Radius ({validRadius}m)</span>
          </div>
          {isBeaconDetected ? (
            <div className="legend-item">
              <span className="legend-dot beacon-detected-dot"></span>
              <span>
                ESP32 Anchor (~{effectiveBeaconRadius}m): <b style={{ color: '#16a34a' }}>● Signal Verified (Board ON): {verifiedBeacon?.deviceName || 'HG-BEACON'}</b>
              </span>
            </div>
          ) : (bleMode === 'STRICT_REQUIRED' || bleMode === 'STRICT_LOCK' || bleMode === 'STRICT') ? (
            <div className="legend-item">
              <span className="legend-dot" style={{ backgroundColor: '#dc2626', boxShadow: '0 0 6px rgba(220, 38, 38, 0.6)' }}></span>
              <span>
                ESP32 Anchor (~{effectiveBeaconRadius}m): <b style={{ color: '#dc2626' }}>Strict BLE Signal Required (Camera Locked Until Verified)</b>
              </span>
            </div>
          ) : bleMode === 'SOFT_ANCHOR' ? (
            <div className="legend-item">
              <span className="legend-dot" style={{ backgroundColor: '#d97706', boxShadow: '0 0 6px rgba(217, 119, 6, 0.6)' }}></span>
              <span>
                ESP32 Anchor (~{effectiveBeaconRadius}m): <b style={{ color: '#d97706' }}>Soft Anchor: BLE Optional (Face Fallback Active)</b>
              </span>
            </div>
          ) : (
            <div className="legend-item">
              <span className="legend-dot" style={{ backgroundColor: '#64748b' }}></span>
              <span style={{ color: '#64748b' }}>
                ESP32 Anchor: <b>Standby Mode: BLE Not Required</b>
              </span>
            </div>
          )}
          {hasStudentPos && (
            <div className="legend-item">
              <span className={`legend-dot ${isStudentInside ? 'student-inside-dot' : 'student-outside-dot'}`}></span>
              <span>Your GPS Position</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
