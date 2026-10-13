import React from 'react';

export default function KpiCard({ title, value, subtitle, icon: Icon, color = 'primary', badgeText }) {
  const getColorStyles = () => {
    switch (color) {
      case 'success':
        return { bg: 'var(--hg-success-light)', fg: 'var(--hg-success)', text: '#047857' };
      case 'danger':
        return { bg: 'var(--hg-danger-light)', fg: 'var(--hg-danger)', text: '#b91c1c' };
      case 'warning':
        return { bg: 'var(--hg-warning-light)', fg: 'var(--hg-warning)', text: '#b45309' };
      default:
        return { bg: 'var(--hg-primary-light)', fg: 'var(--hg-primary)', text: '#4338ca' };
    }
  };

  const c = getColorStyles();

  return (
    <div className="hg-kpi-card h-100">
      <div className="d-flex align-items-center justify-content-between mb-2">
        <span className="text-uppercase fw-bold text-muted" style={{ fontSize: '11px', letterSpacing: '0.5px' }}>
          {title}
        </span>
        {Icon && (
          <div className="hg-kpi-icon" style={{ backgroundColor: c.bg, color: c.fg }}>
            <Icon size={20} />
          </div>
        )}
      </div>

      <div className="hg-kpi-value">{value}</div>

      <div className="d-flex align-items-center justify-content-between mt-2">
        {subtitle && <span className="text-muted" style={{ fontSize: '12px' }}>{subtitle}</span>}
        {badgeText && (
          <span className="badge" style={{ backgroundColor: c.bg, color: c.text, fontSize: '11px' }}>
            {badgeText}
          </span>
        )}
      </div>
    </div>
  );
}
