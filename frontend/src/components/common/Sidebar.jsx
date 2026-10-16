import React from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  LayoutDashboard,
  Users,
  MapPin,
  CalendarCheck,
  Clock,
  ShieldAlert,
  FileCheck2,
  LifeBuoy,
  History,
  Building,
  UserCheck,
  Activity,
  X
} from 'lucide-react';

export default function Sidebar({ activeTab, onSelectTab, showMobile, onCloseMobile }) {
  const { role } = useAuth();

  const getMenuItems = () => {
    if (role === 'ADMIN') {
      return [
        { id: 'admin_dashboard', label: 'Executive Dashboard', icon: LayoutDashboard },
        { id: 'admin_students', label: 'Student Roster', icon: Users },
        { id: 'admin_geofence', label: 'Geofence Perimeter', icon: MapPin },
        { id: 'admin_attendance', label: 'Attendance Records', icon: CalendarCheck },
        { id: 'admin_schedule', label: 'Timing & Holidays', icon: Clock },
        { id: 'admin_security', label: 'Security & Forge Alerts', icon: ShieldAlert },
        { id: 'admin_corrections', label: 'Correction Requests', icon: FileCheck2 },
        { id: 'admin_feedback', label: 'Support & Feedback', icon: LifeBuoy },
        { id: 'admin_audit', label: 'System Audit Logs', icon: History },
        { id: 'admin_diagnostics', label: 'System Health', icon: Activity }
      ];
    } else if (role === 'WARDEN') {
      return [
        { id: 'warden_overview', label: 'Warden Overview', icon: Building },
        { id: 'warden_students', label: 'Student Roster & Uploads', icon: Users },
        { id: 'warden_exceptions', label: 'Absence & Exceptions', icon: ShieldAlert },
        { id: 'warden_corrections', label: 'Correction Requests', icon: FileCheck2 },
        { id: 'warden_feedback', label: 'Facility Feedback', icon: LifeBuoy },
        { id: 'warden_attendance', label: 'Block Attendance Logs', icon: CalendarCheck }
      ];
    } else {
      // Student role
      return [
        { id: 'student_attendance', label: 'Mark Attendance', icon: UserCheck },
        { id: 'student_history', label: 'My Attendance History', icon: History },
        { id: 'student_correction', label: 'Submit Correction', icon: FileCheck2 },
        { id: 'student_support', label: 'Support & Feedback', icon: LifeBuoy },
        { id: 'student_profile', label: 'Student Profile', icon: Users }
      ];
    }
  };

  const menuItems = getMenuItems();

  return (
    <aside className={`hg-sidebar ${showMobile ? 'show' : ''}`}>
      {/* Brand Header */}
      <div className="p-3 border-bottom border-dark d-flex align-items-center justify-content-between" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <div className="d-flex align-items-center gap-2">
          <img src="/icon-192.png" alt="HostelGuard" className="rounded-circle shadow-sm" style={{ width: '28px', height: '28px', objectFit: 'cover' }} />
          <span className="text-white fw-bold" style={{ fontSize: '14.5px' }}>HostelGuard</span>
          <span className="badge bg-primary px-1.5 py-0.5" style={{ fontSize: '10px' }}>v2.0</span>
        </div>
        <button className="btn btn-sm text-light d-lg-none" onClick={onCloseMobile}>
          <X size={18} />
        </button>
      </div>

      {/* Nav List */}
      <div className="p-3 flex-grow-1 overflow-auto hg-sidebar-nav">
        <div className="text-uppercase text-muted fw-bold mb-2" style={{ fontSize: '11px', letterSpacing: '0.8px' }}>
          {role} Workspace
        </div>
        <nav className="nav flex-column">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <a
                key={item.id}
                className={`hg-sidebar-link ${isActive ? 'active' : ''}`}
                onClick={(e) => {
                  e.preventDefault();
                  onSelectTab(item.id);
                  if (onCloseMobile) onCloseMobile();
                }}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>
      </div>

      {/* Footer info */}
      <div className="p-3 border-top border-dark d-flex align-items-center justify-content-between" style={{ borderColor: 'rgba(255,255,255,0.08)', fontSize: '11px' }}>
        <div className="d-flex align-items-center gap-2 text-success">
          <span className="badge rounded-pill bg-success p-1" style={{ width: '7px', height: '7px' }}></span>
          <span style={{ fontSize: '11.5px', color: '#94a3b8' }}>System Online</span>
        </div>
        <span className="text-muted" style={{ fontSize: '10.5px' }}>v2.4 Pro</span>
      </div>
    </aside>
  );
}
