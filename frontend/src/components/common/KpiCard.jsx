import React from 'react';

export default function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color = 'primary',
  badgeText,
  onClick,
  actionText
}) {
  const getColorStyles = () => {
    switch (color) {
      case 'success':
        return { bg: 'var(--hg-success-light)', fg: 'var(--hg-success)', text: '#047857', border: '#10b981' };
      case 'danger':
        return { bg: 'var(--hg-danger-light)', fg: 'var(--hg-danger)', text: '#b91c1c', border: '#ef4444' };
      case 'warning':
        return { bg: 'var(--hg-warning-light)', fg: 'var(--hg-warning)', text: '#b45309', border: '#f59e0b' };
      default:
        return { bg: 'var(--hg-primary-light)', fg: 'var(--hg-primary)', text: '#4338ca', border: '#6366f1' };
    }
  };

  const c = getColorStyles();
  const isClickable = typeof onClick === 'function';

  return (
    <div
      className={`card hg-card h-100 ${isClickable ? 'hg-kpi-clickable' : ''}`}
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      } : undefined}
      style={{
        cursor: isClickable ? 'pointer' : 'default',
        userSelect: isClickable ? 'none' : 'auto'
      }}
    >
      <div className="card-body p-3 d-flex flex-column justify-content-between">
        <div>
          <div className="d-flex align-items-center justify-content-between mb-1">
            <span className="text-uppercase fw-semibold text-muted hg-text-xs">
              {title}
            </span>
            {Icon && (
              <div className="hg-kpi-icon rounded-2" style={{ backgroundColor: c.bg, color: c.fg }}>
                <Icon size={18} />
              </div>
            )}
          </div>
          <div className="hg-kpi-value hg-tabular mb-1">{value}</div>
        </div>

        <div>
          <div className="d-flex align-items-center justify-content-between mt-1">
            {subtitle && <span className="text-muted hg-text-xs">{subtitle}</span>}
            {badgeText && (
              <span className="badge hg-badge" style={{ backgroundColor: c.bg, color: c.text }}>
                {badgeText}
              </span>
            )}
          </div>

          {actionText && (
            <div
              className="mt-2 pt-1.5 border-top d-flex align-items-center justify-content-between hg-text-xs"
              style={{ color: c.text, fontWeight: 600 }}
            >
              <span>{actionText}</span>
              <span className="ms-1">&rarr;</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
