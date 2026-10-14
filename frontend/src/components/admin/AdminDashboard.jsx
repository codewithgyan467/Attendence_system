import React, { useState, useEffect } from 'react';
import { api } from '../../utils/api';
import KpiCard from '../common/KpiCard';
import { AttendanceTrendChart, StatusDistributionChart, BlockDistributionChart } from './AdminCharts';
import {
  Users,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ShieldAlert,
  RotateCw,
  MapPin,
  TrendingUp,
  FileCheck
} from 'lucide-react';

export default function AdminDashboard({ onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStats = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.admin.getDashboardStats();
      if (res.success) {
        setData(res);
      }
    } catch (err) {
      setError(err.message || 'Failed to load dashboard metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  if (loading && !data) {
    return (
      <div className="p-4 text-center">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
        <div className="text-muted mt-2">Loading enterprise metrics...</div>
      </div>
    );
  }

  const s = data?.summary || {};

  return (
    <div className="container-fluid px-0">
      {/* Page Header */}
      <div className="d-flex align-items-center justify-content-between mb-4 flex-wrap gap-2">
        <div>
          <h4 className="fw-bold mb-1">Executive Attendance Dashboard</h4>
          <p className="text-muted mb-0" style={{ fontSize: '13px' }}>
            Real-time biometric and geo-fenced hostel operations overview.
          </p>
        </div>
        <div className="d-flex align-items-center gap-2">
          <button onClick={fetchStats} className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" disabled={loading}>
            <RotateCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh Data</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger py-2 px-3 mb-4" style={{ fontSize: '13px' }}>
          <AlertTriangle size={16} className="me-2" />
          {error}
        </div>
      )}

      {/* KPI Cards Row */}
      <div className="row g-3 mb-4">
        <div className="col-12 col-sm-6 col-xl-3">
          <KpiCard
            title="Total Registered Students"
            value={s.totalRegistered || 0}
            subtitle={`${s.totalAllotted || 0} pre-allotted in roster`}
            icon={Users}
            color="primary"
          />
        </div>
        <div className="col-12 col-sm-6 col-xl-3">
          <KpiCard
            title="Present Today"
            value={s.presentToday || 0}
            subtitle={`${s.attendancePercentage || 0}% overall attendance`}
            icon={CheckCircle2}
            color="success"
            badgeText={s.lateToday > 0 ? `+${s.lateToday} Late` : undefined}
          />
        </div>
        <div className="col-12 col-sm-6 col-xl-3">
          <KpiCard
            title="Absent / Unmarked"
            value={s.absentToday || 0}
            subtitle="Residents pending check-in"
            icon={Clock}
            color="warning"
          />
        </div>
        <div className="col-12 col-sm-6 col-xl-3">
          <KpiCard
            title="Forge Location Alerts"
            value={s.flaggedForgeCount || 0}
            subtitle="Hit 3-strike location limit"
            icon={ShieldAlert}
            color={s.flaggedForgeCount > 0 ? 'danger' : 'primary'}
            badgeText={s.pendingCorrections > 0 ? `${s.pendingCorrections} Corrections Pending` : undefined}
          />
        </div>
      </div>

      {/* Charts Row */}
      <div className="row g-3 mb-4">
        <div className="col-12 col-lg-8">
          <div className="hg-card">
            <div className="hg-card-header">
              <div className="d-flex align-items-center gap-2">
                <TrendingUp size={18} className="text-primary" />
                <span className="fw-bold" style={{ fontSize: '14px' }}>7-Day Attendance Trend</span>
              </div>
              <span className="badge bg-light text-dark">Live Database Records</span>
            </div>
            <div className="hg-card-body">
              <AttendanceTrendChart trendData={data?.charts?.weeklyTrend} />
            </div>
          </div>
        </div>

        <div className="col-12 col-lg-4">
          <div className="hg-card">
            <div className="hg-card-header">
              <span className="fw-bold" style={{ fontSize: '14px' }}>Today's Check-In Status</span>
              <span className="badge badge-soft-primary">Today</span>
            </div>
            <div className="hg-card-body">
              <StatusDistributionChart distribution={data?.charts?.statusDistribution} />
            </div>
          </div>
        </div>
      </div>

      {/* Block Distribution & Recent Activity Row */}
      <div className="row g-3">
        <div className="col-12 col-lg-5">
          <div className="hg-card">
            <div className="hg-card-header">
              <div className="d-flex align-items-center gap-2">
                <MapPin size={18} className="text-primary" />
                <span className="fw-bold" style={{ fontSize: '14px' }}>Attendance by Hostel Block</span>
              </div>
              <span className="badge badge-soft-success">Radius: {s.geofenceRadius || 20}m</span>
            </div>
            <div className="hg-card-body">
              <BlockDistributionChart blockData={data?.charts?.blockDistribution} />
            </div>
          </div>
        </div>

        <div className="col-12 col-lg-7">
          <div className="hg-card">
            <div className="hg-card-header">
              <div className="d-flex align-items-center gap-2">
                <FileCheck size={18} className="text-success" />
                <span className="fw-bold" style={{ fontSize: '14px' }}>Recent Verified Attendances</span>
              </div>
              <button
                className="btn btn-sm btn-link text-decoration-none p-0"
                onClick={() => onNavigate && onNavigate('admin_attendance')}
                style={{ fontSize: '12px' }}
              >
                View Full Logs &rarr;
              </button>
            </div>
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Roll Number</th>
                    <th>Student Name</th>
                    <th>Time Marked</th>
                    <th>Status</th>
                    <th>Distance</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.recentActivity && data.recentActivity.length > 0 ? (
                    data.recentActivity.slice(0, 5).map((act, idx) => (
                      <tr key={idx}>
                        <td className="font-mono fw-semibold text-primary">{act.roll_number}</td>
                        <td className="fw-medium">{act.full_name}</td>
                        <td className="font-mono text-muted" style={{ fontSize: '12px' }}>{act.time_marked}</td>
                        <td>
                          <span className={act.status === 'PRESENT' ? 'badge-soft-success' : 'badge-soft-warning'}>
                            {act.status}
                          </span>
                        </td>
                        <td className="font-mono text-muted" style={{ fontSize: '12px' }}>
                          {act.verified_distance !== null ? `${act.verified_distance}m` : 'N/A'}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="5" className="text-center py-3 text-muted" style={{ fontSize: '13px' }}>
                        No check-ins recorded yet today.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
