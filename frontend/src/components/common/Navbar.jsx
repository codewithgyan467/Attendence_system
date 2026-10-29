import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { LogOut, User, Shield, Menu } from 'lucide-react';

export default function Navbar({ onToggleSidebar }) {
  const { user, logout } = useAuth();

  const getRoleBadgeClass = (role) => {
    switch (role) {
      case 'ADMIN': return 'badge-soft-danger';
      case 'WARDEN': return 'badge-soft-warning';
      case 'STUDENT': return 'badge-soft-primary';
      default: return 'badge-soft-primary';
    }
  };

  return (
    <header className="hg-navbar">
      <div className="d-flex align-items-center gap-3">
        <button
          className="btn btn-sm btn-light d-lg-none"
          onClick={onToggleSidebar}
          aria-label="Toggle Navigation"
        >
          <Menu size={20} />
        </button>
        <div className="d-flex align-items-center gap-2">
          <img
            src="/icon-192.png"
            alt="HostelGuard Mascot"
            className="rounded-2 shadow-sm"
            style={{ width: '32px', height: '32px', objectFit: 'cover' }}
          />
          <span className="fw-bold d-none d-sm-inline" style={{ fontSize: '16px', color: 'var(--hg-text-main)' }}>
            HostelGuard <span className="text-primary">Enterprise</span>
          </span>
        </div>
      </div>

      <div className="d-flex align-items-center gap-3">
        {user ? (
          <>
            <div className="d-flex align-items-center gap-2">
              <span className={`badge ${getRoleBadgeClass(user.role)}`}>
                <Shield size={12} className="me-1" />
                {user.role}
              </span>
              <div className="d-none d-md-block text-end">
                <div className="fw-semibold" style={{ fontSize: '13px' }}>{user.username}</div>
                <div className="text-muted" style={{ fontSize: '11px' }}>{user.email || 'Online'}</div>
              </div>
            </div>

            <button
              onClick={logout}
              className="btn btn-sm btn-outline-danger d-flex align-items-center gap-1"
              style={{ fontSize: '12px', padding: '6px 12px' }}
            >
              <LogOut size={14} />
              <span className="d-none d-sm-inline">Sign Out</span>
            </button>
          </>
        ) : (
          <div className="text-muted" style={{ fontSize: '13px' }}>Guest Session</div>
        )}
      </div>
    </header>
  );
}
