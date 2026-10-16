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
  centerLat = 28.5355,
  centerLng = 77.3910,
  radius = 20,
  studentLat = null,
  studentLng = null,
  gpsAccuracy = null,
  locationName = 'Hostel Campus Boundary',
  interactive = false,
  onLocationChange = null,
  height = '360px',
  showLegend = true,
  showDistanceBanner = true,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const centerMarkerRef = useRef(null);
  const geofenceCircleRef = useRef(null);
  const studentMarkerRef = useRef(null);
  const accuracyCircleRef = useRef(null);
  const polylineRef = useRef(null);

  const validCenterLat = Number.isFinite(Number(centerLat)) ? Number(centerLat) : 28.5355;
  const validCenterLng = Number.isFinite(Number(centerLng)) ? Number(centerLng) : 77.3910;
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

    // Initial center marker
    const centerMarker = L.marker([validCenterLat, validCenterLng], {
      icon: createCenterIcon(locationName),
    })
      .addTo(map)
      .bindPopup(`<strong>${locationName}</strong><br/>Permitted Radius: ${validRadius}m`);

    mapRef.current = map;
    geofenceCircleRef.current = circle;
    centerMarkerRef.current = centerMarker;

    const resizeTimer = setTimeout(() => {
      try { map.invalidateSize(); } catch (_) {}
    }, 250);

    return () => {
      clearTimeout(resizeTimer);
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
        `<strong>${locationName}</strong><br/>Permitted Radius: <b>${validRadius}m</b>`
      );
    }

    if (geofenceCircleRef.current) {
      geofenceCircleRef.current.setLatLng(centerLatLng);
      geofenceCircleRef.current.setRadius(validRadius);
    }

    if (!hasStudentPos) {
      map.setView(centerLatLng, map.getZoom() || 17, { animate: true });
    }
  }, [validCenterLat, validCenterLng, validRadius, locationName, hasStudentPos]);

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
        </div>
      )}

      {showLegend && (
        <div className="map-legend-overlay">
          <div className="legend-item">
            <span className="legend-dot center-dot"></span>
            <span>Permitted Radius ({validRadius}m)</span>
          </div>
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
