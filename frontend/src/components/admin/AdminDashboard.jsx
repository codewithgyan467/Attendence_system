import React, { useState, useEffect } from 'react';
import { api } from '../../utils/api';
import KpiCard from '../common/KpiCard';
import SpotlightCard from '../SpotlightCard';
import ShinyText from '../ShinyText';

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

  FileCheck,

  Search,

  Filter,

  Download,

  X,

  Phone,

  Mail,

  ArrowRight,

  FileSpreadsheet,

  Radio,
  ShieldCheck,
  Cpu,
  Zap,
  RefreshCw,
  Send,
  Unlock
} from 'lucide-react';

import { exportToExcel, exportToCsv } from '../../utils/exportUtils';

import { formatTime12h, getCurrentTimeIST12h, formatDateIST, getTodayDateIST } from '../../utils/timeUtils';



const DASHBOARD_CACHE_KEY = 'hg_cached_admin_dashboard_stats';



const getCachedDashboardStats = () => {

  try {

    const raw = localStorage.getItem(DASHBOARD_CACHE_KEY);

    return raw ? JSON.parse(raw) : null;

  } catch {

    return null;

  }

};



export default function AdminDashboard({ onNavigate }) {

  const [data, setData] = useState(getCachedDashboardStats);

  const [loading, setLoading] = useState(!data);

  const [isSyncing, setIsSyncing] = useState(false);

  const [lastSynced, setLastSynced] = useState(() => (getCachedDashboardStats() ? 'Cached' : ''));

  const [error, setError] = useState('');
  const [bleMode, setBleMode] = useState('STANDBY_OPTIONAL');
  const [bleUpdating, setBleUpdating] = useState(false);
  const [vaultStatus, setVaultStatus] = useState(null);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [vaultSyncing, setVaultSyncing] = useState(false);
  const [vaultMsg, setVaultMsg] = useState(null);
  const [resettingStrikes, setResettingStrikes] = useState(false);
  const [beacons, setBeacons] = useState([]);
  const [authorizedWifiList, setAuthorizedWifiList] = useState([]);
  const [authorizingWifi, setAuthorizingWifi] = useState(false);
  const [scanningBle, setScanningBle] = useState(false);
  const [scanResult, setScanResult] = useState(null);



  // Today's Roster Interactive Modal State

  const [rosterModalOpen, setRosterModalOpen] = useState(false);

  const [rosterTab, setRosterTab] = useState('PRESENT'); // 'PRESENT' | 'ABSENT'

  const [searchQuery, setSearchQuery] = useState('');

  const [blockFilter, setBlockFilter] = useState('');



  const fetchStats = async (isManual = false) => {

    try {

      if (!data || isManual) {

        setLoading(true);

      }

      setIsSyncing(true);

      setError('');

      const res = await api.admin.getDashboardStats();

      if (res.success) {

        setData(res);

        setLastSynced(getCurrentTimeIST12h());

        try {

          localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(res));

        } catch (_) {}

      }

    } catch (err) {

      if (!data) {

        setError(err.message || 'Failed to load dashboard metrics');

      }

    } finally {

      setLoading(false);

      setIsSyncing(false);

    }

  };



  const fetchBleAndVault = async () => {

    try {

      const [bleData, vData] = await Promise.allSettled([

        api.admin.getBleConfig(),

        api.admin.getStrictVaultStatus()

      ]);

      if (bleData.status === 'fulfilled' && bleData.value?.success) {
        setBleMode(bleData.value.ble_mode || 'STANDBY_OPTIONAL');
        setBeacons(bleData.value.beacons || []);
      }

      if (vData.status === 'fulfilled' && vData.value?.success) {
        setVaultStatus(vData.value);
      }

      api.admin.getAuthorizedWifi().then(r => {
        if (r?.success) setAuthorizedWifiList(r.authorizedList || []);
      }).catch(() => {});
    } catch (_) {}
  };

  const handleAuthorizeCurrentWifi = async () => {
    setAuthorizingWifi(true);
    try {
      const res = await api.admin.authorizeCurrentWifi('Warden Connected Wi-Fi');
      if (res?.success) {
        setAuthorizedWifiList(res.authorizedList || []);
        setVaultMsg(`📶 Wi-Fi Router Authorized! Subnet: ${res.clientIp || res.lanIp}. Students on this router can now check in.`);
      }
    } catch (err) {
      setVaultMsg(`Failed to authorize Wi-Fi: ${err.message}`);
    } finally {
      setAuthorizingWifi(false);
    }
  };

  const handleScanNearbyBeacon = async () => {
    setScanningBle(true);
    setScanResult(null);
    try {
      const { scanHostelBleBeacon } = await import('../../utils/nativeHardware');
      const res = await scanHostelBleBeacon({ timeoutMs: 5000 });
      if (res?.success) {
        setScanResult({
          success: true,
          message: `✅ Found ${res.beaconPublicId || res.deviceName}! Rolling Code: ${res.rollingCode} (Step: ${res.slot})`
        });
      } else {
        setScanResult({
          success: false,
          message: res?.message || 'No ESP32 beacon detected. Ensure the board is powered on.'
        });
      }
    } catch (err) {
      setScanResult({
        success: false,
        message: err.message || 'Bluetooth scan cancelled or unavailable.'
      });
    } finally {
      setScanningBle(false);
    }
  };

  const handleToggleBeacon = async (b) => {
    try {
      await api.admin.toggleBleBeacon(b.id);
      fetchBleAndVault();
    } catch (err) {
      setVaultMsg(`Failed to toggle beacon: ${err.message}`);
    }
  };

  const handleDeleteBeacon = async (id) => {
    if (!window.confirm('Are you sure you want to remove this floor box beacon?')) return;
    try {
      await api.admin.deleteBleBeacon(id);
      fetchBleAndVault();
    } catch (err) {
      setVaultMsg(`Failed to delete beacon: ${err.message}`);
    }
  };

  const handleModeChange = async (newMode) => {

    setBleUpdating(true);
    setVaultMsg(null);
    try {
      const res = await api.admin.updateBleMode(newMode);
      if (res?.success) {
        setBleMode(newMode);
        if (newMode === 'STRICT_REQUIRED' || newMode === 'STRICT' || newMode === 'STRICT_LOCK') {
          setVaultMsg('🔒 Mode 3 (Strict Hostel Lock) activated! Offline student biometrics & floor box anchors prepared automatically.');
          api.admin.prepareStrictVaultOffline().catch(() => {});
        } else if (newMode === 'SOFT_ANCHOR') {
          setVaultMsg('🟡 Mode 2 (Smart Mode) activated! Fast proximity check with camera backup.');
        } else {
          setVaultMsg('🟢 Mode 1 (Normal Mode) activated! Geofence GPS & Face verification active.');
        }
        fetchBleAndVault();
      }
    } catch (err) {
      setVaultMsg(`Failed to update mode: ${err.message}`);
    } finally {
      setBleUpdating(false);
    }
  };

  const handleTemporaryRelax = async () => {
    if (!window.confirm('Temporarily allow Mode 1 (GPS + Face Only) for 15 minutes? This is useful if a floor box loses power. It will automatically revert to Strict Lock after 15 minutes.')) return;
    setBleUpdating(true);
    try {
      const res = await api.admin.triggerTemporaryRelax(15);
      if (res?.success) {
        setBleMode('STANDBY_OPTIONAL');
        setVaultMsg('⏱️ Temporary 15-Minute Relax Mode Active! Students can check in via GPS & Face. System will automatically return to Strict Mode in 15 minutes.');
        fetchBleAndVault();
      }
    } catch (err) {
      setVaultMsg(`Failed to activate temporary relax mode: ${err.message}`);
    } finally {
      setBleUpdating(false);
    }
  };

  const handleResetAllStrikes = async () => {
    if (!window.confirm('Reset all student strikes back to 0 and immediately unlock all accounts?')) return;
    setResettingStrikes(true);
    try {
      const res = await api.admin.resetAllStrikes({ reason: 'Warden 1-Click Dashboard Reset' });
      if (res?.success) {
        setVaultMsg('🔓 All student strikes have been cleared back to 0! All locked accounts are now unlocked.');
        fetchStats();
      }
    } catch (err) {
      setVaultMsg(`Failed to reset strikes: ${err.message}`);
    } finally {
      setResettingStrikes(false);
    }
  };



  const handlePrepareVault = async () => {

    setVaultLoading(true);

    setVaultMsg(null);

    try {

      const res = await api.admin.prepareStrictVaultOffline();

      if (res?.success) {

        setVaultMsg(`Cached ${res.cachedStudents} students into local SQLite & loaded Float32 RAM vector cache!`);

        fetchBleAndVault();

      }

    } catch (err) {

      setVaultMsg(`Offline cache error: ${err.message}`);

    } finally {

      setVaultLoading(false);

    }

  };



  const handleSyncVault = async () => {

    setVaultSyncing(true);

    setVaultMsg(null);

    try {

      const res = await api.admin.syncVaultToCloud();

      if (res?.success) {

        setVaultMsg(`Synced ${res.syncedAttendanceCount} attendance records from local vault to Turso Cloud!`);

        fetchBleAndVault();

      }

    } catch (err) {

      setVaultMsg(`Cloud sync error: ${err.message}`);

    } finally {

      setVaultSyncing(false);

    }

  };



  useEffect(() => {

    fetchStats();

    fetchBleAndVault();

  }, []);



  if (loading && !data) {

    return (

      <div className="container-fluid px-0 py-2">

        <div className="d-flex justify-content-between align-items-center mb-4 placeholder-glow">

          <div>

            <div className="placeholder col-8 bg-secondary rounded py-2 mb-2" style={{ minWidth: '220px' }}></div>

            <div className="placeholder col-6 bg-secondary rounded py-1" style={{ minWidth: '160px' }}></div>

          </div>

          <div className="placeholder col-2 bg-secondary rounded py-3" style={{ minWidth: '100px' }}></div>

        </div>



        <div className="row g-3 mb-4">

          {[1, 2, 3, 4].map((n) => (

            <div key={n} className="col-12 col-sm-6 col-xl-3">

              <div className="hg-card p-3 placeholder-glow" style={{ borderRadius: '12px' }}>

                <div className="d-flex justify-content-between mb-2">

                  <span className="placeholder col-6 bg-secondary rounded py-1"></span>

                  <span className="placeholder rounded-circle bg-secondary" style={{ width: '28px', height: '28px' }}></span>

                </div>

                <div className="placeholder col-4 bg-secondary rounded py-3 my-2"></div>

                <span className="placeholder col-8 bg-secondary rounded py-1"></span>

              </div>

            </div>

          ))}

        </div>



        <div className="row g-3">

          <div className="col-12 col-lg-8">

            <div className="hg-card p-4 placeholder-glow" style={{ minHeight: '300px', borderRadius: '12px' }}>

              <span className="placeholder col-4 bg-secondary rounded py-2 mb-4 d-block"></span>

              <div className="placeholder col-12 bg-secondary rounded" style={{ height: '220px' }}></div>

            </div>

          </div>

          <div className="col-12 col-lg-4">

            <div className="hg-card p-4 placeholder-glow" style={{ minHeight: '300px', borderRadius: '12px' }}>

              <span className="placeholder col-6 bg-secondary rounded py-2 mb-4 d-block"></span>

              <div className="placeholder col-12 bg-secondary rounded-circle mx-auto" style={{ width: '160px', height: '160px' }}></div>

            </div>

          </div>

        </div>

      </div>

    );

  }



  const s = data?.summary || {};



  const handleOpenRoster = (tab) => {

    setRosterTab(tab);

    setSearchQuery('');

    setBlockFilter('');

    setRosterModalOpen(true);

  };



  const presentStudents = data?.todayPresent || [];

  const absentStudents = data?.todayAbsent || [];



  const activeList = rosterTab === 'PRESENT' ? presentStudents : absentStudents;



  const filteredList = activeList.filter((item) => {

    const q = searchQuery.toLowerCase().trim();

    const matchesQuery =

      !q ||

      item.full_name?.toLowerCase().includes(q) ||

      item.roll_number?.toLowerCase().includes(q) ||

      item.room_number?.toLowerCase().includes(q) ||

      item.hostel_block?.toLowerCase().includes(q) ||

      item.course?.toLowerCase().includes(q);



    const matchesBlock = !blockFilter || item.hostel_block === blockFilter;



    return matchesQuery && matchesBlock;

  });



  const availableBlocks = Array.from(

    new Set(

      [...presentStudents, ...absentStudents]

        .map((st) => st.hostel_block)

        .filter(Boolean)

    )

  ).sort();



  const getRosterExportData = () => {

    const isPresent = rosterTab === 'PRESENT';

    const headers = isPresent

      ? [

          { key: 'roll_number', label: 'Roll Number' },

          { key: 'full_name', label: 'Full Name' },

          { key: 'hostel_block', label: 'Hostel Block' },

          { key: 'room_number', label: 'Room Number' },

          { key: 'course', label: 'Course' },

          { key: 'time_marked', label: 'Check-in Time (IST)' },

          { key: 'status', label: 'Status' },

          { key: 'distance', label: 'Verified Distance' },

          { key: 'phone', label: 'Phone' },

          { key: 'email', label: 'Email' }

        ]

      : [

          { key: 'roll_number', label: 'Roll Number' },

          { key: 'full_name', label: 'Full Name' },

          { key: 'hostel_block', label: 'Hostel Block' },

          { key: 'room_number', label: 'Room Number' },

          { key: 'course', label: 'Course' },

          { key: 'status', label: 'Status' },

          { key: 'phone', label: 'Phone' },

          { key: 'email', label: 'Email' }

        ];



    const data = filteredList.map((item) => {

      if (isPresent) {

        return {

          roll_number: item.roll_number || '',

          full_name: item.full_name || '',

          hostel_block: item.hostel_block || '',

          room_number: item.room_number || '',

          course: item.course || '',

          time_marked: item.time_marked_12 || item.time_marked ? formatTime12h(item.time_marked_12 || item.time_marked) : 'N/A',

          status: item.status || 'PRESENT',

          distance: item.verified_distance !== null && item.verified_distance !== undefined ? `${item.verified_distance}m` : 'N/A',

          phone: item.phone || '',

          email: item.email || ''

        };

      } else {

        return {

          roll_number: item.roll_number || '',

          full_name: item.full_name || '',

          hostel_block: item.hostel_block || '',

          room_number: item.room_number || '',

          course: item.course || '',

          status: item.status || 'ABSENT',

          phone: item.phone || '',

          email: item.email || ''

        };

      }

    });



    return { headers, data, isPresent };
  };

  const handleShareAbsentOnWhatsApp = () => {
    const absents = data?.todayAbsent || [];
    if (absents.length === 0) {
      alert('Great news! All students are present today.');
      return;
    }
    const dateStr = formatDateIST(new Date());
    let msg = `📋 *HostelGuard Attendance Report - ${dateStr}*\n`;
    msg += `❌ *Total Absent Students:* ${absents.length}\n\n`;
    absents.forEach((st, idx) => {
      const name = st.full_name || st.name || 'Student';
      const roll = st.roll_number || st.roll_no || 'N/A';
      const room = st.room_number || st.room_no || 'N/A';
      const block = st.hostel_block || '';
      msg += `${idx + 1}. *${name}* (${roll}) - Room: ${room}${block ? ' (' + block + ')' : ''}\n`;
    });
    msg += `\n_Generated automatically via HostelGuard System_`;

    try {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(msg);
      }
    } catch (_) {}

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const handleExportRosterCsv = () => {

    const { headers, data, isPresent } = getRosterExportData();

    exportToCsv({

      filename: `hostel_${isPresent ? 'present' : 'absent'}_residents_${getTodayDateIST()}`,

      headers,

      data

    });

  };



  const handleExportRosterExcel = () => {

    const { headers, data, isPresent } = getRosterExportData();

    exportToExcel({

      filename: `hostel_${isPresent ? 'present' : 'absent'}_residents_${getTodayDateIST()}`,

      sheetName: isPresent ? 'Present Residents' : 'Absent Residents',

      headers,

      data

    });

  };



  const todayFormatted = formatDateIST(new Date());



  return (

    <div className="container-fluid px-0">

      {/* Page Header */}

      <div className="d-flex align-items-center justify-content-between mb-4 flex-wrap gap-2">

        <div>

          <h4 className="fw-bold mb-1">Executive Attendance Dashboard</h4>

          <p className="text-muted mb-0" style={{ fontSize: '13px' }}>

            Real-time biometric and geo-fenced hostel operations overview. Click Present or Absent cards to view student rosters.

          </p>

        </div>

        <div className="d-flex align-items-center gap-2">

          {isSyncing ? (

            <span className="badge bg-light text-primary border d-none d-sm-inline-flex align-items-center gap-1 py-2 px-2" style={{ fontSize: '11px' }}>

              <RotateCw size={11} className="spin-fast" /> Syncing live...

            </span>

          ) : lastSynced ? (

            <span className="badge bg-light text-muted border d-none d-sm-inline-block py-2 px-2" style={{ fontSize: '11px' }}>

              ✓ Synced {lastSynced}

            </span>

          ) : null}

          <button onClick={() => fetchStats(true)} className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" disabled={isSyncing}>

            <RotateCw size={14} className={isSyncing ? 'animate-spin' : ''} />

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

            subtitle={`${s.presentToday || 0} / ${s.totalRegistered || 0} residents present today`}

            icon={CheckCircle2}

            color="success"

            badgeText={s.lateToday > 0 ? `+${s.lateToday} Late` : undefined}

            onClick={() => handleOpenRoster('PRESENT')}

            actionText="View Present Students"

          />

        </div>

        <div className="col-12 col-sm-6 col-xl-3">

          <KpiCard

            title="Absent / Unmarked"

            value={s.absentToday || 0}

            subtitle="Residents pending check-in"

            icon={Clock}

            color="warning"

            onClick={() => handleOpenRoster('ABSENT')}

            actionText="View Absent Students"

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



      {/* Plain-English 3-Mode Attendance Selector (One-Click Setup) */}
      <div className="card border-0 rounded-4 shadow-sm mb-4 overflow-hidden border-start border-4 border-primary bg-white">
        <div className="card-header bg-light py-3 px-4 border-bottom d-flex align-items-center justify-content-between flex-wrap gap-2">
          <div className="d-flex align-items-center gap-2">
            <Radio size={20} className="text-primary" />
            <h6 className="fw-bold mb-0 text-dark">Hostel Attendance Enforcement Mode</h6>
          </div>
          <span className={`badge ${bleMode === 'STRICT_REQUIRED' || bleMode === 'STRICT_LOCK' ? 'bg-danger text-white' : (bleMode === 'SOFT_ANCHOR' ? 'bg-warning text-dark' : 'bg-success text-white')} px-3 py-1.5`} style={{ fontSize: '11px' }}>
            {bleMode === 'STRICT_REQUIRED' || bleMode === 'STRICT_LOCK' ? (
              <ShinyText text="Active: Mode 3: Strict Hostel Lock" color="#ffffff" shineColor="#fecaca" speed={2.5} />
            ) : (
              `Active: ${bleMode === 'SOFT_ANCHOR' ? 'Mode 2: Smart Mode' : 'Mode 1: Normal Mode'}`
            )}
          </span>
        </div>

        <div className="card-body p-4">
          <div className="row g-3 mb-3">
            {/* Mode 1: Normal Mode */}
            <div className="col-12 col-md-4">
              <div
                className={`card h-100 p-3.5 border-2 cursor-pointer transition-all ${bleMode === 'STANDBY_OPTIONAL' ? 'border-success bg-success bg-opacity-10 shadow-sm' : 'border-light bg-light'}`}
                style={{ cursor: 'pointer' }}
                onClick={() => !bleUpdating && handleModeChange('STANDBY_OPTIONAL')}
              >
                <div className="d-flex align-items-center justify-content-between mb-2">
                  <span className="badge bg-success text-white fw-bold">🟢 Mode 1: Normal Mode</span>
                  {bleMode === 'STANDBY_OPTIONAL' && <ShieldCheck size={18} className="text-success" />}
                </div>
                <h6 className="fw-bold mb-1 text-dark">GPS + Face Only</h6>
                <p className="text-muted small mb-0" style={{ fontSize: '12px', lineHeight: '1.4' }}>
                  Best when floor boxes are off. Students only need Hostel GPS &amp; Face.
                </p>
              </div>
            </div>

            {/* Mode 2: Smart Mode */}
            <div className="col-12 col-md-4">
              <div
                className={`card h-100 p-3.5 border-2 cursor-pointer transition-all ${bleMode === 'SOFT_ANCHOR' ? 'border-warning bg-warning bg-opacity-10 shadow-sm' : 'border-light bg-light'}`}
                style={{ cursor: 'pointer' }}
                onClick={() => !bleUpdating && handleModeChange('SOFT_ANCHOR')}
              >
                <div className="d-flex align-items-center justify-content-between mb-2">
                  <span className="badge bg-warning text-dark fw-bold">🟡 Mode 2: Smart Mode</span>
                  {bleMode === 'SOFT_ANCHOR' && <ShieldCheck size={18} className="text-warning" />}
                </div>
                <h6 className="fw-bold mb-1 text-dark">Fast Floor Box + Face Backup</h6>
                <p className="text-muted small mb-0" style={{ fontSize: '12px', lineHeight: '1.4' }}>
                  Recommended daily mode. Instant check-in near floor box, or camera check if box is busy.
                </p>
              </div>
            </div>

            {/* Mode 3: Strict Hostel Lock (Powered by React Bits SpotlightCard) */}
            <div className="col-12 col-md-4">
              <SpotlightCard
                theme="light"
                spotlightColor="rgba(239, 68, 68, 0.22)"
                className={`card h-100 p-3.5 border-2 cursor-pointer transition-all ${bleMode === 'STRICT_REQUIRED' || bleMode === 'STRICT_LOCK' ? 'border-danger bg-danger bg-opacity-10 shadow-sm' : 'border-light bg-light'}`}
                style={{ cursor: 'pointer', padding: '1rem' }}
                onClick={() => !bleUpdating && handleModeChange('STRICT_REQUIRED')}
              >
                <div className="d-flex align-items-center justify-content-between mb-2">
                  <span className="badge bg-danger text-white fw-bold">🔒 Mode 3: Strict Hostel Lock</span>
                  {(bleMode === 'STRICT_REQUIRED' || bleMode === 'STRICT_LOCK') && <ShieldCheck size={18} className="text-danger" />}
                </div>
                <h6 className="fw-bold mb-1 text-dark">Wi-Fi + Floor Box + Face</h6>
                <p className="text-muted small mb-0" style={{ fontSize: '12px', lineHeight: '1.4' }}>
                  100% Proxy-Proof. Students MUST be on Hostel Wi-Fi and standing near the floor box.
                </p>
              </SpotlightCard>
            </div>
          </div>

          {vaultMsg && (
            <div className="alert alert-info py-2 px-3 small mb-3">
              {vaultMsg}
            </div>
          )}

          {/* Simple "System Health & Auto-Save" Banner (Replaces Complex Vault Controls) */}
          <div className="card bg-light border p-3 rounded-4 mt-2">
            <div className="d-flex align-items-center justify-content-between flex-wrap gap-2.5">
              <div className="d-flex align-items-center gap-2">
                {(vaultStatus?.unsyncedAttendanceCount || 0) === 0 ? (
                  <div className="d-flex align-items-center gap-2 text-success fw-bold small">
                    <CheckCircle2 size={18} className="text-success" />
                    <span>✅ All Attendance Saved to Cloud Automatically</span>
                  </div>
                ) : (
                  <div className="d-flex align-items-center gap-2 text-primary fw-bold small">
                    <RefreshCw size={16} className="text-primary spin" />
                    <span>🔄 Saving {vaultStatus?.unsyncedAttendanceCount} Offline Records to Cloud Automatically...</span>
                  </div>
                )}
              </div>

              <div className="d-flex align-items-center gap-2">
                {/* 1-Click Strike Reset / Account Unlock */}
                <button
                  type="button"
                  className="btn btn-outline-danger btn-sm fw-bold d-inline-flex align-items-center gap-1.5 shadow-sm"
                  onClick={handleResetAllStrikes}
                  disabled={resettingStrikes}
                  title="Clear all student account strikes back to 0 and immediately unlock all accounts"
                >
                  <Unlock size={14} className="text-danger" />
                  {resettingStrikes ? 'Unlocking...' : '🔓 Unlock All Accounts'}
                </button>

                {/* 1-Click Temporary 15-Min Relax Button */}
                {(bleMode === 'STRICT_REQUIRED' || bleMode === 'STRICT_LOCK') && (
                  <button
                    type="button"
                    className="btn btn-outline-warning btn-sm fw-bold d-inline-flex align-items-center gap-1.5 shadow-sm text-dark"
                    onClick={handleTemporaryRelax}
                    disabled={bleUpdating}
                    title="Temporarily allows Mode 1 (GPS + Face Only) for 15 minutes if a floor box loses power, then automatically reverts to Strict Lock"
                  >
                    <Clock size={14} className="text-warning" />
                    ⏱️ Allow Temporary Backup Check-In (15 Mins)
                  </button>
                )}

                {/* Optional Save Now button */}
                {(vaultStatus?.unsyncedAttendanceCount || 0) > 0 && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm fw-bold d-inline-flex align-items-center gap-1.5 shadow-sm"
                    disabled={vaultSyncing}
                    onClick={handleSyncVault}
                  >
                    <Zap size={14} />
                    {vaultSyncing ? 'Saving Now...' : 'Save Now to Cloud'}
                  </button>
                )}
              </div>
            </div>

            {/* Auto-published Warden Wi-Fi LAN Address */}
            {vaultStatus?.localLanUrls && vaultStatus.localLanUrls.length > 0 && (
              <div className="mt-2.5 pt-2.5 border-top d-flex align-items-center justify-content-between flex-wrap gap-2 text-muted small" style={{ fontSize: '11.5px' }}>
                <div className="d-flex align-items-center gap-1.5">
                  <Radio size={13} className="text-primary" />
                  <span><b>Warden Laptop Wi-Fi Address (Auto-Published):</b> <code className="text-dark bg-white border px-1.5 py-0.5 rounded">{vaultStatus.localLanUrls[0]}</code></span>
                </div>
                <span className="text-secondary">Students on hostel Wi-Fi auto-route to this address with zero setup</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 1-Click Multi-Floor Boxes & Multi-Wi-Fi Manager */}
      <div className="card border-0 rounded-4 shadow-sm mb-4 overflow-hidden bg-white">
        <div className="card-header bg-light py-3 px-4 border-bottom d-flex align-items-center justify-content-between flex-wrap gap-2">
          <div className="d-flex align-items-center gap-2">
            <Radio size={18} className="text-primary" />
            <h6 className="fw-bold mb-0 text-dark">🏢 Floor Boxes &amp; Multi-Wi-Fi Fleet Manager</h6>
          </div>
          <div className="d-flex align-items-center gap-2">
            <button
              type="button"
              className="btn btn-outline-primary btn-sm fw-bold d-inline-flex align-items-center gap-1.5 shadow-sm"
              onClick={handleAuthorizeCurrentWifi}
              disabled={authorizingWifi}
              title="Adds current router/broadband IP to authorized list so students on this Wi-Fi can check in"
            >
              <Radio size={13} />
              {authorizingWifi ? 'Authorizing...' : '📶 Authorize Current Wi-Fi'}
            </button>
            <button
              type="button"
              className="btn btn-outline-dark btn-sm fw-bold d-inline-flex align-items-center gap-1.5 shadow-sm"
              onClick={handleScanNearbyBeacon}
              disabled={scanningBle}
              title="Tests Bluetooth reception by scanning for nearby ESP32 beacon"
            >
              <RefreshCw size={13} className={scanningBle ? 'spin' : ''} />
              {scanningBle ? 'Scanning Beacon...' : '🔍 Scan Nearby Box via Bluetooth'}
            </button>
          </div>
        </div>
        <div className="card-body p-4">
          {scanResult && (
            <div className={`alert ${scanResult.success ? 'alert-success' : 'alert-warning'} py-2 px-3 small mb-3`} style={{ fontSize: '12px' }}>
              {scanResult.message}
            </div>
          )}

          {/* Floor Box Cards */}
          <div className="row g-3 mb-3">
            {beacons && beacons.length > 0 ? (
              beacons.map((b) => (
                <div key={b.id || b.beacon_public_id} className="col-12 col-md-6 col-lg-4">
                  <div className="card h-100 p-3 border shadow-xs rounded-3 bg-light position-relative">
                    <div className="d-flex align-items-center justify-content-between mb-2">
                      <span className={`badge ${b.is_active ? 'bg-success text-white' : 'bg-secondary text-white'} fw-semibold`} style={{ fontSize: '10.5px' }}>
                        {b.is_active ? '🟢 ACTIVE' : '⚪ DISABLED'}
                      </span>
                      <code className="text-dark bg-white border px-1.5 py-0.5 rounded small" style={{ fontSize: '11px' }}>
                        {b.beacon_public_id}
                      </code>
                    </div>
                    <h6 className="fw-bold mb-1 text-dark" style={{ fontSize: '13.5px' }}>
                      {b.block_name || 'Floor Anchor'}
                    </h6>
                    <div className="text-muted small mb-2.5" style={{ fontSize: '11px' }}>
                      {b.last_seen_at ? `Last Seen: ${new Date(b.last_seen_at).toLocaleTimeString()}` : 'Ready / In-Range'}
                    </div>
                    <div className="d-flex align-items-center gap-2 mt-auto pt-2 border-top">
                      <button
                        type="button"
                        className={`btn btn-sm py-1 px-2.5 fw-semibold ${b.is_active ? 'btn-outline-secondary' : 'btn-outline-success'}`}
                        style={{ fontSize: '11px' }}
                        onClick={() => handleToggleBeacon(b)}
                      >
                        {b.is_active ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm py-1 px-2.5 fw-semibold"
                        style={{ fontSize: '11px' }}
                        onClick={() => handleDeleteBeacon(b.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="col-12 text-muted small py-2">
                No floor boxes registered yet. Click &quot;Geofence Perimeter&quot; in the left sidebar to add a new ESP32 anchor.
              </div>
            )}
          </div>

          {/* Authorized Wi-Fi Router Subnets */}
          {authorizedWifiList && authorizedWifiList.length > 0 && (
            <div className="pt-2 border-top">
              <div className="fw-semibold text-dark small mb-1.5" style={{ fontSize: '12px' }}>
                Authorized Wi-Fi Gateways &amp; Routers ({authorizedWifiList.length})
              </div>
              <div className="d-flex flex-wrap gap-2">
                {authorizedWifiList.map((w, idx) => (
                  <span key={idx} className="badge bg-white border text-dark fw-normal py-1 px-2.5 d-inline-flex align-items-center gap-1.5" style={{ fontSize: '11px' }}>
                    <span className="text-success">●</span> {w.label || 'Hostel Wi-Fi'}: <code>{w.subnet || w.ip}</code>
                  </span>
                ))}
              </div>
            </div>
          )}
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

                        <td className="font-mono text-muted" style={{ fontSize: '12px' }}>{formatTime12h(act.time_marked)}</td>

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



      {/* Interactive Today's Attendance Roster Modal (Present & Absent View) */}

      {rosterModalOpen && (

        <div

          className="modal show d-block"

          tabIndex="-1"

          style={{ background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(4px)', zIndex: 1060 }}

          onClick={(e) => {

            if (e.target === e.currentTarget) setRosterModalOpen(false);

          }}

        >

          <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">

            <div className="modal-content border-0 shadow-lg" style={{ borderRadius: '16px', overflow: 'hidden' }}>

              {/* Modal Header */}

              <div className="modal-header border-bottom bg-light px-4 py-3 d-flex align-items-center justify-content-between">

                <div>

                  <div className="d-flex align-items-center gap-2">

                    <div

                      className={`p-2 rounded-circle ${rosterTab === 'PRESENT' ? 'bg-success bg-opacity-10 text-success' : 'bg-warning bg-opacity-10 text-warning'}`}

                    >

                      {rosterTab === 'PRESENT' ? <CheckCircle2 size={22} /> : <Clock size={22} />}

                    </div>

                    <div>

                      <h5 className="modal-title fw-bold text-dark mb-0" style={{ fontSize: '18px' }}>

                        {rosterTab === 'PRESENT' ? "Today's Present Residents" : "Today's Absent & Unmarked Residents"}

                      </h5>

                      <span className="text-muted small">

                        {todayFormatted} &bull; Authoritative Real-Time Hostel Records

                      </span>

                    </div>

                  </div>

                </div>

                <button

                  type="button"

                  className="btn-close"

                  aria-label="Close"

                  onClick={() => setRosterModalOpen(false)}

                />

              </div>



              {/* Modal Subheader with Segmented Tabs and Search */}

              <div className="modal-body px-4 py-3">

                {/* Segmented Control / Tab Switcher */}

                <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-3 pb-3 border-bottom">

                  <div className="btn-group p-1 bg-light rounded-3 border" role="group">

                    <button

                      type="button"

                      className={`btn btn-sm px-3 py-1.5 fw-semibold d-flex align-items-center gap-2 rounded-2 ${rosterTab === 'PRESENT' ? 'btn-success shadow-sm text-white' : 'btn-light text-muted'}`}

                      onClick={() => setRosterTab('PRESENT')}

                    >

                      <CheckCircle2 size={16} />

                      <span>Present Today</span>

                      <span className={`badge ms-1 ${rosterTab === 'PRESENT' ? 'bg-white text-success' : 'bg-secondary bg-opacity-25 text-dark'}`}>

                        {presentStudents.length}

                      </span>

                    </button>



                    <button

                      type="button"

                      className={`btn btn-sm px-3 py-1.5 fw-semibold d-flex align-items-center gap-2 rounded-2 ${rosterTab === 'ABSENT' ? 'btn-warning shadow-sm text-dark' : 'btn-light text-muted'}`}

                      onClick={() => setRosterTab('ABSENT')}

                    >

                      <Clock size={16} />

                      <span>Absent / Unmarked</span>

                      <span className={`badge ms-1 ${rosterTab === 'ABSENT' ? 'bg-dark text-white' : 'bg-secondary bg-opacity-25 text-dark'}`}>

                        {absentStudents.length}

                      </span>

                    </button>

                  </div>



                  <div className="d-flex align-items-center gap-2 flex-grow-1 flex-sm-grow-0">

                    {/* Search Bar */}

                    <div className="input-group input-group-sm" style={{ minWidth: '220px', maxWidth: '320px' }}>

                      <span className="input-group-text bg-white border-end-0">

                        <Search size={14} className="text-muted" />

                      </span>

                      <input

                        type="text"

                        className="form-control border-start-0 ps-0"

                        placeholder="Search name, roll no, room..."

                        value={searchQuery}

                        onChange={(e) => setSearchQuery(e.target.value)}

                      />

                      {searchQuery && (

                        <button

                          className="btn btn-outline-secondary border-start-0"

                          type="button"

                          onClick={() => setSearchQuery('')}

                        >

                          <X size={13} />

                        </button>

                      )}

                    </div>



                    {/* Block Filter */}

                    {availableBlocks.length > 0 && (

                      <select

                        className="form-select form-select-sm"

                        style={{ width: 'auto' }}

                        value={blockFilter}

                        onChange={(e) => setBlockFilter(e.target.value)}

                      >

                        <option value="">All Blocks</option>

                        {availableBlocks.map((blk) => (

                          <option key={blk} value={blk}>{blk}</option>

                        ))}

                      </select>

                    )}



                    {/* Export Buttons (CSV + Excel + WhatsApp) */}
                    <button
                      type="button"
                      className="btn btn-outline-success btn-sm fw-bold d-flex align-items-center gap-1.5 shadow-sm"
                      onClick={handleShareAbsentOnWhatsApp}
                      title="Share absent students list via WhatsApp"
                    >
                      <Send size={13} />
                      <span className="d-inline">📲 Share Absent on WhatsApp</span>
                    </button>

                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1.5"
                      onClick={handleExportRosterCsv}
                      title="Export as CSV"
                    >

                      <Download size={14} />

                      <span className="d-none d-md-inline">CSV</span>

                    </button>

                    <button

                      type="button"

                      className="btn btn-success btn-sm d-flex align-items-center gap-1.5 shadow-sm"

                      onClick={handleExportRosterExcel}

                      title="Export as Excel (.xlsx)"

                    >

                      <FileSpreadsheet size={14} />

                      <span className="d-none d-md-inline">Excel (.xlsx)</span>

                    </button>

                  </div>

                </div>



                {/* Table Container */}

                <div className="table-responsive border rounded-3" style={{ maxHeight: '420px', minHeight: '200px' }}>

                  <table className="table table-hover align-middle mb-0" style={{ fontSize: '13px' }}>

                    <thead className="table-light sticky-top" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>

                      {rosterTab === 'PRESENT' ? (

                        <tr>

                          <th className="ps-3 py-2.5">Roll Number</th>

                          <th className="py-2.5">Student Name</th>

                          <th className="py-2.5">Room & Block</th>

                          <th className="py-2.5">Check-In Time</th>

                          <th className="py-2.5">Verification</th>

                          <th className="py-2.5">Distance</th>

                          <th className="text-end pe-3 py-2.5">Status</th>

                        </tr>

                      ) : (

                        <tr>

                          <th className="ps-3 py-2.5">Roll Number</th>

                          <th className="py-2.5">Student Name</th>

                          <th className="py-2.5">Room & Block</th>

                          <th className="py-2.5">Student Contact</th>

                          <th className="py-2.5">Course / Year</th>

                          <th className="text-end pe-3 py-2.5">Status</th>

                        </tr>

                      )}

                    </thead>

                    <tbody>

                      {filteredList.length === 0 ? (

                        <tr>

                          <td colSpan={rosterTab === 'PRESENT' ? 7 : 6} className="text-center py-5 text-muted">

                            {searchQuery || blockFilter ? (

                              <div>

                                <Search size={32} className="opacity-25 mb-2" />

                                <div className="fw-semibold">No students match your search criteria.</div>

                                <div className="small mt-1">Try clearing your search query or block filter.</div>

                              </div>

                            ) : rosterTab === 'PRESENT' ? (

                              <div>

                                <Clock size={36} className="opacity-25 mb-2 text-warning" />

                                <div className="fw-semibold">No check-ins recorded yet today.</div>

                                <div className="small mt-1">Attendance window opens during scheduled hours.</div>

                              </div>

                            ) : (

                              <div>

                                <CheckCircle2 size={36} className="text-success opacity-50 mb-2" />

                                <div className="fw-semibold text-success">100% Attendance Achieved!</div>

                                <div className="small mt-1">All registered hostel residents are marked present today.</div>

                              </div>

                            )}

                          </td>

                        </tr>

                      ) : (

                        filteredList.map((st, idx) => (

                          <tr key={st.attendance_id || st.student_id || st.roll_number || idx}>

                            <td className="ps-3 fw-bold font-monospace text-primary">

                              {st.roll_number}

                            </td>

                            <td>

                              <div className="fw-semibold text-dark">{st.full_name}</div>

                              {st.email && <div className="text-muted small" style={{ fontSize: '11px' }}>{st.email}</div>}

                            </td>

                            <td>

                              <span className="badge bg-light text-dark border me-1">

                                {st.hostel_block || 'Block A'}

                              </span>

                              <span className="text-muted small">Rm {st.room_number || 'N/A'}</span>

                            </td>



                            {rosterTab === 'PRESENT' ? (

                              <>

                                <td>

                                  <span className="badge bg-light text-dark border font-monospace d-inline-flex align-items-center gap-1">

                                    <Clock size={11} className="text-muted" />

                                    {st.time_marked_12 || st.time_marked ? formatTime12h(st.time_marked_12 || st.time_marked) : 'Recorded'}

                                  </span>

                                </td>

                                <td>

                                  <small className="text-muted">

                                    {st.is_override ? 'Admin Override' : (st.verification_method || 'Facial Match')}

                                  </small>

                                </td>

                                <td>

                                  {st.verified_distance !== null && st.verified_distance !== undefined ? (

                                    <span className={`badge ${Number(st.verified_distance) <= 20 ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'}`}>

                                      {Number(st.verified_distance).toFixed(1)}m

                                    </span>

                                  ) : (

                                    <span className="text-muted small">&mdash;</span>

                                  )}

                                </td>

                                <td className="text-end pe-3">

                                  <span className={`badge ${st.status === 'PRESENT' ? 'bg-success' : st.status === 'LATE' ? 'bg-warning text-dark' : 'bg-primary'}`}>

                                    {st.status || 'PRESENT'}

                                  </span>

                                </td>

                              </>

                            ) : (

                              <>

                                <td>

                                  {st.phone ? (

                                    <a

                                      href={`tel:${st.phone}`}

                                      className="text-decoration-none fw-semibold small text-primary d-inline-flex align-items-center gap-1"

                                    >

                                      <Phone size={12} />

                                      {st.phone}

                                    </a>

                                  ) : (

                                    <span className="text-muted small">No phone on file</span>

                                  )}

                                </td>

                                <td>

                                  <small className="text-muted">{st.course || 'Undergraduate'}</small>

                                </td>

                                <td className="text-end pe-3">

                                  <span className="badge bg-warning-subtle text-warning border border-warning-subtle">

                                    Pending Check-in

                                  </span>

                                </td>

                              </>

                            )}

                          </tr>

                        ))

                      )}

                    </tbody>

                  </table>

                </div>

              </div>



              {/* Modal Footer */}

              <div className="modal-footer border-top bg-light px-4 py-2.5 d-flex align-items-center justify-content-between">

                <div className="text-muted small">

                  Showing <strong>{filteredList.length}</strong> of <strong>{activeList.length}</strong> {rosterTab === 'PRESENT' ? 'present' : 'absent'} residents

                </div>

                <div className="d-flex align-items-center gap-2">

                  {onNavigate && (

                    <button

                      type="button"

                      className="btn btn-outline-primary btn-sm d-flex align-items-center gap-1"

                      onClick={() => {

                        setRosterModalOpen(false);

                        onNavigate('admin_attendance');

                      }}

                    >

                      <span>Open in Attendance Records</span>

                      <ArrowRight size={14} />

                    </button>

                  )}

                  <button

                    type="button"

                    className="btn btn-secondary btn-sm"

                    onClick={() => setRosterModalOpen(false)}

                  >

                    Close

                  </button>

                </div>

              </div>

            </div>

          </div>

        </div>

      )}

    </div>

  );

}

