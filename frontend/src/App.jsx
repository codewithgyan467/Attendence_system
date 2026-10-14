import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar from './components/common/Navbar';
import Sidebar from './components/common/Sidebar';
import LoginPage from './components/auth/LoginPage';
import StudentOnboarding from './components/StudentOnboarding';
import AdminDashboard from './components/admin/AdminDashboard';
import StudentRosterManager from './components/admin/StudentRosterManager';
import GeofenceManager from './components/admin/GeofenceManager';
import AttendanceManager from './components/admin/AttendanceManager';
import SecurityIncidentDesk from './components/admin/SecurityIncidentDesk';
import CorrectionRequestDesk from './components/admin/CorrectionRequestDesk';
import FeedbackTicketDesk from './components/admin/FeedbackTicketDesk';
import AuditLogViewer from './components/admin/AuditLogViewer';
import WardenDashboard from './components/warden/WardenDashboard';
import StudentPortal from './components/student/StudentPortal';
import { ArrowLeft } from 'lucide-react';
import { initOtaUpdater } from './utils/otaUpdater';

function AppContent() {
  const { user, role, loading } = useAuth();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [activeTab, setActiveTab] = useState('');
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);

  // Initialize Over-The-Air (OTA) live updater on app launch
  useEffect(() => {
    initOtaUpdater();
  }, []);

  // Set default tab when role changes
  useEffect(() => {
    if (role === 'ADMIN') {
      setActiveTab('admin_dashboard');
    } else if (role === 'WARDEN') {
      setActiveTab('warden_overview');
    } else if (role === 'STUDENT') {
      setActiveTab('student_attendance');
    }
  }, [role]);

  if (loading) {
    return (
      <div className="d-flex flex-column align-items-center justify-content-center vh-100 bg-light">
        <div className="spinner-border text-primary mb-3" style={{ width: '3rem', height: '3rem' }} role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
        <div className="fw-semibold text-dark">Initializing HostelGuard Enterprise...</div>
        <div className="text-muted small mt-1">Connecting to SQLite WAL Database & Vision Microservice</div>
      </div>
    );
  }

  // Unauthenticated Flow
  if (!user) {
    if (showOnboarding) {
      return (
        <div className="py-4 px-3" style={{ minHeight: '100vh', backgroundColor: '#f8fafc' }}>
          <div className="container mb-3" style={{ maxWidth: '850px' }}>
            <button
              className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
              onClick={() => setShowOnboarding(false)}
            >
              <ArrowLeft size={16} /> Back to Sign In
            </button>
          </div>
          <StudentOnboarding
            onComplete={() => {
              setShowOnboarding(false);
            }}
          />
        </div>
      );
    }
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', display: 'flex', alignItems: 'center' }}>
        <LoginPage onNavigateOnboarding={() => setShowOnboarding(true)} />
      </div>
    );
  }

  // Authenticated Portal Layout
  return (
    <div className="hg-app-layout">
      {/* Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        showMobile={showMobileSidebar}
        onCloseMobile={() => setShowMobileSidebar(false)}
      />

      {/* Mobile Drawer Backdrop */}
      {showMobileSidebar && (
        <div
          className="hg-sidebar-backdrop"
          onClick={() => setShowMobileSidebar(false)}
          aria-hidden="true"
        />
      )}

      {/* Main Content Area */}
      <div className="hg-main-layout">
        <Navbar onToggleSidebar={() => setShowMobileSidebar(!showMobileSidebar)} />

        <main className="p-3 p-lg-4 flex-grow-1">
          {/* Admin Views */}
          {role === 'ADMIN' && (
            <>
              {activeTab === 'admin_dashboard' && <AdminDashboard onNavigate={setActiveTab} />}
              {activeTab === 'admin_students' && <StudentRosterManager />}
              {activeTab === 'admin_geofence' && <GeofenceManager />}
              {activeTab === 'admin_attendance' && <AttendanceManager />}
              {activeTab === 'admin_security' && <SecurityIncidentDesk />}
              {activeTab === 'admin_corrections' && <CorrectionRequestDesk />}
              {activeTab === 'admin_feedback' && <FeedbackTicketDesk />}
              {activeTab === 'admin_audit' && <AuditLogViewer />}
            </>
          )}

          {/* Warden Views */}
          {role === 'WARDEN' && (
            <>
              {activeTab === 'warden_overview' && <WardenDashboard subTab="warden_overview" onSelectTab={setActiveTab} />}
              {activeTab === 'warden_students' && <StudentRosterManager />}
              {activeTab === 'warden_exceptions' && <WardenDashboard subTab="warden_exceptions" onSelectTab={setActiveTab} />}
              {activeTab === 'warden_corrections' && <WardenDashboard subTab="warden_corrections" onSelectTab={setActiveTab} />}
              {activeTab === 'warden_feedback' && <WardenDashboard subTab="warden_feedback" onSelectTab={setActiveTab} />}
              {activeTab === 'warden_attendance' && <AttendanceManager />}
            </>
          )}

          {/* Student Views */}
          {role === 'STUDENT' && (
            <StudentPortal activeTab={activeTab} onSelectTab={setActiveTab} />
          )}
        </main>

        {/* Global Footer */}
        <footer
          className="text-center py-3 px-4 border-top bg-white"
          style={{ fontSize: '12px', color: '#64748b', borderColor: '#e2e8f0' }}
        >
          HostelGuard AI &bull; 100% Free & Open-Source (FOSS) &bull; Node.js Express + SQLite (WAL Mode) + Python OpenCV YuNet/SFace 128D
        </footer>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
