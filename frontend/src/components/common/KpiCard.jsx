import React from 'react';
import CountUp from '../CountUp';

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

  // Smooth React Bits CountUp for numerical metrics
  const renderValue = () => {
    if (typeof value === 'number') {
      return <CountUp to={value} duration={1.2} easing="easeOut" />;
    }
    if (typeof value === 'string') {
      const match = value.match(/^([\d,.]+)(.*)$/);
      if (match) {
        const num = parseFloat(match[1].replace(/,/g, ''));
        const suffix = match[2] || '';
        if (!isNaN(num)) {
          const decimals = match[1].includes('.') ? match[1].split('.')[1].length : 0;
          return <CountUp to={num} decimals={decimals} suffix={suffix} duration={1.2} easing="easeOut" separator="," />;
        }
      }
    }
    return value;
  };

  return (
    <div
      className={`hg-kpi-card h-100 ${isClickable ? 'hg-kpi-clickable' : ''}`}
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
        transition: 'transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
        userSelect: isClickable ? 'none' : 'auto'
      }}
    >
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

      <div className="hg-kpi-value">{renderValue()}</div>

      <div className="d-flex align-items-center justify-content-between mt-2">
        {subtitle && <span className="text-muted" style={{ fontSize: '12px' }}>{subtitle}</span>}
        {badgeText && (
          <span className="badge" style={{ backgroundColor: c.bg, color: c.text, fontSize: '11px' }}>
            {badgeText}
          </span>
        )}
      </div>

      {actionText && (
        <div
          className="mt-2.5 pt-2 border-top d-flex align-items-center justify-content-between"
          style={{ fontSize: '11.5px', color: c.text, fontWeight: 600 }}
        >
          <span>{actionText}</span>
          <span style={{ fontSize: '14px', lineHeight: 1 }}>&rarr;</span>
        </div>
      )}
    </div>
  );
}
