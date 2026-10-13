import React from 'react';
import { ShieldCheck, UserCheck, MapPin, Navigation, Cpu } from 'lucide-react';

export default function Navbar({ activeTab, setActiveTab, systemStatus }) {
  const tabs = [
    { id: 'admin', label: 'Phase 1: Admin Setup', icon: ShieldCheck },
    { id: 'onboard', label: 'Phase 2: Student Onboarding', icon: UserCheck },
    { id: 'attendance', label: 'Phase 3: Daily Attendance', icon: MapPin },
    { id: 'simulator', label: 'GPS & Forge Tester', icon: Navigation }
  ];

  return (
    <header className="glass-panel" style={{ margin: '16px 20px', padding: '14px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #6366f1 0%, #10b981 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 15px rgba(99, 102, 241, 0.4)'
          }}>
            <Cpu size={24} color="#ffffff" />
          </div>
          <div>
            <h1 style={{ fontSize: '18px', fontWeight: '800', letterSpacing: '-0.5px', color: '#ffffff' }}>
              HostelGuard <span style={{ color: '#10b981' }}>AI</span>
            </h1>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              100% Free & Open-Source Geo-Fenced & Facial Attendance
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  background: isActive ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.3) 0%, rgba(16, 185, 129, 0.2) 100%)' : 'rgba(255, 255, 255, 0.04)',
                  color: isActive ? '#ffffff' : 'var(--text-muted)',
                  border: isActive ? '1px solid rgba(99, 102, 241, 0.5)' : '1px solid transparent',
                  padding: '10px 16px',
                  borderRadius: '10px',
                  fontWeight: '600',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: isActive ? '0 4px 15px rgba(99, 102, 241, 0.2)' : 'none'
                }}
              >
                <Icon size={16} color={isActive ? '#10b981' : 'var(--text-dim)'} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Status Pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: '999px',
            background: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            fontSize: '12px',
            fontWeight: '600',
            color: '#34d399'
          }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#10b981',
              boxShadow: '0 0 8px #10b981'
            }}></span>
            SQLite + OpenCV FOSS Engine
          </div>
        </div>
      </div>
    </header>
  );
}
