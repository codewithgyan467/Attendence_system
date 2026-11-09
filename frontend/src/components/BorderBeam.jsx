import React from 'react';
import './BorderBeam.css';

/**
 * Pure-CSS glowing BorderBeam component.
 * Uses GPU compositor-accelerated CSS mask rotation for 60 FPS performance on mobile.
 *
 * @param {string} className - Additional CSS classes
 * @param {number} size - Beam diameter multiplier (default: 200)
 * @param {number} duration - Animation cycle duration in seconds (default: 5)
 * @param {number} delay - Animation start delay in seconds (default: 0)
 * @param {string} colorFrom - Starting gradient hex/rgb color
 * @param {string} colorTo - Ending gradient hex/rgb color
 * @param {number} borderWidth - Border thickness in pixels (default: 2)
 * @param {string|number} borderRadius - Inherited or explicit border radius
 * @param {object} style - Inline styles override
 */
export default function BorderBeam({
  className = '',
  size = 200,
  duration = 5,
  delay = 0,
  colorFrom = '#3b82f6',
  colorTo = '#10b981',
  borderWidth = 2,
  borderRadius,
  style = {}
}) {
  return (
    <div
      aria-hidden="true"
      className={`hg-border-beam ${className}`}
      style={{
        '--beam-size': `${size}px`,
        '--beam-duration': `${duration}s`,
        '--beam-delay': `${delay}s`,
        '--beam-color-from': colorFrom,
        '--beam-color-to': colorTo,
        '--beam-width': `${borderWidth}px`,
        ...(borderRadius !== undefined
          ? { borderRadius: typeof borderRadius === 'number' ? `${borderRadius}px` : borderRadius }
          : {}),
        ...style
      }}
    />
  );
}
