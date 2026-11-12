import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { api, setActiveBleMode, setLocalWardenUrl } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { getNativeOrBrowserLocation, isNativeMobile, scanHostelBleBeacon, verifyGenuineIOSDevice, checkDeviceMockSecurity, openSpoofAppSettings } from '../../utils/nativeHardware';
import { Line } from 'react-chartjs-2';
import {
  UserCheck,
  History,
  Calendar,
  FileCheck2,
  LifeBuoy,
  User,
  MapPin,
  Camera,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Clock,
  ShieldAlert,
  ShieldCheck,
  Radio,
  Bluetooth,
  Send,
  Navigation,
  Sparkles,
  X,
  Check,
  Zap,
  Volume2,
  Globe,
  Download,
  Lock,
  Wifi,
  Compass,
  ExternalLink,
  ArrowLeft,
  ArrowRight,
  Settings
} from 'lucide-react';
import GeofenceMap from '../common/GeofenceMap';
import { playBiometricChime, detectFaceAngle, detectBlinkEvent, resetBlinkTracker, generateOptimizedBiometricPayload } from '../../utils/faceAngleGuide';
import { analyzeFaceFrame, captureCleanFrame, captureBurstFrames, computeFaceLuminance } from '../../utils/faceMeshHelper';
import { formatTime12h, formatDateTime12h, formatDateIST, getCurrentTimeIST12h } from '../../utils/timeUtils';

const formatDisplayTime12h = (timeVal) => {
  return formatTime12h(timeVal);
};

export default function StudentPortal({ activeTab = 'student_attendance', onSelectTab }) {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  // Safely hoisted resident profile & stats references to eliminate TDZ ReferenceErrors permanently
  const student = dashboard?.student || user?.studentProfile || {};
  const stats = dashboard?.stats || {};
  const todayStatus = dashboard?.todayStatus || {};
  const [history, setHistory] = useState([]);
  const [corrections, setCorrections] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [scheduleStatus, setScheduleStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [gpsLiveAccuracy, setGpsLiveAccuracy] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

  // Daily Check-in flow state: 'idle' | 'verifying_gps' | 'gps_ok' | 'camera_active' | 'verifying_face' | 'success' | 'failed'
  const [checkinStep, setCheckinStep] = useState('idle');
  const [enforcementMode, setEnforcementMode] = useState('STANDBY');
  const [sessionToken, setSessionToken] = useState(null);
  const [verifiedDistance, setVerifiedDistance] = useState(null);
  const [checkinError, setCheckinError] = useState(null);
  const [studentCoords, setStudentCoords] = useState(null);
  const [bleScanningStatus, setBleScanningStatus] = useState(null);
  const [verifiedBeaconInfo, setVerifiedBeaconInfo] = useState(null);
  const [verifiedWifiAnchor, setVerifiedWifiAnchor] = useState(null);
  const [activeChallenge, setActiveChallenge] = useState('HOLD_STILL');
  const [activeChallengeInstruction, setActiveChallengeInstruction] = useState('Fit face into oval and hold steady');
  const [showSpoofModal, setShowSpoofModal] = useState(false);
  const [spoofModalData, setSpoofModalData] = useState({ apps: [], reasons: [] });

  // iOS Device Detection and Bluefy QR Code
  const isIOSDevice = typeof navigator !== 'undefined' && (
    /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
  // True only if running on iOS inside Safari or a browser that lacks Web Bluetooth
  const isSafariOnIOS = isIOSDevice && (typeof navigator === 'undefined' || !navigator.bluetooth);

  const [bluefyQrUrl, setBluefyQrUrl] = useState('');

  // Voice Guidance State & Helper
  const [voiceGuideEnabled, setVoiceGuideEnabled] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('hg_voice_guide') !== 'false';
    }
    return true;
  });

  const speakPrompt = (text) => {
    if (!voiceGuideEnabled || typeof window === 'undefined' || !window.speechSynthesis || !text) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.lang = 'en-US';
      window.speechSynthesis.speak(utterance);
    } catch (_) { }
  };

  const toggleVoiceGuide = () => {
    const nextVal = !voiceGuideEnabled;
    setVoiceGuideEnabled(nextVal);
    if (typeof window !== 'undefined') {
      localStorage.setItem('hg_voice_guide', String(nextVal));
    }
    if (nextVal) speakPrompt('Voice guidance enabled');
  };

  const translateErrorForStudent = (rawErr) => {
    if (!rawErr) return {
      title: 'Check-In Verification Incomplete',
      badge: 'Assistance Needed',
      fix: 'We could not complete your attendance check-in.',
      bullets: ['Check your Wi-Fi and Bluetooth connection and tap Try Again.'],
      voice: 'Verification incomplete. Please check your connection and tap Try Again.'
    };

    const errLower = String(rawErr).toLowerCase();
    const isInsideBoundary = (typeof verifiedDistance === 'number' && verifiedDistance <= (Number(dashboard?.geofence?.radius_meters) || 150)) ||
      (typeof studentCoords?.lat === 'number');

    // 1. Chrome Web Bluetooth Block on HTTP
    if (errLower.includes('chrome blocks bluetooth') || (errLower.includes('http:') && errLower.includes('bluetooth'))) {
      return {
        title: 'Google Chrome Bluetooth Blocked',
        badge: 'Browser Restriction',
        fix: 'Google Chrome blocks Bluetooth on web links. The signed HostelGuard app connects directly to the floor ESP32 without any browser restrictions!',
        bullets: [
          'Tap "Download HostelGuard App" below to install the official mobile app.',
          'Or open chrome://flags/#unsafely-treat-insecure-origin-as-secure in Chrome and add your hostel server address.'
        ],
        voice: 'Google Chrome blocks Bluetooth on web links. Please install the HostelGuard app.'
      };
    }

    // 1b. Android Nearby Devices / Bluetooth Runtime Permission
    if (
      errLower.includes('nearby devices') ||
      (errLower.includes('permission') && (errLower.includes('bluetooth') || errLower.includes('ble')))
    ) {
      return {
        title: 'Nearby Devices Permission Required',
        badge: 'Android Permission',
        fix: 'HostelGuard needs "Nearby devices" permission to communicate with your floor ESP32 beacon.',
        bullets: [
          'Open your phone Settings -> Apps -> HostelGuard -> Permissions.',
          'Set "Nearby devices" (and "Location") to Allowed.',
          'Return to HostelGuard and tap Try Again.'
        ],
        voice: 'Please allow Nearby devices permission in phone settings and tap Try Again.'
      };
    }

    // 2. BLE / ESP32 Hardware Beacon Issues
    if (
      errLower.includes('beacon') ||
      errLower.includes('esp32') ||
      errLower.includes('bluetooth') ||
      errLower.includes('floor box') ||
      errLower.includes('hardware anchor') ||
      errLower.includes('strict_ble') ||
      errLower.includes('device_not_selected') ||
      errLower.includes('anchor zone')
    ) {
      const distInfo = typeof verifiedDistance === 'number' ? ` (${verifiedDistance}m from center)` : '';
      return {
        title: 'Floor ESP32 Anchor Required',
        badge: 'Step 2: Bluetooth',
        fix: isInsideBoundary
          ? `Your GPS position is confirmed inside the hostel${distInfo}. Step 2 now requires connecting to your floor's ESP32 Bluetooth anchor to verify physical presence.`
          : 'We could not detect the HostelGuard ESP32 box for your floor.',
        bullets: [
          'Ensure your floor\'s ESP32 beacon is powered ON (purple/red LED glowing).',
          !isNativeMobile()
            ? 'Web browsers block Bluetooth on HTTP. Please install the HostelGuard Mobile App or use Bluefy on iOS.'
            : 'Turn ON your phone\'s Bluetooth and Location in your swipe-down settings shade.',
          'Stand within 15 meters of your floor\'s ESP32 anchor board and tap Try Again.'
        ],
        voice: 'Floor anchor required. Turn on Bluetooth and stand within 15 meters of your floor anchor.'
      };
    }

    // 3. Strict LAN / Wi-Fi Gatekeeper
    if (
      errLower.includes('lan') ||
      errLower.includes('cellular') ||
      errLower.includes('wi-fi') ||
      errLower.includes('wifi') ||
      errLower.includes('private network') ||
      errLower.includes('subnet') ||
      errLower.includes('strict_lan') ||
      errLower.includes('unreachable')
    ) {
      return {
        title: 'Connect to Hostel Wi-Fi',
        badge: 'Step 1: Network',
        fix: 'Strict Lock is active. Check-ins must come through the local Hostel Wi-Fi.',
        bullets: [
          'Turn OFF your mobile data (4G/5G).',
          'Connect your phone to the Hostel Wi-Fi network and tap Try Again.'
        ],
        voice: 'Please turn off mobile data, connect to the Hostel Wi-Fi, and try again.'
      };
    }

    // 4. Location / GPS Outside or Inaccurate
    if (
      errLower.includes('location') ||
      errLower.includes('geofence') ||
      errLower.includes('gps') ||
      errLower.includes('distance') ||
      errLower.includes('out-of-boundary')
    ) {
      if (isInsideBoundary && (typeof verifiedDistance === 'number' && verifiedDistance <= (Number(dashboard?.geofence?.radius_meters) || 150))) {
        return {
          title: 'Floor Anchor Signal Needed',
          badge: 'Step 2: Bluetooth Anchor',
          fix: `You are inside the hostel boundary (${verifiedDistance}m), but physical presence could not be confirmed. Step 2 requires connecting to your floor's ESP32 beacon.`,
          bullets: [
            'Ensure the floor ESP32 anchor is powered ON (LED glowing).',
            'Turn ON Bluetooth and Location on your phone.',
            'Stand within 15 meters of the beacon and tap Try Again.'
          ],
          voice: 'Please connect to your floor ESP32 beacon and tap Try Again.'
        };
      }
      return {
        title: 'Location Not Clear',
        badge: 'Step 1: Location',
        fix: rawErr.includes('coarse') || rawErr.includes('accuracy')
          ? rawErr
          : 'Your phone GPS position could not be confirmed inside the hostel boundary.',
        bullets: [
          'Turn ON Location/GPS on your device with High Accuracy.',
          'Stand near a window or corridor to get a clear satellite GPS fix, then tap Try Again.'
        ],
        voice: 'Location not clear. Please turn on high accuracy GPS and stand near a window or corridor.'
      };
    }

    // 5. Biometric Face / Liveness / Anti-Spoofing
    if (
      errLower.includes('face') ||
      errLower.includes('liveness') ||
      errLower.includes('camera') ||
      errLower.includes('anti-spoof') ||
      errLower.includes('match') ||
      errLower.includes('photo')
    ) {
      return {
        title: 'Face Check Unclear',
        badge: 'Step 3: Biometrics',
        fix: 'The camera could not verify your live face.',
        bullets: [
          'Make sure your face is well-lit and remove caps or sunglasses.',
          'Hold the phone steady at eye level and look directly at the camera.'
        ],
        voice: 'Face check unclear. Make sure your face is well-lit and look directly at the camera.'
      };
    }

    // 6. Account Lockout
    if (errLower.includes('strike') || errLower.includes('lockout') || errLower.includes('locked')) {
      return {
        title: 'Security Review Active',
        badge: 'Warden Clearance',
        fix: 'Your account is pending review after consecutive verification attempts.',
        bullets: [
          'Please see the Hostel Warden or submit an appeal to clear your account.'
        ],
        voice: 'Security review active. Please see the Hostel Warden to clear your account.'
      };
    }

    return {
      title: 'Check-In Verification Incomplete',
      badge: 'Assistance Needed',
      fix: rawErr,
      bullets: [
        'Check your Wi-Fi and Bluetooth connection and tap Try Again.'
      ],
      voice: 'Verification incomplete. Please check your connection and tap Try Again.'
    };
  };

  const getStepStatus = (stepIndex) => {
    if (stepIndex === 1) {
      if (checkinStep === 'verifying_gps') return 'active';
      if (verifiedDistance !== null || studentCoords !== null || checkinStep === 'verifying_ble' || checkinStep === 'camera_active' || checkinStep === 'verifying_face' || checkinStep === 'success') return 'done';
      return 'idle';
    }
    if (stepIndex === 2) {
      if (checkinStep === 'verifying_ble') return 'active';
      if (verifiedBeaconInfo !== null || verifiedWifiAnchor !== null || checkinStep === 'camera_active' || checkinStep === 'verifying_face' || checkinStep === 'success') return 'done';
      return 'idle';
    }
    if (stepIndex === 3) {
      if (checkinStep === 'camera_active' || checkinStep === 'verifying_face') return 'active';
      if (checkinStep === 'success') return 'done';
      return 'idle';
    }
    return 'idle';
  };

  useEffect(() => {
    QRCode.toDataURL('https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055', {
      width: 140,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' }
    }).then(setBluefyQrUrl).catch(() => { });
  }, []);

  // Built-in Offline Voice Guidance Prompts
  useEffect(() => {
    if (checkinStep === 'camera_active') {
      speakPrompt('Floor box verified. Please look at the camera.');
    } else if (checkinStep === 'success') {
      speakPrompt('Attendance marked successfully.');
    } else if (checkinStep === 'failed' && checkinError) {
      const translated = translateErrorForStudent(checkinError);
      if (translated?.voice) {
        speakPrompt(translated.voice);
      }
    }
  }, [checkinStep, checkinError]);

  // Dynamic beacon list from active admin configuration
  const activeBeaconList = Array.isArray(dashboard?.beacons) && dashboard.beacons.length > 0
    ? dashboard.beacons.map(b => b.block_name || b.beacon_public_id).join(', ')
    : 'authorized floor ESP32 beacon';

  // Robust multi-layer enrollment fallback to eliminate reload flicker
  const isFaceEnrolled = Boolean(
    dashboard?.hasFaceRegistered ||
    student?.face_enrollment_status === 'ENROLLED' ||
    stats?.hasFaceRegistered ||
    user?.hasFaceRegistered ||
    user?.studentProfile?.face_enrollment_status === 'ENROLLED'
  );
  const [activeCameraLabel, setActiveCameraLabel] = useState('');
  const [isVirtualCamDetected, setIsVirtualCamDetected] = useState(false);
  const [showMapRadar, setShowMapRadar] = useState(true);
  const [scanProgress, setScanProgress] = useState(0);
  const [screenFlashEnabled, setScreenFlashEnabled] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);
  const [showPhysicalReviewModal, setShowPhysicalReviewModal] = useState(false);
  const [physicalReviewReason, setPhysicalReviewReason] = useState('Medical condition / facial bandage');
  const [physicalReviewNotes, setPhysicalReviewNotes] = useState('');
  const [physicalReviewSubmitting, setPhysicalReviewSubmitting] = useState(false);
  const [physicalReviewSuccess, setPhysicalReviewSuccess] = useState(null);

  // Live Check-in Camera
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);

  // In-Portal Facial Identity Enrollment
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [enrollPhotos, setEnrollPhotos] = useState([]);
  const [enrollActiveAngle, setEnrollActiveAngle] = useState('FRONT');
  const [enrollSubmitting, setEnrollSubmitting] = useState(false);
  const [enrollError, setEnrollError] = useState(null);
  const enrollVideoRef = useRef(null);
  const enrollStreamRef = useRef(null);

  // Hands-Free Auto-Capture & Head Pose Tracking
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(true);
  const [poseStatus, setPoseStatus] = useState({ detected: false, angle: 'NONE', progress: 0, label: '' });
  const [flashActive, setFlashActive] = useState(false);
  const isAutoSnappingRef = useRef(false);
  const autoHoldProgressRef = useRef(0);

  // Multi-Router LAN Wi-Fi Cluster Handshake Ticket
  const [lanWifiTicket, setLanWifiTicket] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const p = new URLSearchParams(window.location.search);
        return p.get('lan_wifi_ticket') || null;
      } catch (_) { }
    }
    return null;
  });

  // Forms
  const [correctionForm, setCorrectionForm] = useState({ date: new Date().toISOString().split('T')[0], reason: '' });
  const [submittingCorrection, setSubmittingCorrection] = useState(false);

  const [ticketForm, setTicketForm] = useState({ category: 'Hostel Facilities', subject: '', message: '' });
  const [submittingTicket, setSubmittingTicket] = useState(false);

  useEffect(() => {
    fetchStudentData();
    return () => {
      stopCamera();
      stopEnrollCamera();
    };
  }, []);

  // Ensure video stream is attached to the video DOM element as soon as it mounts or changes step
  useEffect(() => {
    if ((checkinStep === 'camera_active' || checkinStep === 'verifying_face') && videoRef.current && streamRef.current) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
      }
      videoRef.current.play().catch((err) => console.warn('Video autoPlay prevented on step change:', err));
    }
  }, [checkinStep]);

  // 3D Pose-Aware Real-Time Center & Liveness Gatekeeper for Check-In
  useEffect(() => {
    if (checkinStep !== 'camera_active') return;

    let triggered = false;
    let steadyStartTime = null;
    let animId = null;
    let lastCheckTime = 0;
    const warmupUntil = Date.now() + 600;

    const checkFrame = async (timestamp) => {
      if (triggered || checkinStep !== 'camera_active') return;

      // Sample every ~120ms for high responsiveness without CPU lag
      if (timestamp - lastCheckTime >= 120) {
        lastCheckTime = timestamp;

        if (videoRef.current && videoRef.current.readyState >= 2 && Date.now() >= warmupUntil) {
          try {
            const targetStep = (activeChallenge === 'TURN_LEFT') ? 'LEFT' :
                               (activeChallenge === 'TURN_RIGHT') ? 'RIGHT' : 'FRONT';
            const analysis = await analyzeFaceFrame(videoRef.current, targetStep);
            if (analysis && analysis.ready) {
              if (!steadyStartTime) steadyStartTime = Date.now();

              // Hold steady for 400ms or instant natural blink while aligned
              const isHeld400ms = (Date.now() - steadyStartTime) >= 400;
              const isBlinkNatural = Boolean(analysis.blinkDetected && (Date.now() - steadyStartTime) >= 150);

              if (isHeld400ms || isBlinkNatural) {
                triggered = true;
                playBiometricChime('captured');
                // Auto-capture rapid 3-frame burst (~100ms apart)
                const burst = await captureBurstFrames(videoRef.current, 3, 100);
                const clientMeshTelemetry = {
                  yaw: analysis.yaw || 0,
                  pitch: analysis.pitch || 0,
                  blinkDetected: Boolean(analysis.blinkDetected),
                  faceConfidence: analysis.faceConfidence || 0.98,
                  luminance: analysis.luminance || 100,
                  boundingBox: analysis.boundingBox || null
                };
                handleVerifyFace(burst, clientMeshTelemetry);
                return;
              }
            } else {
              steadyStartTime = null;
            }
          } catch (_) { }
        }
      }

      if (!triggered) {
        animId = requestAnimationFrame(checkFrame);
      }
    };

    animId = requestAnimationFrame(checkFrame);

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [checkinStep, sessionToken, activeChallenge]);

  // Callback ref guarantees video stream attaches the exact microsecond the DOM node mounts
  const attachVideoRef = (node) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      if (node.srcObject !== streamRef.current) {
        node.srcObject = streamRef.current;
      }
      node.play().catch((err) => console.warn('Camera play warning on attach:', err));
    }
  };

  const attachEnrollVideoRef = (node) => {
    enrollVideoRef.current = node;
    if (node && enrollStreamRef.current) {
      if (node.srcObject !== enrollStreamRef.current) {
        node.srcObject = enrollStreamRef.current;
      }
      node.play().catch((err) => console.warn('Enroll camera play warning on attach:', err));
    }
  };

  const fetchStudentData = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [dashRes, histRes, corrRes, tickRes, schedRes] = await Promise.allSettled([
        api.student.getDashboard(),
        api.student.getHistory(),
        api.student.getCorrections(),
        api.student.getFeedback(),
        api.attendance.getSchedule()
      ]);

      if (dashRes.status === 'fulfilled' && dashRes.value.success) {
        setDashboard(dashRes.value);
        const geoMode = dashRes.value?.geofence?.ble_mode;
        if (geoMode) {
          setActiveBleMode(geoMode);
          const upper = String(geoMode).toUpperCase();
          if (upper.includes('STRICT')) setEnforcementMode('STRICT');
          else if (upper.includes('SOFT')) setEnforcementMode('SOFT_ANCHOR');
          else setEnforcementMode('STANDBY');
        }
        const wardenUrl = dashRes.value?.geofence?.local_warden_url || dashRes.value?.geofence?.local_https_anchor_url;
        if (wardenUrl) setLocalWardenUrl(wardenUrl);
      }
      if (histRes.status === 'fulfilled' && histRes.value.success) setHistory(histRes.value.records || []);
      if (corrRes.status === 'fulfilled' && corrRes.value.success) setCorrections(corrRes.value.corrections || corrRes.value.requests || []);
      if (tickRes.status === 'fulfilled' && tickRes.value.success) setTickets(tickRes.value.tickets || tickRes.value.feedback || []);
      if (schedRes.status === 'fulfilled' && schedRes.value.success) {
        setScheduleStatus(schedRes.value.schedule || null);
        const schedMode = schedRes.value?.bluetoothEnforcementMode || schedRes.value?.ble_mode || schedRes.value?.schedule?.bluetoothEnforcementMode;
        if (schedMode) {
          setActiveBleMode(schedMode);
          const upper = String(schedMode).toUpperCase();
          if (upper.includes('STRICT')) setEnforcementMode('STRICT');
          else if (upper.includes('SOFT')) setEnforcementMode('SOFT_ANCHOR');
          else setEnforcementMode('STANDBY');
        }
        const wardenLan = schedRes.value?.wardenLanApiUrl || schedRes.value?.local_warden_url;
        if (wardenLan) setLocalWardenUrl(wardenLan);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to load student data');
    } finally {
      setLoading(false);
    }
  };

  // Check-In Step 1: Physical GPS & ESP32 BLE Beacon Verification
  const handleVerifyLocation = async () => {
    if (scheduleStatus?.enforced && !scheduleStatus.isOpen) {
      setCheckinError(scheduleStatus.message || 'Attendance window is currently closed.');
      setCheckinStep('failed');
      return;
    }

    const bleMode = dashboard?.geofence?.ble_mode || 'STRICT_REQUIRED';

    const isStrict = enforcementMode === 'STRICT' || bleMode === 'STRICT_REQUIRED' || bleMode === 'STRICT_LOCK' || bleMode === 'STRICT';

    // 1. Immediately launch Bluetooth scanner on user click tick to preserve WebKit transient user gesture
    const bleScanPromise = isStrict && !lanWifiTicket
      ? scanHostelBleBeacon({
        onProgress: (p) => setBleScanningStatus(p.message),
        timeSyncPacket: dashboard?.ble_time_sync_packet || dashboard?.schedule?.ble_time_sync_packet,
        localHttpsAnchorUrl: dashboard?.geofence?.local_https_anchor_url || null,
        clusterEndpoints: dashboard?.wifi_cluster_endpoints || []
      })
      : null;

    setCheckinStep('verifying_gps');
    setCheckinError(null);
    setGpsLiveAccuracy(null);
    setBleScanningStatus(null);
    setVerifiedBeaconInfo(null);
    setVerifiedWifiAnchor(null);

    try {
      // 2. Concurrently acquire Physical Device GPS Location
      const pos = await getNativeOrBrowserLocation({
        onProgress: (acc) => setGpsLiveAccuracy(acc),
        maxWaitMs: 3500,
        targetAccuracy: 25
      });

      // Save student live GPS coordinates for the radar map
      setStudentCoords({
        lat: pos.latitude,
        lng: pos.longitude,
        accuracy: pos.accuracy || 10
      });

      // Native Mock & Fake GPS Blocker Guard
      if (pos.isMockLocation || (pos.detectedSpoofApps && pos.detectedSpoofApps.length > 0) || (pos.detectedApps && pos.detectedApps.length > 0)) {
        const appsList = pos.detectedAppDetails && pos.detectedAppDetails.length > 0
          ? pos.detectedAppDetails
          : (pos.detectedSpoofApps || pos.detectedApps || []).map(p => ({ packageName: p, appName: p, isMockApp: true }));
        setSpoofModalData({
          apps: appsList,
          reasons: pos.mockReason ? [pos.mockReason] : ['Mock location provider active on device']
        });
        setShowSpoofModal(true);
        setCheckinError('Mock Location Detected: Fake GPS / mock provider is active on this device. Real hardware GPS is required.');
        setCheckinStep('failed');
        return;
      }

      // Layer 1 Check: Geofence Perimeter Verification
      const centerLat = Number(dashboard?.geofence?.latitude) || 26.140462;
      const centerLng = Number(dashboard?.geofence?.longitude) || 91.656606;
      const permittedRadius = Number(dashboard?.geofence?.radius_meters) || 150;

      const lat1 = centerLat * (Math.PI / 180);
      const lon1 = centerLng * (Math.PI / 180);
      const lat2 = pos.latitude * (Math.PI / 180);
      const lon2 = pos.longitude * (Math.PI / 180);
      const dLat = lat2 - lat1;
      const dLon = lon2 - lon1;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const clientDistance = Math.round(6371000 * c * 10) / 10;

      if (clientDistance > permittedRadius) {
        // Layer 1 Rejection: Outside the permitted geofence boundary circle
        setVerifiedDistance(clientDistance);
        setCheckinError(
          `Layer 1 Check Failed (Outside Geofence Perimeter): You are ${clientDistance}m away from the hostel center. Permitted boundary is ${permittedRadius}m. Please physically move inside the hostel campus boundary before proceeding.`
        );
        setCheckinStep('failed');
        return;
      }

      let bleProof = null;
      let isBleUnsupported = false;

      let pendingBeaconInfo = null;

      // Layer 2 Check: ESP32 Hardware Radio Anchor Range Verification (Inside Geofence)
      const iosAttestation = verifyGenuineIOSDevice(pos);
      const isIOSDevice = iosAttestation.isGenuineIOS || (typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)));

      const isStrict = enforcementMode === 'STRICT' || bleMode === 'STRICT_REQUIRED' || bleMode === 'STRICT_LOCK' || bleMode === 'STRICT';

      if (isStrict) {
        setCheckinStep('verifying_ble');
        setBleScanningStatus('Layer 2 Check: Mandatory ESP32 Hardware Beacon Scan (~15m line-of-sight)...');

        // Await the BLE scan result (MUST be powered ON, no Wi-Fi bypass allowed in STRICT mode)
        const bleRes = bleScanPromise ? await bleScanPromise : await scanHostelBleBeacon({
          onProgress: (p) => setBleScanningStatus(p.message),
          timeSyncPacket: dashboard?.ble_time_sync_packet || dashboard?.schedule?.ble_time_sync_packet,
          localHttpsAnchorUrl: dashboard?.geofence?.local_https_anchor_url || null,
          clusterEndpoints: dashboard?.wifi_cluster_endpoints || []
        });

        const hasValidBle = Boolean(
          bleRes &&
          bleRes.success &&
          (bleRes.rollingCode || bleRes.rawPayload || bleRes.compactVerified || bleRes.lanWifiTicket)
        );

        if (!hasValidBle) {
          // Hard Pre-Camera Block: ESP32 is powered OFF or unreachable
          setVerifiedBeaconInfo(null);
          setVerifiedWifiAnchor(null);

          let errorMsg = bleRes?.message;
          if (!errorMsg || bleRes?.reason === 'BLUETOOTH_API_UNSUPPORTED') {
            if (typeof window !== 'undefined' && window.location.protocol === 'http:' && !isNativeMobile()) {
              errorMsg = 'Google Chrome blocks Bluetooth on http:// web pages. Please tap "Download HostelGuard App" below to install the native app on your phone, which connects directly to the ESP32!';
            } else {
              errorMsg = 'STRICT LOCK BLOCKED: No ESP32 Hardware Beacon signal detected. Please turn on Bluetooth and stand within 15m of your floor\'s powered ESP32 anchor.';
            }
          }
          setCheckinError(errorMsg);
          setCheckinStep('failed');
          return; // DO NOT call /verify-location and NEVER open camera
        }

        bleProof = {
          beaconPublicId: bleRes.beaconPublicId,
          rawAnchorId: bleRes.rawAnchorId || bleRes.beaconPublicId,
          rawPayload: bleRes.rawPayload || null,
          rollingCode: bleRes.rollingCode,
          slot: bleRes.slot,
          compactVerified: bleRes.compactVerified || false,
          lanWifiTicket: bleRes.lanWifiTicket || null
        };
        pendingBeaconInfo = bleRes;
      } else if (bleMode === 'SOFT_ANCHOR' || enforcementMode === 'SOFT_ANCHOR') {
        // Soft Anchor: Optional scan for fast pass
        if (typeof navigator !== 'undefined' && navigator.bluetooth) {
          try {
            setBleScanningStatus('Scanning for nearby hostel beacon for fast-pass...');
            const bleRes = await scanHostelBleBeacon({ timeoutMs: 3000 });
            if (bleRes.success) {
              bleProof = {
                beaconPublicId: bleRes.beaconPublicId,
                rollingCode: bleRes.rollingCode,
                slot: bleRes.slot
              };
              pendingBeaconInfo = bleRes;
            }
          } catch (_) {
            // Soft anchor allows proceeding without BLE
          }
        } else if (isIOSDevice) {
          // Soft Anchor allows genuine iOS hardware attestation with photometric step-up challenge
          setBleScanningStatus('Layer 2 Check: iOS Adaptive Hardware Attestation...');
          bleProof = {
            channel: 'IOS_SILENT_HARDWARE_ATTESTED',
            method: 'IOS_SILENT_HARDWARE_ATTESTED',
            isIosSilentAttested: true,
            gpuRenderer: iosAttestation.gpuRenderer,
            altitude: pos.altitude ?? null,
            altitudeAccuracy: pos.altitudeAccuracy ?? null,
            accuracy: pos.accuracy ?? null,
            maxTouchPoints: iosAttestation.maxTouchPoints || 5
          };
        }
      }

      // If connected to authorized hostel Wi-Fi (e.g. AEC_Student_5.0), create a Wi-Fi physical anchor proof
      if (!bleProof && pos.connectedWifi && pos.connectedWifi.isConnected) {
        bleProof = {
          channel: 'HOSTEL_WIFI_VERIFIED',
          method: 'HOSTEL_WIFI_VERIFIED',
          ssid: pos.connectedWifi.ssid,
          bssid: pos.connectedWifi.bssid
        };
      }

      setCheckinStep('verifying_policy');

      const isSafari = typeof navigator !== 'undefined' && /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

      const res = await api.attendance.verifyLocation({
        roll_number: dashboard?.student?.roll_number || user?.username,
        latitude: pos.latitude,
        longitude: pos.longitude,
        accuracy: pos.accuracy || 10,
        is_mock_location: pos.isMockLocation || false,
        samples: pos.samples || [],
        ble_proof: bleProof,
        wifi_scan: pos.connectedWifi?.isConnected
          ? { status: 'SCAN_OK', bssids: [pos.connectedWifi.bssid], connectedSsid: pos.connectedWifi.ssid }
          : (pos.wifiScan || null),
        device_info: {
          ...(pos.device_info || {}),
          isIOS: isIOSDevice,
          isSafari,
          gpuRenderer: iosAttestation.gpuRenderer,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
          isMock: pos.isMockLocation || false,
          mockReason: pos.mockReason || null,
          detectedApps: pos.detectedApps || [],
          syntheticTelemetry: pos.syntheticTelemetry || false,
          connectedWifi: pos.connectedWifi || null
        }
      });

      if (res.success) {
        if (isStrict && res.bleVerified !== true && (!pendingBeaconInfo || !pendingBeaconInfo.success)) {
          setVerifiedBeaconInfo(null);
          setVerifiedWifiAnchor(null);
          setCheckinError('STRICT LOCK REJECTED: ESP32 Hardware Beacon cryptographic signature could not be verified by server. Camera is locked.');
          setCheckinStep('failed');
          return;
        }

        if (pendingBeaconInfo) {
          setVerifiedBeaconInfo(pendingBeaconInfo);
        }
        if (res.bleMatchStatus === 'VERIFIED_HOSTEL_WIFI_PROXIMITY' || res.wifiMatchStatus === 'MATCHED_HOSTEL_AP') {
          setVerifiedWifiAnchor('Floor Wi-Fi Anchor (Verified)');
        }

        setSessionToken(res.sessionToken || res.challengeToken);
        setVerifiedDistance(res.verifiedDistance || res.distanceMeters);
        if (res.activeChallenge) {
          setActiveChallenge(res.activeChallenge);
        }
        if (res.activeChallengeInstruction) {
          setActiveChallengeInstruction(res.activeChallengeInstruction);
        }
        setCheckinStep('gps_ok');
        // Auto open camera with resilient fallback
        setTimeout(() => startCamera(), 200);
      } else {
        setVerifiedBeaconInfo(null);
        setVerifiedWifiAnchor(null);
        const dist = res.distanceMeters ? ` (${Math.round(res.distanceMeters)}m away)` : '';
        setVerifiedDistance(res.distanceMeters || null);
        if (res?.detectedSpoofApps?.length > 0 || res?.detectedAppDetails?.length > 0 || res?.reason === 'MOCK_LOCATION_ACTIVE') {
          const appsList = res.detectedAppDetails && res.detectedAppDetails.length > 0
            ? res.detectedAppDetails
            : (res.detectedSpoofApps || []).map(p => ({ packageName: p, appName: p, isMockApp: true }));
          setSpoofModalData({
            apps: appsList,
            reasons: [res.message || 'Mock location app detected on device']
          });
          setShowSpoofModal(true);
        }
        setCheckinError(res.message || res.error || `Location rejected by hostel geofence policy${dist}.`);
        setCheckinStep('failed');
      }
    } catch (err) {
      setVerifiedBeaconInfo(null);
      setVerifiedWifiAnchor(null);
      if (err?.detectedSpoofApps?.length > 0 || err?.detectedAppDetails?.length > 0) {
        setSpoofModalData({
          apps: err.detectedAppDetails || err.detectedSpoofApps.map(p => ({ packageName: p, appName: p, isMockApp: true })),
          reasons: [err.message || 'Mock location detected']
        });
        setShowSpoofModal(true);
      }
      setCheckinError(err.message || 'Location verification rejected.');
      setCheckinStep('failed');
      fetchStudentData();
    }
  };

  // Check-In Step 2: Camera with Progressive Constraint Fallbacks
  const startCamera = async () => {
    try {
      let stream;
      try {
        // High-definition front camera profile for sharp Android facial embeddings
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'user' },
            width: { ideal: 1280, min: 640 },
            height: { ideal: 720, min: 480 }
          }
        });
      } catch (e1) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user' }
          });
        } catch (e2) {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
      }

      streamRef.current = stream;
      setCameraActive(true);
      setCheckinStep('camera_active');

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(console.warn);
      }
    } catch (err) {
      console.error('Camera access error:', err);
      setCheckinError('Could not access front camera. Please grant camera permission in your browser.');
      setCheckinStep('failed');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  // Facial Identity Enrollment Methods
  const startEnrollCamera = async () => {
    setEnrollError(null);
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'user' },
            width: { ideal: 1280, min: 640 },
            height: { ideal: 720, min: 480 }
          }
        });
      } catch (e1) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        } catch (e2) {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
      }
      enrollStreamRef.current = stream;
      if (enrollVideoRef.current) {
        enrollVideoRef.current.srcObject = stream;
        enrollVideoRef.current.play().catch(console.warn);
      }
    } catch (err) {
      console.error('Enroll camera error:', err);
      setEnrollError('Camera permission required. Please enable camera access in your mobile browser.');
    }
  };

  const stopEnrollCamera = () => {
    if (enrollStreamRef.current) {
      enrollStreamRef.current.getTracks().forEach((t) => t.stop());
      enrollStreamRef.current = null;
    }
  };

  const handleCaptureEnrollPhoto = async (angle = enrollActiveAngle) => {
    if (!enrollVideoRef.current) return;

    // 1. Capture uncropped clean 640x640 offscreen frame with full head & shoulder margins
    const base64 = captureCleanFrame(enrollVideoRef.current, 640);
    if (!base64) return;

    // 2. Client-side instant face pre-validation to ensure face was captured
    const analysis = await analyzeFaceFrame(enrollVideoRef.current, angle);
    if (!analysis.faceDetected) {
      setEnrollError('No clear face detected in snapped frame. Please position your face inside the circle and retry.');
      return;
    }
    setEnrollError(null);

    // Trigger visual shutter flash
    setFlashActive(true);
    setTimeout(() => setFlashActive(false), 180);

    let nextAngle = null;
    if (angle === 'FRONT') nextAngle = 'LEFT';
    else if (angle === 'LEFT') nextAngle = 'RIGHT';

    setEnrollPhotos((prev) => {
      const filtered = prev.filter((p) => p.angle !== angle);
      const updated = [...filtered, { angle, imageBase64: base64 }];

      // Play audio feedback chime
      if (updated.length >= 3) {
        playBiometricChime('completed');
      } else {
        playBiometricChime('captured');
      }

      return updated;
    });

    // Advance angle automatically for convenient 1-2-3 flow
    if (nextAngle) {
      setEnrollActiveAngle(nextAngle);
    }
  };

  // Real-time Hands-Free Head Pose Auto-Tracking Loop using MediaPipe FaceLandmarker
  useEffect(() => {
    let animId;
    let lastCheck = 0;

    const runPoseTracking = async (time) => {
      if (!showEnrollModal || !autoCaptureEnabled || enrollSubmitting) {
        return;
      }

      // If all 3 angles are already captured, stop auto-snapping
      if (enrollPhotos.length >= 3) {
        setPoseStatus({
          detected: true,
          ready: true,
          angle: 'DONE',
          progress: 100,
          label: '✓ All 3 Angles Captured! Click Save to Complete',
          instruction: '✓ All 3 Angles Captured! Click Save to Complete'
        });
        return;
      }

      // Sample every 80ms (~12.5 FPS)
      if (time - lastCheck > 80) {
        lastCheck = time;
        if (enrollVideoRef.current && !isAutoSnappingRef.current) {
          const analysis = await analyzeFaceFrame(enrollVideoRef.current, enrollActiveAngle);

          if (analysis.ready) {
            // Increment hold progress smoothly (~800ms to 100% at ~12.5 FPS: ~10% per tick)
            autoHoldProgressRef.current = Math.min(100, autoHoldProgressRef.current + 10);
            setPoseStatus({
              detected: true,
              ready: true,
              angle: enrollActiveAngle,
              yaw: analysis.yaw,
              pitch: analysis.pitch,
              luminance: analysis.luminance,
              progress: Math.round(autoHoldProgressRef.current),
              label: `Hold steady... (${Math.round(autoHoldProgressRef.current)}%)`,
              instruction: analysis.instruction
            });

            if (autoHoldProgressRef.current >= 100) {
              isAutoSnappingRef.current = true;
              await handleCaptureEnrollPhoto(enrollActiveAngle);
              autoHoldProgressRef.current = 0;

              // Brief cooldown so user can hear the chime and turn to the next angle comfortably
              setTimeout(() => {
                isAutoSnappingRef.current = false;
              }, 750);
            }
          } else {
            // Immediate reset to 0% if out of position
            autoHoldProgressRef.current = 0;
            setPoseStatus({
              detected: analysis.faceDetected,
              ready: false,
              angle: enrollActiveAngle,
              yaw: analysis.yaw,
              pitch: analysis.pitch,
              luminance: analysis.luminance,
              progress: 0,
              label: analysis.instruction || 'Align face inside oval',
              instruction: analysis.instruction
            });
          }
        }
      }

      animId = requestAnimationFrame(runPoseTracking);
    };

    if (showEnrollModal && autoCaptureEnabled) {
      autoHoldProgressRef.current = 0;
      isAutoSnappingRef.current = false;
      animId = requestAnimationFrame(runPoseTracking);
    }

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [showEnrollModal, autoCaptureEnabled, enrollActiveAngle, enrollSubmitting, enrollPhotos.length]);

  const handleSubmitFaceEnrollment = async () => {
    if (enrollPhotos.length === 0) {
      setEnrollError('Please capture at least one face photo (Front angle).');
      return;
    }
    setEnrollSubmitting(true);
    setEnrollError(null);
    try {
      const isReEnroll = Boolean(stats.hasFaceRegistered || dashboard?.student?.face_enrollment_status === 'ENROLLED');
      const res = await api.student.registerFace({
        photos: enrollPhotos,
        is_re_enrollment: isReEnroll
      });
      if (res.success) {
        setStatusMsg('Face profile successfully registered! You can now mark attendance.');
        stopEnrollCamera();
        setShowEnrollModal(false);
        setEnrollPhotos([]);
        setCheckinStep('idle');
        fetchStudentData();
      } else {
        setEnrollError(res.error || 'Failed to register face profile.');
      }
    } catch (err) {
      setEnrollError(err.message || 'Face enrollment failed. Ensure your face is centered with adequate lighting.');
    } finally {
      setEnrollSubmitting(false);
    }
  };

  // Request In-Person Physical Review (Graceful Fallback for Medical/Bandages/Broken Camera)
  const handleRequestPhysicalVerification = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!dashboard?.student?.id && !dashboard?.student?.roll_number) return;
    try {
      setPhysicalReviewSubmitting(true);
      setPhysicalReviewSuccess(null);
      const res = await api.attendance.requestPhysicalVerification({
        student_id: dashboard?.student?.id,
        roll_number: dashboard?.student?.roll_number,
        reason: physicalReviewReason,
        notes: physicalReviewNotes
      });
      setPhysicalReviewSubmitting(false);
      if (res.success) {
        setPhysicalReviewSuccess(res.message);
        setStatusMsg(res.message);
        fetchStudentData();
        setTimeout(() => {
          setShowPhysicalReviewModal(false);
          setPhysicalReviewSuccess(null);
        }, 3000);
      } else {
        setCheckinError(res.error || 'Failed to submit physical review request.');
      }
    } catch (err) {
      setPhysicalReviewSubmitting(false);
      setCheckinError(err.message || 'Error requesting physical verification.');
    }
  };

  // Check-In Step 3: Face Capture & Multi-Frame Biometric Matching
  const handleVerifyFace = async (burstFrames = null, clientTelemetry = null) => {
    if (!videoRef.current || !sessionToken) return;

    if (videoRef.current.readyState < 2) {
      setCheckinError('Camera is warming up. Please hold still and try again in a moment.');
      setCheckinStep('failed');
      return;
    }

    setCheckinStep('verifying_face');
    setCheckinError(null);
    setScanProgress(15);

    try {
      // Capture 3-frame burst if not already captured
      let frames = Array.isArray(burstFrames) && burstFrames.length > 0 ? burstFrames : null;
      if (!frames || frames.length === 0) {
        try {
          frames = await captureBurstFrames(videoRef.current, 3, 100);
        } catch (_) {
          frames = [];
        }
      }

      let livePhotoBase64 = frames && frames.length > 0 ? frames[0] : null;
      if (!livePhotoBase64) {
        livePhotoBase64 = captureCleanFrame(videoRef.current, 640);
      }

      const optimizedPayload = generateOptimizedBiometricPayload(videoRef.current, {
        boundingBox: clientTelemetry?.boundingBox || null
      });
      if (screenFlashEnabled) {
        setTimeout(() => setIsFlashing(false), 200);
      }

      const faceCrop112 = optimizedPayload?.faceCrop112 || null;
      const padCrop80 = optimizedPayload?.padCrop80 || null;

      setScanProgress(60);

      const res = await api.attendance.verifyFace({
        session_token: sessionToken,
        challenge_token: sessionToken,
        live_photo: livePhotoBase64,
        faceImage: livePhotoBase64,
        bleToken: verifiedBeaconInfo?.rawPayload || verifiedBeaconInfo?.token || verifiedBeaconInfo?.code || null,
        gpsCoords: verifiedDistance !== null ? { distance: verifiedDistance } : null,
        frames: frames,
        temporal_frames: frames,
        face_crop_112: faceCrop112,
        pad_crop_80: padCrop80,
        active_challenge: activeChallenge || 'HOLD_STILL',
        client_mesh_telemetry: clientTelemetry || null
      });

      setScanProgress(100);
      stopCamera();
      if (res.success) {
        setCheckinStep('success');
        setStatusMsg('Biometric attendance verified and recorded successfully!');
        fetchStudentData();
      } else {
        setCheckinError(res.error || 'Face verification failed.');
        setCheckinStep('failed');
      }
    } catch (err) {
      stopCamera();
      setCheckinError(err.message || 'Facial verification failed.');
      setCheckinStep('failed');
    }
  };

  // Submit Correction Form
  const handleSubmitCorrection = async (e) => {
    e.preventDefault();
    if (!correctionForm.reason.trim()) {
      setErrorMsg('Please specify a valid justification for the correction.');
      return;
    }
    setSubmittingCorrection(true);
    setErrorMsg(null);
    try {
      const res = await api.student.submitCorrection(correctionForm);
      setStatusMsg(res.message || 'Correction appeal submitted to warden/admin.');
      setCorrectionForm({ date: new Date().toISOString().split('T')[0], reason: '' });
      const corrRes = await api.student.getCorrections();
      if (corrRes?.success) setCorrections(corrRes.corrections || []);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to submit correction');
    } finally {
      setSubmittingCorrection(false);
    }
  };

  // Submit Support Ticket Form
  const handleSubmitTicket = async (e) => {
    e.preventDefault();
    if (!ticketForm.subject.trim() || !ticketForm.message.trim()) {
      setErrorMsg('Please fill in both subject and description.');
      return;
    }
    setSubmittingTicket(true);
    setErrorMsg(null);
    try {
      const res = await api.student.submitFeedback(ticketForm);
      setStatusMsg(res.message || 'Support ticket registered.');
      setTicketForm({ category: 'Hostel Facilities', subject: '', message: '' });
      const tickRes = await api.student.getFeedback();
      if (tickRes?.success) setTickets(tickRes.tickets || tickRes.feedback || []);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to submit ticket');
    } finally {
      setSubmittingTicket(false);
    }
  };

  // stats hoisted to top
  // todayStatus hoisted to top

  const getGreeting = (fullName) => {
    const hour = new Date().getHours();
    let tod = 'day';
    if (hour < 12) tod = 'morning';
    else if (hour < 17) tod = 'afternoon';
    else tod = 'evening';
    const firstName = fullName ? fullName.trim().split(' ')[0] : 'Resident';
    return `Good ${tod}, ${firstName}`;
  };

  const totalDays = stats.totalDaysRecorded || 0;
  const presentDays = stats.presentDays || 0;
  const absentDays = Math.max(0, totalDays - presentDays);
  // Hostel Day-Count Metrics (Month-to-Date Progress & 3-Tier State: Present vs Approved Leave vs Absent)
  const monthlyPresent = stats.monthlyPresent !== undefined ? stats.monthlyPresent : (stats.presentDays || 0);
  const monthlyLeave = stats.monthlyLeave !== undefined ? stats.monthlyLeave : 0;
  const monthlyAbsent = stats.monthlyAbsent !== undefined ? stats.monthlyAbsent : 0;
  const daysInMonth = stats.daysInMonth || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const daysElapsed = stats.daysElapsed || new Date().getDate();
  const daysRemaining = stats.daysRemaining !== undefined ? stats.daysRemaining : Math.max(0, daysInMonth - daysElapsed);
  const isOnTrack = stats.isOnTrack !== undefined ? stats.isOnTrack : (monthlyAbsent === 0);
  const currentMonthName = stats.currentMonthName || new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
  const currentMonthShort = currentMonthName.split(' ')[0];
  const monthlyHolidays = stats.monthlyHolidays || 0;

  const yearlyPresent = stats.yearlyPresent !== undefined ? stats.yearlyPresent : (stats.presentDays || 0);
  const yearlyLeave = stats.yearlyLeave !== undefined ? stats.yearlyLeave : 0;
  const yearlyAbsent = stats.yearlyAbsent !== undefined ? stats.yearlyAbsent : 0;
  const yearlyActiveDays = stats.yearlyActiveDays || (stats.daysInYear || 365) - (stats.yearlyHolidays || 0);
  const currentYear = stats.currentYear || new Date().getFullYear();
  const dayOfYear = stats.dayOfYear || 1;
  const daysInYear = stats.daysInYear || 365;
  const yearlyHolidays = stats.yearlyHolidays || 0;

  const totalPresentDays = stats.presentDays || 0;
  const totalLeaveDays = stats.leaveDays || 0;
  const totalAbsentDays = stats.absentDays !== undefined ? stats.absentDays : Math.max(0, (stats.totalDaysRecorded || 0) - totalPresentDays);
  const safetyAlert = stats.safetyAlert || dashboard?.safetyAlert || { consecutiveMissedNights: 0, isSafetyAlert: false };
  const monthlyBreakdown = dashboard?.monthlyBreakdown || [];
  const yearlySummary = dashboard?.yearlySummary || {};

  // Trend chart records
  const trendRecords = (history && history.length > 0) ? history.slice(0, 7).reverse() : [];
  const trendLabels = trendRecords.map(r => r.date ? r.date.slice(5) : '');
  const trendData = trendRecords.map(r => r.status === 'PRESENT' ? 100 : r.status === 'LATE' ? 75 : 0);

  return (
    <div className="container-fluid px-0">
      {/* Student Greeting & Summary Banner */}
      <div className="card hg-card bg-dark text-white border-secondary mb-3">
        <div className="card-body p-3">
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-3">
            <div>
              <div className="text-primary-subtle hg-text-xs fw-medium text-uppercase mb-1">
                {formatDateIST(new Date())}
              </div>
              <h4 className="fw-bold mb-1 text-white">
                {getGreeting(student.full_name || user?.username)}
              </h4>
              <div className="text-muted hg-text-xs">
                Roll No: <span className="text-light fw-medium hg-tabular">{student.roll_number || user?.username}</span> &bull; {student.hostel_block || 'Hostel'} &bull; Rm {student.room_number || 'N/A'} &bull; {student.course || 'Resident'}
              </div>
            </div>

            {/* Today's Roll Call Status Indicator */}
            <div className="d-flex align-items-center gap-2">
              <div
                className={`px-3 py-1.5 rounded-2 border ${
                  todayStatus.status === 'PRESENT'
                    ? 'bg-success bg-opacity-10 border-success text-success'
                    : 'bg-warning bg-opacity-10 border-warning text-warning'
                }`}
              >
                <div className="hg-text-xs fw-bold text-uppercase text-secondary mb-0.5">
                  Today's Status
                </div>
                <div className="fw-bold fs-6">
                  {todayStatus.status === 'PRESENT' ? 'PRESENT' : 'ATTENDANCE REQUIRED'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Consecutive Absence Safety Alert Banner */}
      {safetyAlert && safetyAlert.isSafetyAlert && (
        <div className="alert alert-danger d-flex align-items-center gap-2 mb-3 rounded-2" role="alert">
          <AlertTriangle size={20} className="flex-shrink-0 text-danger" />
          <div className="hg-text-xs">
            <strong>Hostel Welfare Alert:</strong> You have missed <strong className="hg-tabular">{safetyAlert.consecutiveMissedNights} consecutive roll calls</strong> without an approved gate pass or leave slip. Please meet your hostel warden or submit an attendance appeal to regularize your roll call status.
          </div>
        </div>
      )}

      {/* 4 Attendance Summary Metric Cards (MTD Progress & 3-Tier State) */}
      <div className="row g-2 mb-3">
        <div className="col-6 col-md-3">
          <div className="card hg-card p-2.5 bg-white h-100">
            <div className="d-flex justify-content-between align-items-center mb-1">
              <span className="text-muted hg-text-xs fw-medium">This Month's Presence</span>
              {isOnTrack ? (
                <span className="badge bg-success bg-opacity-10 text-success fw-bold hg-badge">On-Track</span>
              ) : (
                <span className="badge bg-danger bg-opacity-10 text-danger fw-bold hg-badge hg-tabular">{monthlyAbsent} Missed</span>
              )}
            </div>
            <div className="fw-bold fs-5 text-primary mt-1 hg-tabular">{monthlyPresent} Days Present</div>
            <div className="text-muted hg-text-xs hg-tabular">
              {monthlyPresent} of {daysElapsed} days passed · {daysRemaining} days remaining in {currentMonthShort}
            </div>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div className="card hg-card p-2.5 bg-white h-100">
            <div className="text-muted hg-text-xs fw-medium">Yearly Presence</div>
            <div className="fw-bold fs-5 text-success mt-1 hg-tabular">{yearlyPresent} / {yearlyActiveDays} Active Days</div>
            <div className="text-muted hg-text-xs hg-tabular">
              Day {dayOfYear} of {daysInYear} (Session {currentYear}) · {yearlyHolidays} holidays excl.
            </div>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div className="card hg-card p-2.5 bg-white h-100">
            <div className="text-muted hg-text-xs fw-medium">Approved Leaves / Passes</div>
            <div className="fw-bold fs-5 text-warning mt-1 hg-tabular">{monthlyLeave} Days ({currentMonthShort})</div>
            <div className="text-muted hg-text-xs hg-tabular">
              {totalLeaveDays} total lifetime official gate &amp; night-out passes
            </div>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div className="card hg-card p-2.5 bg-white h-100">
            <div className="text-muted hg-text-xs fw-medium">Unauthorized Missed</div>
            <div className={'fw-bold fs-5 mt-1 hg-tabular ' + (monthlyAbsent > 0 ? 'text-danger' : 'text-secondary')}>
              {monthlyAbsent} Days ({currentMonthShort})
            </div>
            <div className="text-muted hg-text-xs hg-tabular">
              {safetyAlert && safetyAlert.isSafetyAlert ? (
                <span className="text-danger fw-bold">{safetyAlert.consecutiveMissedNights} consecutive nights missed!</span>
              ) : (
                totalAbsentDays + ' total lifetime missed check-ins'
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Clean 7-Day Attendance Trend Chart (Requirement #7 & #21) */}
      {trendRecords.length > 0 && (
        <div className="card hg-card p-3 mb-3 bg-white">
          <div className="d-flex align-items-center justify-content-between mb-2">
            <div className="d-flex align-items-center gap-2">
              <Clock size={16} className="text-primary" />
              <span className="fw-semibold text-dark small">Recent Roll Call Trend</span>
            </div>
            <span className="badge bg-light text-muted small">Past {trendRecords.length} Sessions</span>
          </div>
          <div style={{ height: '110px' }}>
            <Line
              data={{
                labels: trendLabels,
                datasets: [{
                  label: 'Roll Call Status (Present / Absent)',
                  data: trendData,
                  borderColor: '#10b981',
                  backgroundColor: 'rgba(16, 185, 129, 0.08)',
                  fill: true,
                  tension: 0.35,
                  pointRadius: 4,
                  pointBackgroundColor: '#10b981'
                }]
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  y: { min: 0, max: 100, ticks: { callback: v => v === 100 ? 'Present' : v === 0 ? 'Absent' : '' }, grid: { display: false } },
                  x: { grid: { display: false } }
                },
                plugins: { legend: { display: false } }
              }}
            />
          </div>
        </div>
      )}

      {statusMsg && (
        <div className="alert alert-success d-flex align-items-center gap-2 alert-dismissible fade show mb-4" role="alert">
          <CheckCircle2 size={18} />
          <div>{statusMsg}</div>
          <button type="button" className="btn-close" onClick={() => setStatusMsg(null)}></button>
        </div>
      )}

      {errorMsg && (
        <div className="alert alert-danger d-flex align-items-center gap-2 alert-dismissible fade show mb-4" role="alert">
          <AlertTriangle size={18} />
          <div>{errorMsg}</div>
          <button type="button" className="btn-close" onClick={() => setErrorMsg(null)}></button>
        </div>
      )}

      {/* 1. Daily Attendance Tab */}
      {(activeTab === 'student_attendance' || !activeTab) && (
        <div className="row g-4 justify-content-center">
          <div className="col-lg-8">
            {/* Warning Banner if Facial Biometrics Not Yet Enrolled */}
            {dashboard && !isFaceEnrolled && (
              <div className="card border-warning border-opacity-50 bg-warning-subtle rounded-2 p-2.5 mb-3 text-start">
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                  <div className="d-flex align-items-center gap-2">
                    <AlertTriangle size={20} className="text-warning flex-shrink-0" />
                    <div>
                      <div className="fw-bold text-dark hg-text-xs">Facial Biometrics Not Registered</div>
                      <div className="hg-text-xs text-muted">Complete your 10-second facial identity enrollment to enable one-tap biometric attendance.</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-warning fw-semibold btn-sm px-2.5 text-dark d-inline-flex align-items-center gap-1"
                    onClick={() => {
                      setShowEnrollModal(true);
                      startEnrollCamera();
                    }}
                  >
                    <Camera size={14} /> Complete Face Registration (10s)
                  </button>
                </div>
              </div>
            )}

            <div className="card hg-card mb-3 overflow-hidden">
              <div className="card-header bg-white border-bottom py-2.5 px-3 d-flex justify-content-between align-items-center">
                <h6 className="card-title mb-0 fw-semibold d-flex align-items-center gap-2">
                  <UserCheck size={18} className="text-primary" />
                  Biometric Attendance Check-In
                </h6>
                <span className="badge bg-light text-dark border hg-badge">
                  {formatDateIST(new Date())}
                </span>
              </div>

              <div className="card-body p-3.5 text-center">
                {todayStatus.isMarkedToday ? (
                  /* Polished Confirmation Screen (Requirement #13) */
                  <div className="py-3 px-2">
                    <div className="d-inline-flex p-2.5 rounded-circle bg-success bg-opacity-10 text-success mb-2.5">
                      <CheckCircle2 size={44} />
                    </div>
                    <h5 className="fw-bold text-success mb-1">Attendance Marked</h5>
                    <p className="text-muted hg-text-xs mb-3">You are marked <strong className="text-success">PRESENT</strong> for today's roll call.</p>

                    <div className="card bg-light border rounded-2 p-2.5 mx-auto text-start" style={{ maxWidth: '380px' }}>
                      <div className="d-flex justify-content-between py-1.5 border-bottom">
                        <span className="text-muted small">Date</span>
                        <span className="fw-semibold text-dark small">{formatDateIST(new Date())}</span>
                      </div>
                      <div className="d-flex justify-content-between py-1.5 border-bottom">
                        <span className="text-muted small">Time Recorded</span>
                        <span className="fw-semibold text-dark small">{todayStatus.record?.time_marked ? formatTime12h(todayStatus.record?.time_marked) : '7:18 PM'}</span>
                      </div>
                      <div className="d-flex justify-content-between py-1.5 border-bottom">
                        <span className="text-muted small">Location</span>
                        <span className="fw-semibold text-success small d-flex align-items-center gap-1">
                          <Check size={14} /> Verified
                        </span>
                      </div>
                      <div className="d-flex justify-content-between py-1.5">
                        <span className="text-muted small">Identity</span>
                        <span className="fw-semibold text-success small d-flex align-items-center gap-1">
                          <Check size={14} /> Verified
                        </span>
                      </div>
                    </div>
                    <div className="text-muted small mt-3" style={{ fontSize: '11.5px' }}>
                      Attendance recorded successfully. Have a safe and restful evening.
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Clear 4-Step Attendance Workflow (Section 7) */}
                    <div className="d-flex align-items-center justify-content-center gap-2 mb-4 px-2 flex-wrap">
                      <div className={`d-flex align-items-center gap-1.5 px-3 py-1.5 rounded-pill small fw-semibold ${checkinStep === 'idle' || checkinStep === 'verifying_gps' ? 'bg-primary text-white shadow-sm' : 'bg-light text-muted'}`}>
                        <span>1</span>
                        <span>Location</span>
                      </div>
                      <span className="text-muted small d-none d-sm-inline">➔</span>
                      <div className={`d-flex align-items-center gap-1.5 px-3 py-1.5 rounded-pill small fw-semibold ${checkinStep === 'camera_active' ? 'bg-primary text-white shadow-sm' : 'bg-light text-muted'}`}>
                        <span>2</span>
                        <span>Identity</span>
                      </div>
                      <span className="text-muted small d-none d-sm-inline">➔</span>
                      <div className={`d-flex align-items-center gap-1.5 px-3 py-1.5 rounded-pill small fw-semibold ${checkinStep === 'verifying_face' ? 'bg-primary text-white shadow-sm' : 'bg-light text-muted'}`}>
                        <span>3</span>
                        <span>Verification</span>
                      </div>
                      <span className="text-muted small d-none d-sm-inline">➔</span>
                      <div className={`d-flex align-items-center gap-1.5 px-3 py-1.5 rounded-pill small fw-semibold ${checkinStep === 'success' ? 'bg-success text-white shadow-sm' : 'bg-light text-muted'}`}>
                        <span>4</span>
                        <span>Complete</span>
                      </div>
                    </div>
                    {/* Geofence Boundary & Live Radar Map */}
                    <div className="mb-4 text-start">
                      <div className="d-flex justify-content-between align-items-center mb-2 px-1">
                        <span className="fw-semibold small text-muted d-flex align-items-center gap-1">
                          <MapPin size={15} className="text-primary" /> Geofence Boundary & Live Radar
                        </span>
                        <button
                          type="button"
                          className="btn btn-link btn-sm p-0 text-decoration-none text-primary fw-medium"
                          onClick={() => setShowMapRadar(!showMapRadar)}
                        >
                          {showMapRadar ? 'Hide Map' : 'Show Map'}
                        </button>
                      </div>

                      {/* Active Enforcement Mode Badge */}
                      <div className="mb-2 text-start">
                        {enforcementMode === 'STRICT' ? (
                          <span className="badge bg-danger-subtle text-danger border border-danger-subtle px-2.5 py-1.5 rounded-pill d-inline-flex align-items-center gap-1.5 fw-semibold small">
                            <span className="spinner-grow spinner-grow-sm text-danger" style={{ width: '8px', height: '8px' }}></span>
                            Mode 3: STRICT LOCK (ESP32 BLE + Hostel Wi-Fi Mandatory)
                          </span>
                        ) : enforcementMode === 'SOFT_ANCHOR' ? (
                          <span className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle px-2.5 py-1.5 rounded-pill d-inline-flex align-items-center gap-1.5 fw-semibold small">
                            <span className="badge bg-warning rounded-circle p-1"></span>
                            Mode 2: Soft Anchor (BLE or Screen-Flash Face)
                          </span>
                        ) : (
                          <span className="badge bg-secondary-subtle text-secondary border border-secondary-subtle px-2.5 py-1.5 rounded-pill d-inline-flex align-items-center gap-1.5 fw-semibold small">
                            <span className="badge bg-secondary rounded-circle p-1"></span>
                            Mode 1: Standby (GPS + Face)
                          </span>
                        )}
                      </div>

                      {showMapRadar && (
                        <GeofenceMap
                          centerLat={dashboard?.geofence?.latitude || 28.5355}
                          centerLng={dashboard?.geofence?.longitude || 77.3910}
                          radius={dashboard?.geofence?.radius_meters || 20}
                          locationName={dashboard?.geofence?.hostel_name || 'Hostel Campus Boundary'}
                          studentLat={studentCoords?.lat || null}
                          studentLng={studentCoords?.lng || null}
                          gpsAccuracy={studentCoords?.accuracy || null}
                          height="290px"
                          showLegend={true}
                          showDistanceBanner={true}
                          beacons={dashboard?.beacons || []}
                          bleMode={enforcementMode === 'STRICT' ? 'STRICT_LOCK' : (dashboard?.geofence?.ble_mode || 'STANDBY_OPTIONAL')}
                          isBeaconDetected={Boolean(verifiedBeaconInfo)}
                          verifiedBeacon={verifiedBeaconInfo}
                        />
                      )}
                    </div>

                    {/* Real-World Attendance Window Status Banner */}
                    <div className="mb-4 text-start">
                      {scheduleStatus?.isHoliday ? (
                        <div className="alert alert-info border-info-subtle d-flex align-items-center gap-3 p-3 rounded-3 shadow-sm mb-0">
                          <Sparkles size={24} className="text-info flex-shrink-0" />
                          <div>
                            <div className="fw-bold text-dark">Today is a Campus Holiday: {scheduleStatus.title || 'Exempt'}</div>
                            <div className="small text-muted">{scheduleStatus.notes || 'Attendance check-in is suspended/exempt for today. Enjoy your day!'}</div>
                          </div>
                        </div>
                      ) : scheduleStatus?.enforced ? (
                        scheduleStatus.isOpen ? (
                          <div className="p-3 rounded-3 border border-success-subtle bg-success-subtle shadow-sm">
                            <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                              <div className="d-flex align-items-center gap-2">
                                <span className="spinner-grow spinner-grow-sm text-success" style={{ width: '9px', height: '9px' }} />
                                <span className="fw-bold text-success">
                                  Attendance Window is OPEN NOW ({scheduleStatus.startTime12} – {scheduleStatus.endTime12})
                                </span>
                              </div>
                              <span className="badge bg-success text-white px-2.5 py-1">
                                {scheduleStatus.remainingMinutes} min remaining
                              </span>
                            </div>
                            <div className="small text-dark text-opacity-75 mt-1">
                              {scheduleStatus.notes || `Please submit your GPS and facial identity verification before ${scheduleStatus.endTime12}.`}
                            </div>
                          </div>
                        ) : (
                          <div className="p-3 rounded-3 border border-warning-subtle bg-warning-subtle shadow-sm">
                            <div className="d-flex align-items-center gap-2 mb-1">
                              <Clock size={16} className="text-warning flex-shrink-0" />
                              <span className="fw-bold text-dark">
                                Attendance Window is Currently Closed
                              </span>
                              <span className="badge bg-warning text-dark ms-auto">
                                {scheduleStatus.startsInMinutes ? `Opens in ${scheduleStatus.startsInMinutes} min` : 'Window Closed'}
                              </span>
                            </div>
                            <div className="small text-muted">
                              {scheduleStatus.message || `Scheduled attendance hours: ${scheduleStatus.startTime12 || '7:00 PM'} to ${scheduleStatus.endTime12 || '7:30 PM'}.`}
                            </div>
                          </div>
                        )
                      ) : (
                        <div className="p-2.5 rounded-3 bg-light border text-muted small d-flex align-items-center gap-2">
                          <Clock size={14} className="text-primary" />
                          <span>Attendance Time Window: 24/7 Open (Admin enforcement off)</span>
                        </div>
                      )}
                    </div>

                    {/* Check-In Progress State */}
                    {checkinStep === 'idle' && (
                      <div className="py-2">
                        {scheduleStatus?.isHoliday ? (
                          <div className="py-3 text-center">
                            <Sparkles size={44} className="text-info mb-2" />
                            <h5 className="fw-bold text-dark">Attendance Exempt for Today</h5>
                            <p className="text-muted small mb-0">No roll call required due to the scheduled campus event or holiday.</p>
                          </div>
                        ) : scheduleStatus?.enforced && !scheduleStatus?.isOpen ? (
                          <div>
                            <h5 className="fw-bold mb-1 text-muted">Attendance Not Currently Available</h5>
                            <p className="text-muted small mx-auto mb-3" style={{ maxWidth: '440px' }}>
                              Available today: <strong>{scheduleStatus.startTime12 || '7:00 PM'} – {scheduleStatus.endTime12 || '7:30 PM'}</strong>
                            </p>
                            <button
                              className="btn btn-secondary px-4 py-2.5 fw-semibold d-inline-flex align-items-center gap-2 shadow-sm rounded-3"
                              disabled
                              title="Attendance window is currently closed"
                            >
                              <Clock size={18} /> Attendance Opens at {scheduleStatus.startTime12 || '7:00 PM'}
                            </button>
                          </div>
                        ) : (
                          <div>
                            {dashboard?.geofence?.ble_mode === 'STRICT_REQUIRED' && (
                              <div className="alert alert-danger d-flex align-items-center gap-2 p-2.5 rounded-3 mb-3 text-start small border-danger-subtle mx-auto" style={{ maxWidth: '480px' }}>
                                <ShieldCheck size={18} className="text-danger flex-shrink-0" />
                                <div>
                                  <strong>Strict Hardware Lock Enforced:</strong> Physical presence near an authorized hostel ESP32 Bluetooth beacon ({activeBeaconList}) + GPS boundary required.
                                </div>
                              </div>
                            )}
                            {dashboard?.geofence?.ble_mode === 'SOFT_ANCHOR' && (
                              <div className="alert alert-warning d-flex align-items-center gap-2 p-2.5 rounded-3 mb-3 text-start small border-warning-subtle mx-auto" style={{ maxWidth: '480px' }}>
                                <Radio size={18} className="text-warning flex-shrink-0" />
                                <div>
                                  <strong>Smart Proximity Active:</strong> Detect nearby ESP32 beacon for instant fast-pass attendance.
                                </div>
                              </div>
                            )}
                            {verifiedBeaconInfo && (
                              <div className="alert alert-success d-flex align-items-center gap-2 p-2.5 rounded-3 mb-3 text-start small border-success-subtle mx-auto" style={{ maxWidth: '480px' }}>
                                <CheckCircle2 size={18} className="text-success flex-shrink-0" />
                                <div>
                                  <strong>ESP32 Radio Anchor Linked:</strong> Signal verified from <code>{verifiedBeaconInfo.beaconPublicId}</code>
                                </div>
                              </div>
                            )}
                            {/* Live 3-Step Visual Progress Bar Above the Button */}
                            <div className="d-flex align-items-center justify-content-center gap-1.5 mb-3.5 flex-wrap mx-auto" style={{ maxWidth: '480px' }}>
                              <div className={`px-2.5 py-1 rounded-pill small fw-semibold d-inline-flex align-items-center gap-1 border ${getStepStatus(1) === 'done' ? 'bg-success text-white border-success shadow-xs' : (getStepStatus(1) === 'active' ? 'bg-primary text-white border-primary shadow-sm' : 'bg-light text-secondary border-secondary border-opacity-25')}`} style={{ fontSize: '11.5px' }}>
                                {getStepStatus(1) === 'done' ? <CheckCircle2 size={12} /> : (getStepStatus(1) === 'active' ? <RefreshCw size={12} className="spin" /> : <span>1</span>)}
                                <span>Hostel Location</span>
                              </div>

                              <span className="text-muted small">&rarr;</span>

                              <div className={`px-2.5 py-1 rounded-pill small fw-semibold d-inline-flex align-items-center gap-1 border ${getStepStatus(2) === 'done' ? 'bg-success text-white border-success shadow-xs' : (getStepStatus(2) === 'active' ? 'bg-primary text-white border-primary shadow-sm' : 'bg-light text-secondary border-secondary border-opacity-25')}`} style={{ fontSize: '11.5px' }}>
                                {getStepStatus(2) === 'done' ? <CheckCircle2 size={12} /> : (getStepStatus(2) === 'active' ? <RefreshCw size={12} className="spin" /> : <span>2</span>)}
                                <span>Floor Box Signal</span>
                              </div>

                              <span className="text-muted small">&rarr;</span>

                              <div className={`px-2.5 py-1 rounded-pill small fw-semibold d-inline-flex align-items-center gap-1 border ${getStepStatus(3) === 'done' ? 'bg-success text-white border-success shadow-xs' : (getStepStatus(3) === 'active' ? 'bg-primary text-white border-primary shadow-sm' : 'bg-light text-secondary border-secondary border-opacity-25')}`} style={{ fontSize: '11.5px' }}>
                                {getStepStatus(3) === 'done' ? <CheckCircle2 size={12} /> : (getStepStatus(3) === 'active' ? <RefreshCw size={12} className="spin" /> : <span>3</span>)}
                                <span>Face Check</span>
                              </div>

                              {/* Offline Voice Guide Toggle */}
                              <button
                                type="button"
                                className={`btn btn-sm py-0.5 px-2 rounded-pill d-inline-flex align-items-center gap-1 ms-1 border ${voiceGuideEnabled ? 'btn-outline-primary' : 'btn-outline-secondary'}`}
                                onClick={toggleVoiceGuide}
                                title={voiceGuideEnabled ? 'Voice Guidance is ON' : 'Voice Guidance is OFF'}
                                style={{ fontSize: '11px' }}
                              >
                                <Volume2 size={12} />
                                <span>{voiceGuideEnabled ? 'Voice ON' : 'Voice OFF'}</span>
                              </button>
                            </div>

                            <h5 className="fw-bold mb-1">Confirm Your Hostel Location</h5>
                            <p className="text-muted small mx-auto mb-3" style={{ maxWidth: '440px' }}>
                              Please verify your device is inside the hostel attendance area to start verification.
                            </p>
                            <button
                              className="btn btn-primary px-4 py-2.5 fw-semibold d-inline-flex align-items-center gap-2 shadow-sm rounded-3"
                              onClick={handleVerifyLocation}
                            >
                              <Navigation size={18} /> ✓ Mark Attendance
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {checkinStep === 'verifying_gps' && (
                      <div className="py-4 text-center">
                        <div className="spinner-border text-primary mb-3" role="status"></div>
                        <h6 className="fw-semibold mb-1">Confirming GPS Location...</h6>
                        <p className="text-muted small">
                          Verifying that you are physically inside the hostel attendance perimeter.
                        </p>
                      </div>
                    )}

                    {checkinStep === 'verifying_ble' && (
                      <div className="py-4 text-center">
                        <div className="position-relative d-inline-block mb-3">
                          <div className="spinner-grow text-primary" style={{ width: '3.2rem', height: '3.2rem', opacity: 0.25 }}></div>
                          <Bluetooth size={26} className="text-primary position-absolute top-50 start-50 translate-middle" />
                        </div>
                        <h6 className="fw-semibold mb-1">Connecting to Hostel ESP32 Beacon...</h6>
                        <p className="text-muted small mb-2 mx-auto" style={{ maxWidth: '420px' }}>
                          {bleScanningStatus || `Strict Hardware Lock active: Please select your floor beacon (${activeBeaconList}) in the browser dialog.`}
                        </p>
                        <span className="badge bg-danger bg-opacity-10 text-danger border border-danger-subtle px-3 py-1 rounded-pill small">
                          <ShieldCheck size={13} className="me-1" /> Physical Presence Required
                        </span>
                      </div>
                    )}

                    {checkinStep === 'verifying_policy' && (
                      <div className="py-4 text-center">
                        <div className="spinner-border text-primary mb-3" role="status"></div>
                        <h6 className="fw-semibold mb-1">Validating Anti-Spoof Policy & Hardware Token...</h6>
                        <p className="text-muted small">
                          Cryptographically checking GPS perimeter and ESP32 30-second rolling HMAC proof.
                        </p>
                      </div>
                    )}

                    {(checkinStep === 'camera_active' || checkinStep === 'verifying_face') && (
                      <div className="py-2 text-center">
                        <div className="mb-3">
                          <h5 className="fw-bold mb-1">
                            {activeChallenge === 'TURN_LEFT'
                              ? 'Turn Head Slightly Left (~15°)'
                              : activeChallenge === 'TURN_RIGHT'
                              ? 'Turn Head Slightly Right (~15°)'
                              : activeChallenge === 'NOD_DOWN'
                              ? 'Tilt Chin Downward'
                              : 'Hold Steady & Face Camera'}
                          </h5>
                          <div className="d-inline-flex align-items-center gap-1.5 px-3 py-1 rounded-pill bg-primary bg-opacity-10 text-primary small fw-semibold mt-1">
                            <Sparkles size={13} />
                            <span>{activeChallengeInstruction || 'Position face within oval and look directly at camera'}</span>
                          </div>
                        </div>

                        {/* Clean Minimalist Face ID Viewport */}
                        <div className="hg-faceid-viewport mx-auto mb-3">
                          <video
                            ref={attachVideoRef}
                            autoPlay
                            playsInline
                            muted
                            controls={false}
                            style={{
                              width: '100%',
                              height: 'auto',
                              minHeight: '320px',
                              maxHeight: '400px',
                              objectFit: 'cover',
                              transform: 'scaleX(-1)',
                              display: 'block',
                              backgroundColor: '#000'
                            }}
                            onLoadedMetadata={(e) => {
                              e.target.play().catch(console.warn);
                            }}
                          />

                          {/* 4 Sleek Corner Brackets [ ] */}
                          <div className="hg-faceid-corner hg-faceid-corner-tl" />
                          <div className="hg-faceid-corner hg-faceid-corner-tr" />
                          <div className="hg-faceid-corner hg-faceid-corner-bl" />
                          <div className="hg-faceid-corner hg-faceid-corner-br" />

                          {/* Soft Scanning Sheen (Only active while verifying) */}
                          {checkinStep === 'verifying_face' && (
                            <div className="hg-faceid-scan-sheen" />
                          )}

                          {/* Top Subtle Status Badge */}
                          <div className="hg-faceid-status-badge">
                            <span
                              className={`spinner-grow spinner-grow-sm ${checkinStep === 'verifying_face' ? 'text-info' : 'text-success'}`}
                              role="status"
                              style={{ width: '7px', height: '7px' }}
                            />
                            <span>{checkinStep === 'verifying_face' ? 'SCANNING BIOMETRICS' : 'FACE ID READY'}</span>
                          </div>

                          {/* SVG Vignette Mask & Clean Dashed Alignment Oval (NO fake facial drawings!) */}
                          <svg className="hg-faceid-overlay" viewBox="0 0 100 120" preserveAspectRatio="none">
                            <defs>
                              <mask id="hgFaceVignette">
                                <rect width="100" height="120" fill="white" />
                                <ellipse cx="50" cy="58" rx="28" ry="38" fill="black" />
                              </mask>
                              <filter id="hgOvalGlow" x="-20%" y="-20%" width="140%" height="140%">
                                <feGaussianBlur stdDeviation="0.8" result="blur" />
                                <feComposite in="SourceGraphic" in2="blur" operator="over" />
                              </filter>
                            </defs>

                            {/* Soft Translucent Dark Vignette Outside Oval */}
                            <rect width="100" height="120" fill="rgba(11, 17, 32, 0.42)" mask="url(#hgFaceVignette)" />

                            {/* Elegant Dashed Silhouette Oval */}
                            <ellipse
                              cx="50"
                              cy="58"
                              rx="28"
                              ry="38"
                              fill="none"
                              stroke={checkinStep === 'verifying_face' ? '#38bdf8' : '#34d399'}
                              strokeWidth="1.4"
                              strokeDasharray="3,3"
                              filter="url(#hgOvalGlow)"
                              className="hg-faceid-oval"
                            />
                          </svg>
                        </div>

                        {/* Below Viewport: Progress / Actions */}
                        {checkinStep === 'verifying_face' ? (
                          <div className="mx-auto text-center mb-3" style={{ maxWidth: '340px' }}>
                            <div className="d-flex align-items-center justify-content-between mb-1.5 px-1">
                              <span className="fw-semibold text-primary small d-flex align-items-center gap-1.5">
                                <Sparkles size={14} className="text-primary" /> Scanning
                              </span>
                              <span className="fw-bold font-monospace text-primary" style={{ fontSize: '13px' }}>
                                {scanProgress}%
                              </span>
                            </div>
                            <div className="progress rounded-pill bg-light" style={{ height: '7px' }}>
                              <div
                                className="progress-bar rounded-pill"
                                role="progressbar"
                                style={{
                                  width: `${scanProgress}%`,
                                  background: 'linear-gradient(90deg, #06b6d4 0%, #3b82f6 100%)',
                                  transition: 'width 0.2s ease'
                                }}
                              />
                            </div>
                            <div className="text-muted small mt-2" style={{ fontSize: '11.5px' }}>
                              Matching 128-D neural embeddings &bull; Hold steady
                            </div>
                          </div>
                        ) : (
                          <div className="text-center mb-3">
                            <div className="d-flex justify-content-center gap-2 mb-3">
                              <button
                                type="button"
                                className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-1.5 rounded-pill px-3 py-1.5 shadow-sm"
                                onClick={() => {
                                  if (videoRef.current && streamRef.current) {
                                    videoRef.current.srcObject = streamRef.current;
                                    videoRef.current.play().catch(console.warn);
                                  } else {
                                    startCamera();
                                  }
                                }}
                              >
                                <RefreshCw size={12} /> Reload Feed
                              </button>
                            </div>
                            <div className="text-muted small mb-2" style={{ fontSize: '12px' }}>
                              <Sparkles size={12} className="text-success me-1 d-inline" />
                              Blink naturally to auto-verify, or tap button below
                            </div>
                            <div>
                              <button
                                className="btn btn-success px-4 py-2.5 fw-semibold d-inline-flex align-items-center gap-2 rounded-3 shadow"
                                style={{
                                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                  border: 'none',
                                  fontSize: '14px',
                                  minWidth: '220px',
                                  justifyContent: 'center'
                                }}
                                onClick={handleVerifyFace}
                              >
                                <Camera size={18} /> Verify Identity Now
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {checkinStep === 'success' && (
                      <div className="py-4 px-2 text-center">
                        {/* Circular Glowing Success Badge */}
                        <div
                          className="d-inline-flex p-3 rounded-circle text-success mb-2 shadow-sm"
                          style={{
                            background: 'rgba(16, 185, 129, 0.1)',
                            border: '2px solid rgba(16, 185, 129, 0.3)'
                          }}
                        >
                          <CheckCircle2 size={48} className="text-success" />
                        </div>
                        <h4 className="fw-bold text-dark mb-1">Successful!</h4>
                        <p className="text-muted small mb-4" style={{ maxWidth: '320px', margin: '0 auto 1.5rem auto' }}>
                          ID Confirmed &bull; Attendance Recorded
                        </p>

                        {/* Modern Identity Summary Card */}
                        <div
                          className="card hg-card p-3 mx-auto text-start mb-3"
                          style={{ maxWidth: '360px' }}
                        >
                          <div className="d-flex align-items-center gap-3 pb-3 mb-3 border-bottom">
                            <div
                              className="rounded-circle bg-primary bg-opacity-10 text-primary fw-bold d-flex align-items-center justify-content-center shadow-sm"
                              style={{ width: '48px', height: '48px', fontSize: '18px' }}
                            >
                              {(dashboard?.student?.full_name || user?.username || 'S')[0].toUpperCase()}
                            </div>
                            <div className="flex-grow-1">
                              <h6 className="fw-bold mb-0 text-dark" style={{ fontSize: '14.5px' }}>
                                {dashboard?.student?.full_name || 'Verified Student'}
                              </h6>
                              <div className="text-muted font-monospace small" style={{ fontSize: '11.5px' }}>
                                Roll No: {dashboard?.student?.roll_number || user?.username}
                              </div>
                            </div>
                            <span className="badge bg-success bg-opacity-15 text-success border border-success border-opacity-25 py-1 px-2.5 rounded-pill" style={{ fontSize: '11px' }}>
                              ✓ PRESENT
                            </span>
                          </div>

                          <div className="d-flex justify-content-between py-1.5 border-bottom" style={{ fontSize: '12px' }}>
                            <span className="text-muted">Hostel Room:</span>
                            <span className="fw-semibold text-dark">
                              {dashboard?.student?.hostel_block || 'Hostel Campus'} &bull; Rm {dashboard?.student?.room_number || '-'}
                            </span>
                          </div>
                          <div className="d-flex justify-content-between py-1.5 border-bottom" style={{ fontSize: '12px' }}>
                            <span className="text-muted">Time Recorded:</span>
                            <span className="fw-semibold text-dark font-monospace">
                              {getCurrentTimeIST12h()}
                            </span>
                          </div>
                          <div className="d-flex justify-content-between py-1.5" style={{ fontSize: '12px' }}>
                            <span className="text-muted">Biometric Match:</span>
                            <span className="fw-semibold text-success d-flex align-items-center gap-1">
                              <Check size={13} /> Verified (YuNet + SFace)
                            </span>
                          </div>
                        </div>

                        <div className="mx-auto" style={{ maxWidth: '360px' }}>
                          <button
                            type="button"
                            className="btn btn-primary w-100 py-2.5 rounded-3 fw-semibold shadow-sm"
                            style={{
                              background: 'linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)',
                              border: 'none',
                              fontSize: '13.5px'
                            }}
                            onClick={() => {
                              setCheckinStep('idle');
                              fetchStudentData();
                            }}
                          >
                            Done &bull; Return to Portal
                          </button>
                        </div>
                      </div>
                    )}

                    {checkinStep === 'failed' && (() => {
                      const translated = translateErrorForStudent(checkinError);
                      const errLower = (checkinError || '').toLowerCase();
                      const isEnrollError = errLower.includes('face profile') || errLower.includes('enroll') || errLower.includes('onboarding');
                      const isLockError = errLower.includes('strike lockout') || errLower.includes('account locked');
                      const isBle = errLower.includes('beacon') || errLower.includes('bluetooth') || errLower.includes('esp32');

                      return (
                        <div className="py-4 text-center">
                          <AlertTriangle size={50} className="text-danger mb-2.5" />
                          <div className="d-flex align-items-center justify-content-center gap-2 mb-2">
                            <span className="badge bg-danger bg-opacity-10 text-danger border border-danger-subtle px-2.5 py-1 rounded-pill small fw-semibold">
                              {translated.badge}
                            </span>
                            <h5 className="fw-bold text-dark mb-0">{translated.title}</h5>
                          </div>

                          <div className="card bg-light border p-3.5 rounded-3 mb-3 text-start shadow-xs mx-auto" style={{ maxWidth: '460px' }}>
                            <div className="small text-dark mb-2 fw-medium" style={{ fontSize: '13px', lineHeight: '1.45' }}>
                              {translated.fix}
                            </div>

                            {checkinError && typeof checkinError === 'string' && checkinError !== translated.fix && (
                              <div className="text-secondary small px-2.5 py-1.5 mb-2 bg-white rounded border border-secondary border-opacity-25" style={{ fontSize: '11px', wordBreak: 'break-word', lineHeight: '1.35' }}>
                                <span className="fw-semibold text-dark">Server Diagnostics:</span> {checkinError}
                              </div>
                            )}

                            {translated.bullets && translated.bullets.length > 0 && (
                              <div className="p-2.5 rounded bg-white border border-secondary border-opacity-25 mt-1">
                                <div className="fw-bold text-dark small mb-1.5 d-flex align-items-center gap-1" style={{ fontSize: '12px' }}>
                                  💡 How to fix this in 10 seconds:
                                </div>
                                <ul className="mb-0 ps-3 small text-secondary" style={{ fontSize: '12px', lineHeight: '1.45' }}>
                                  {translated.bullets.map((b, idx) => (
                                    <li key={idx} className="mb-1">{b}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>

                          {/* Action Buttons & 1-Tap Recovery */}
                          <div className="d-flex flex-column align-items-center gap-2 mx-auto" style={{ maxWidth: '460px' }}>
                            {isEnrollError ? (
                              <button
                                type="button"
                                className="btn btn-warning px-4 py-2.5 fw-bold d-inline-flex align-items-center justify-content-center gap-2 shadow-sm text-dark w-100"
                                onClick={() => {
                                  setShowEnrollModal(true);
                                  startEnrollCamera();
                                }}
                              >
                                <Camera size={18} /> Enroll Face Identity (10s)
                              </button>
                            ) : isLockError ? (
                              <button
                                type="button"
                                className="btn btn-outline-danger px-4 py-2.5 fw-semibold d-inline-flex align-items-center justify-content-center gap-2 shadow-sm w-100"
                                onClick={() => {
                                  if (onSelectTab) onSelectTab('student_support');
                                  setTicketForm({
                                    category: 'ATTENDANCE',
                                    subject: `Strike Reset Appeal - Roll ${student?.roll_number || user?.username}`,
                                    message: 'My check-in triggered a strike lockout. Please reset my strikes in the Security Incident Desk so I can complete roll call.'
                                  });
                                }}
                              >
                                <LifeBuoy size={16} /> Submit Strike Appeal to Warden
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-primary px-4 py-2.5 fw-bold d-inline-flex align-items-center justify-content-center gap-2 shadow-sm rounded-3 w-100"
                                onClick={handleVerifyLocation}
                              >
                                <RefreshCw size={16} /> 🔄 Try Again
                              </button>
                            )}

                            <button
                              type="button"
                              className="btn btn-outline-secondary px-4 py-2 fw-semibold d-inline-flex align-items-center justify-content-center gap-2 shadow-sm rounded-3 w-100 mt-1"
                              onClick={() => setShowPhysicalReviewModal(true)}
                            >
                              <UserCheck size={16} /> Request In-Person Physical Verification
                            </button>

                            {/* iOS Safari Guidance if BLE failed on Safari */}
                            {isBle && isSafariOnIOS && (
                              <div className="card border p-3 rounded-3 mt-1 text-center bg-white shadow-xs w-100">
                                <span className="small text-muted mb-2 d-block">Apple Safari blocks Bluetooth. Open in Bluefy Browser:</span>
                                <a
                                  href={`bluefy://open?url=${encodeURIComponent(typeof window !== 'undefined' ? window.location.href : '')}`}
                                  className="btn btn-primary btn-sm fw-semibold d-flex align-items-center justify-content-center gap-1.5 py-2 mb-2"
                                >
                                  <ExternalLink size={14} /> Open in Bluefy Browser
                                </a>
                                {bluefyQrUrl && (
                                  <img
                                    src={bluefyQrUrl}
                                    alt="Scan QR for Bluefy"
                                    style={{ width: '100px', height: '100px', margin: '0 auto', borderRadius: '6px' }}
                                  />
                                )}
                              </div>
                            )}

                            {/* Android App Recommendation for Browser Users */}
                            {!isNativeMobile() && (
                              <div className="card bg-white border p-3 rounded-3 text-start shadow-xs w-100 mt-1">
                                <div className="fw-bold text-dark d-flex align-items-center gap-1.5 mb-1" style={{ fontSize: '12.5px' }}>
                                  <Download size={15} className="text-primary" /> Recommended: Install Signed Android App
                                </div>
                                <div className="text-muted small mb-2" style={{ fontSize: '11.5px', lineHeight: '1.4' }}>
                                  The native Android app connects directly to the floor ESP32 without any browser restrictions.
                                </div>
                                <a
                                  href="/downloads/hostelguard.apk"
                                  download="hostelguard.apk"
                                  className="btn btn-dark btn-sm fw-bold py-2 shadow-sm d-flex align-items-center justify-content-center gap-2 w-100 mb-2"
                                >
                                  <Download size={14} /> Download HostelGuard App (Signed APK)
                                </a>
                                <details className="text-muted small">
                                  <summary className="fw-semibold text-primary cursor-pointer" style={{ fontSize: '11.5px' }}>
                                    Testing inside Google Chrome? (30s fix)
                                  </summary>
                                  <div className="p-2 mt-1 rounded bg-light border border-secondary border-opacity-25 text-dark" style={{ fontSize: '11px', lineHeight: '1.4' }}>
                                    1. Open <b>chrome://flags/#unsafely-treat-insecure-origin-as-secure</b> in Chrome.<br />
                                    2. Set to <b>Enabled</b> and enter: <code>{typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.host}` : 'http://172.20.10.2:5000'}</code><br />
                                    3. Tap <b>Relaunch</b>. Done!
                                  </div>
                                </details>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Attendance History Tab */}
      {activeTab === 'student_history' && (
        <div className="d-flex flex-column gap-4">
          {/* Annual Session Roll Call Ledger Card */}
          <div className="card hg-card mb-3 overflow-hidden">
            <div className="card-header bg-white border-bottom py-2.5 px-3 d-flex justify-content-between align-items-center flex-wrap gap-2">
              <div className="d-flex align-items-center gap-2">
                <Calendar size={18} className="text-primary" />
                <h6 className="card-title mb-0 fw-semibold">
                  Session {currentYear} Official Hostel Roll Call Ledger
                </h6>
              </div>
              <span className="badge bg-light text-dark border hg-badge">
                Academic Course % Omitted • Pure Day-Count Ledger
              </span>
            </div>
            <div className="card-body p-3">
              <div className="row g-2 mb-3">
                <div className="col-12 col-sm-6 col-md-3">
                  <div className="p-2.5 rounded-2 bg-light border text-center">
                    <div className="text-muted hg-text-xs fw-medium">Yearly Presence</div>
                    <div className="fw-bold fs-5 text-success mt-1 hg-tabular">{yearlyPresent} / {yearlyActiveDays}</div>
                    <div className="text-muted hg-text-xs">Net Active Days Present</div>
                  </div>
                </div>
                <div className="col-12 col-sm-6 col-md-3">
                  <div className="p-2.5 rounded-2 bg-light border text-center">
                    <div className="text-muted hg-text-xs fw-medium">Holidays Excluded</div>
                    <div className="fw-bold fs-5 text-secondary mt-1 hg-tabular">{yearlyHolidays} Days</div>
                    <div className="text-muted hg-text-xs">Official hostel holidays</div>
                  </div>
                </div>
                <div className="col-12 col-sm-6 col-md-3">
                  <div className="p-2.5 rounded-2 bg-light border text-center">
                    <div className="text-muted hg-text-xs fw-medium">Yearly Missed / Absent</div>
                    <div className="fw-bold fs-5 text-danger mt-1 hg-tabular">{yearlyAbsent} Days</div>
                    <div className="text-muted hg-text-xs">Missed roll call check-ins</div>
                  </div>
                </div>
                <div className="col-12 col-sm-6 col-md-3">
                  <div className="p-2.5 rounded-2 bg-light border text-center">
                    <div className="text-muted hg-text-xs fw-medium">Calendar Year Days</div>
                    <div className="fw-bold fs-5 text-dark mt-1 hg-tabular">{yearlySummary?.daysInYear || 365} Days</div>
                    <div className="text-muted hg-text-xs">Total days in Year {currentYear}</div>
                  </div>
                </div>
              </div>

              {/* Month-by-Month Breakdown */}
              <h6 className="fw-bold text-dark mb-2.5 d-flex align-items-center gap-2">
                <Clock size={16} className="text-primary" />
                Monthly Attendance Breakdown ({currentYear})
              </h6>
              <div className="table-responsive rounded-2 border">
                <table className="table table-sm table-hover align-middle mb-0">
                  <thead className="table-light">
                    <tr className="small text-muted">
                      <th className="ps-3">Month</th>
                      <th>Total Days in Month</th>
                      <th>Days Passed / Remaining</th>
                      <th>Holidays Excluded</th>
                      <th>Net Active Days</th>
                      <th>Present (In Hostel)</th>
                      <th>Approved Leave (Pass)</th>
                      <th>Unauthorized Absent</th>
                      <th className="pe-3">Monthly Presence Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyBreakdown && monthlyBreakdown.length > 0 ? (
                      monthlyBreakdown.map((m) => (
                        <tr key={m.month}>
                          <td className="ps-3 fw-semibold text-dark">{m.monthName}</td>
                          <td>{m.daysInMonth} days</td>
                          <td>
                            <span className="text-dark small">
                              {m.daysElapsed || m.daysInMonth} passed
                              {m.daysRemaining > 0 ? ' (' + m.daysRemaining + ' left)' : ''}
                            </span>
                          </td>
                          <td>{m.holidaysExcluded > 0 ? (m.holidaysExcluded + ' days') : '0 days'}</td>
                          <td><span className="fw-medium text-dark">{m.activeDays} days</span></td>
                          <td>
                            <span className="badge bg-success bg-opacity-10 text-success fw-bold px-2 py-1">
                              ✓ {m.daysPresent} Present
                            </span>
                          </td>
                          <td>
                            <span className="badge bg-warning bg-opacity-15 text-warning-emphasis fw-semibold px-2 py-1">
                              🏖️ {m.daysLeave || 0} Leave
                            </span>
                          </td>
                          <td>
                            <span className={'badge ' + (m.daysAbsent > 0 ? 'bg-danger bg-opacity-10 text-danger' : 'bg-light text-muted') + ' fw-semibold px-2 py-1'}>
                              {m.daysAbsent > 0 ? ('🚨 ' + m.daysAbsent + ' Absent') : '0 Absent'}
                            </span>
                          </td>
                          <td className="pe-3">
                            <span className="fw-bold text-primary">
                              {m.daysPresent} / {m.daysInMonth} Days
                            </span>
                            <span className="text-muted small ms-1" style={{ fontSize: '11px' }}>
                              ({m.daysPresent} / {m.activeDays} active)
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="ps-3 fw-semibold text-dark">{currentMonthName}</td>
                        <td>{daysInMonth} days</td>
                        <td><span className="text-dark small">{daysElapsed} passed ({daysRemaining} left)</span></td>
                        <td>{monthlyHolidays} days</td>
                        <td>{Math.max(0, daysInMonth - monthlyHolidays)} days</td>
                        <td><span className="badge bg-success bg-opacity-10 text-success fw-bold px-2 py-1">✓ {monthlyPresent} Present</span></td>
                        <td><span className="badge bg-warning bg-opacity-15 text-warning-emphasis fw-semibold px-2 py-1">🏖️ {monthlyLeave} Leave</span></td>
                        <td><span className="badge bg-danger bg-opacity-10 text-danger fw-semibold px-2 py-1">{monthlyAbsent} Absent</span></td>
                        <td className="pe-3"><span className="fw-bold text-primary">{monthlyPresent} / {daysInMonth} Days</span></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Daily Attendance History Card */}
          <div className="card hg-card mb-3">
            <div className="card-header bg-white border-bottom py-2.5 px-3">
              <h6 className="card-title mb-0 fw-semibold d-flex align-items-center gap-2">
                <History size={16} className="text-primary" />
                Daily Roll Call Verification History ({history.length} Records)
              </h6>
            </div>
            <div className="card-body p-0">
              {history.length === 0 ? (
                <div className="text-center p-4 text-muted hg-text-xs">No attendance records found yet.</div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm table-hover align-middle mb-0">
                    <thead className="table-light hg-text-xs">
                      <tr className="text-muted">
                        <th className="ps-3">Date</th>
                        <th>Check-in Time</th>
                        <th>Status</th>
                        <th>Method</th>
                        <th className="pe-3">Recorded Distance</th>
                      </tr>
                    </thead>
                    <tbody className="hg-text-xs">
                      {history.map((h) => (
                        <tr key={h.id || h.date}>
                          <td className="ps-3 fw-medium text-dark">{h.date}</td>
                          <td>
                            {h.time_marked ? (
                              <span className="text-dark"><Clock size={11} className="me-1 inline text-muted" />{formatDisplayTime12h(h.time_marked)}</span>
                            ) : (
                              <span className="text-muted">&mdash;</span>
                            )}
                          </td>
                          <td>
                            <span className={`badge hg-badge ${h.status === 'PRESENT' ? 'bg-success' : h.status === 'OVERRIDDEN' ? 'bg-primary' : 'bg-secondary'}`}>
                              {h.status}
                            </span>
                          </td>
                          <td><span className="text-muted hg-text-xs">{h.verification_method || 'Facial Match'}</span></td>
                          <td className="pe-3">
                            <span className="text-muted hg-text-xs">{h.distance_meters ? `${h.distance_meters.toFixed(1)}m` : 'N/A'}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. Submit Correction Tab */}
      {activeTab === 'student_correction' && (
        <div className="row g-3">
          <div className="col-lg-5">
            <div className="card hg-card mb-3">
              <div className="card-header bg-white border-bottom py-2.5 px-3">
                <h6 className="card-title mb-0 fw-semibold d-flex align-items-center gap-2">
                  <FileCheck2 size={16} className="text-primary" />
                  Submit Attendance Appeal
                </h6>
              </div>
              <div className="card-body p-3">
                <form onSubmit={handleSubmitCorrection}>
                  <div className="mb-3">
                    <label className="form-label hg-text-xs fw-medium">Contested Date</label>
                    <input
                      type="date"
                      className="form-control form-control-sm"
                      value={correctionForm.date}
                      onChange={(e) => setCorrectionForm({ ...correctionForm, date: e.target.value })}
                      required
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label hg-text-xs fw-medium">Justification Reason</label>
                    <textarea
                      className="form-control"
                      rows="4"
                      placeholder="e.g., On official college tech fest duty; leave letter submitted to warden."
                      value={correctionForm.reason}
                      onChange={(e) => setCorrectionForm({ ...correctionForm, reason: e.target.value })}
                      required
                    />
                  </div>
                  <button type="submit" className="btn btn-primary btn-sm w-100" disabled={submittingCorrection}>
                    {submittingCorrection ? 'Submitting...' : 'Submit Appeal to Warden'}
                  </button>
                </form>
              </div>
            </div>
          </div>

          <div className="col-lg-7">
            <div className="card hg-card mb-3">
              <div className="card-header bg-white border-bottom py-2.5 px-3">
                <h6 className="card-title mb-0 fw-semibold">My Submitted Correction Appeals ({corrections.length})</h6>
              </div>
              <div className="card-body p-0">
                {corrections.length === 0 ? (
                  <div className="text-center p-3 text-muted hg-text-xs">No appeals submitted.</div>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-sm table-hover align-middle mb-0">
                      <thead className="table-light hg-text-xs">
                        <tr className="text-muted">
                          <th className="ps-3">Date</th>
                          <th>Reason</th>
                          <th>Status</th>
                          <th className="pe-3">Resolution Notes</th>
                        </tr>
                      </thead>
                      <tbody className="hg-text-xs">
                        {corrections.map((c) => (
                          <tr key={c.id}>
                            <td className="ps-3 fw-medium text-dark">{c.date}</td>
                            <td style={{ maxWidth: '240px' }}><div className="text-truncate" title={c.reason}>{c.reason}</div></td>
                            <td>
                              <span className={`badge hg-badge ${c.status === 'APPROVED' ? 'bg-success' : c.status === 'REJECTED' ? 'bg-danger' : 'bg-warning text-dark'}`}>
                                {c.status}
                              </span>
                            </td>
                            <td className="pe-3 text-muted">{c.review_notes || c.resolution_note || '&mdash;'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Support & Feedback Tab */}
      {activeTab === 'student_support' && (
        <div className="row g-3">
          <div className="col-lg-5">
            <div className="card hg-card mb-3">
              <div className="card-header bg-white border-bottom py-2.5 px-3">
                <h6 className="card-title mb-0 fw-semibold d-flex align-items-center gap-2">
                  <LifeBuoy size={16} className="text-primary" />
                  Register Facility Grievance
                </h6>
              </div>
              <div className="card-body p-3">
                <form onSubmit={handleSubmitTicket}>
                  <div className="mb-3">
                    <label className="form-label hg-text-xs fw-medium">Category</label>
                    <select
                      className="form-select form-select-sm"
                      value={ticketForm.category}
                      onChange={(e) => setTicketForm({ ...ticketForm, category: e.target.value })}
                    >
                      <option value="Hostel Facilities">Hostel Facilities & Maintenance</option>
                      <option value="Wi-Fi / Internet">Wi-Fi & Connectivity</option>
                      <option value="Mess & Food">Mess & Food Service</option>
                      <option value="App / Technical">Attendance App / Biometrics</option>
                    </select>
                  </div>
                  <div className="mb-3">
                    <label className="form-label hg-text-xs fw-medium">Subject</label>
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      placeholder="e.g., Water leakage in bathroom 2nd floor"
                      value={ticketForm.subject}
                      onChange={(e) => setTicketForm({ ...ticketForm, subject: e.target.value })}
                      required
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label hg-text-xs fw-medium">Detailed Description</label>
                    <textarea
                      className="form-control"
                      rows="4"
                      placeholder="Please provide specific room or floor details..."
                      value={ticketForm.message}
                      onChange={(e) => setTicketForm({ ...ticketForm, message: e.target.value })}
                      required
                    />
                  </div>
                  <button type="submit" className="btn btn-primary btn-sm w-100" disabled={submittingTicket}>
                    {submittingTicket ? 'Submitting...' : 'Send Grievance Ticket'}
                  </button>
                </form>
              </div>
            </div>
          </div>

          <div className="col-lg-7">
            <div className="card hg-card mb-3">
              <div className="card-header bg-white border-bottom py-2.5 px-3">
                <h6 className="card-title mb-0 fw-semibold">My Grievance Tickets ({tickets.length})</h6>
              </div>
              <div className="card-body p-0">
                {tickets.length === 0 ? (
                  <div className="text-center p-3 text-muted hg-text-xs">No tickets submitted.</div>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-sm table-hover align-middle mb-0">
                      <thead className="table-light hg-text-xs">
                        <tr className="text-muted">
                          <th className="ps-3">Subject</th>
                          <th>Category</th>
                          <th>Status</th>
                          <th className="pe-3">Warden Response</th>
                        </tr>
                      </thead>
                      <tbody className="hg-text-xs">
                        {tickets.map((t) => (
                          <tr key={t.id}>
                            <td className="ps-3">
                              <div className="fw-semibold text-dark">{t.subject}</div>
                              <div className="text-muted text-truncate" style={{ maxWidth: '200px' }}>{t.message}</div>
                            </td>
                            <td><span className="badge bg-light text-dark hg-badge">{t.category}</span></td>
                            <td>
                              <span className={`badge hg-badge ${t.status === 'RESOLVED' ? 'bg-success' : 'bg-warning text-dark'}`}>
                                {t.status}
                              </span>
                            </td>
                            <td className="pe-3 text-muted">{t.admin_response || t.resolution_note || '&mdash;'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Student Profile Tab */}
      {activeTab === 'student_profile' && (
        <div className="card hg-card p-3 mb-3">
          <h6 className="fw-bold mb-3 d-flex align-items-center gap-2">
            <User size={18} className="text-primary" />
            Official Roster Profile &amp; Security Parameters
          </h6>
          <div className="row g-3 small">
            <div className="col-md-6">
              <div className="p-3 bg-light rounded-3">
                <div className="text-muted">Full Name</div>
                <div className="fw-semibold fs-6 text-dark">{student.full_name || 'N/A'}</div>
              </div>
            </div>
            <div className="col-md-6">
              <div className="p-3 bg-light rounded-3">
                <div className="text-muted">Roll Number</div>
                <div className="fw-semibold fs-6 text-primary">{student.roll_number || user?.username}</div>
              </div>
            </div>
            <div className="col-md-4">
              <div className="p-3 bg-light rounded-3">
                <div className="text-muted">Hostel Block</div>
                <div className="fw-medium text-dark">{student.hostel_block || 'Block A'}</div>
              </div>
            </div>
            <div className="col-md-4">
              <div className="p-3 bg-light rounded-3">
                <div className="text-muted">Assigned Room</div>
                <div className="fw-medium text-dark">Room {student.room_number || 'N/A'}</div>
              </div>
            </div>
            <div className="col-md-4">
              <div className="p-3 bg-light rounded-3">
                <div className="text-muted">Academic Program</div>
                <div className="fw-medium text-dark">{student.course || 'B.Tech'} (Sem {student.semester || 1})</div>
              </div>
            </div>
            <div className="col-md-6">
              <div className="p-3 bg-light rounded-3 d-flex justify-content-between align-items-center">
                <div>
                  <div className="text-muted">Identity Verification</div>
                  <div className={`fw-medium ${isFaceEnrolled ? 'text-success' : 'text-warning'}`}>
                    {isFaceEnrolled ? 'Face Enrolled • Identity Verified' : 'Pending Enrollment'}
                  </div>
                </div>
                <button
                  type="button"
                  className={`btn btn-sm ${isFaceEnrolled ? 'btn-outline-primary' : 'btn-primary'} fw-medium d-inline-flex align-items-center gap-1`}
                  onClick={() => {
                    setShowEnrollModal(true);
                    startEnrollCamera();
                  }}
                >
                  <Camera size={14} />
                  {isFaceEnrolled ? 'Update Face Profile' : 'Enroll Face'}
                </button>
              </div>
            </div>
            <div className="col-md-6">
              <div className="p-3 bg-light rounded-3">
                <div className="text-muted">Location Standing</div>
                <div className={`fw-medium ${stats.failedStrikes > 0 ? 'text-danger' : 'text-success'}`}>
                  {stats.failedStrikes > 0 ? `${stats.failedStrikes} Security Warnings` : 'Normal • In Good Standing'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. Biometric Face Enrollment Modal */}
      {showEnrollModal && (
        <div
          className="modal fade show d-block hg-modal-backdrop"
          style={{ zIndex: 1055 }}
          tabIndex="-1"
          role="dialog"
        >
          <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: '480px' }}>
            <div className="modal-content hg-card border-0 rounded-2 shadow-lg overflow-hidden">
              <div className="modal-header bg-dark text-white border-0 py-2.5 px-3">
                <h6 className="modal-title fw-bold d-flex align-items-center gap-2 mb-0">
                  <Camera size={16} className="text-primary" />
                  Facial Biometrics Enrollment
                </h6>
                <button
                  type="button"
                  className="btn-close btn-close-white"
                  aria-label="Close"
                  onClick={() => {
                    stopEnrollCamera();
                    setShowEnrollModal(false);
                  }}
                ></button>
              </div>

              <div className="modal-body p-4 text-center">
                {enrollError && (
                  <div className="alert alert-danger py-2 px-3 small d-flex align-items-center gap-2 mb-3 text-start">
                    <AlertTriangle size={16} className="flex-shrink-0" />
                    <div>{enrollError}</div>
                  </div>
                )}

                <div className="mb-2">
                  <div className="d-flex justify-content-center gap-2 mb-2">
                    {['FRONT', 'LEFT', 'RIGHT'].map((ang) => {
                      const isCaptured = enrollPhotos.some((p) => p.angle === ang);
                      const isActive = enrollActiveAngle === ang;
                      return (
                        <button
                          key={ang}
                          type="button"
                          className={`btn btn-sm px-3 rounded-pill fw-medium ${isCaptured
                            ? 'btn-success text-white'
                            : isActive
                              ? 'btn-primary'
                              : 'btn-outline-secondary'
                            }`}
                          onClick={() => setEnrollActiveAngle(ang)}
                        >
                          {isCaptured ? <Check size={12} className="me-1 inline" /> : null}
                          {ang === 'FRONT' ? '1. Front' : ang === 'LEFT' ? '2. Left Angle' : '3. Right Angle'}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-muted small mb-2">
                    {enrollActiveAngle === 'FRONT'
                      ? 'Look directly at the camera with a neutral expression.'
                      : enrollActiveAngle === 'LEFT'
                        ? 'Turn your head slightly to the left (~15°).'
                        : 'Turn your head slightly to the right (~15°).'}
                  </p>
                  {autoCaptureEnabled && (
                    <div className="d-inline-flex align-items-center gap-1 px-2 py-1 rounded bg-success-subtle text-success small fw-medium mb-3">
                      <Zap size={13} />
                      <span>Hands-Free Auto-Capture ON: Just hold the requested angle steady!</span>
                    </div>
                  )}
                </div>

                {/* Viewport with Live Pose & Quality HUD */}
                <div
                  className="position-relative d-inline-block rounded-4 overflow-hidden shadow mb-3"
                  style={{ width: '100%', maxWidth: '400px', height: '280px', backgroundColor: '#000' }}
                >
                  <video
                    ref={attachEnrollVideoRef}
                    autoPlay
                    playsInline
                    muted
                    controls={false}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      transform: 'scaleX(-1)',
                      display: 'block'
                    }}
                    onLoadedMetadata={(e) => e.target.play().catch(console.warn)}
                  />

                  {/* SVG 3D Pose Circular Progress Ring & Guide Oval */}
                  <svg
                    className="position-absolute top-0 start-0 w-100 h-100"
                    viewBox="0 0 400 280"
                    style={{ pointerEvents: 'none', zIndex: 10 }}
                  >
                    {/* Background track oval */}
                    <ellipse
                      cx="200"
                      cy="135"
                      rx="85"
                      ry="105"
                      fill="none"
                      stroke={poseStatus.ready ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255, 255, 255, 0.25)'}
                      strokeWidth="3"
                      strokeDasharray="6 6"
                    />
                    {/* Dynamic animated progress ring */}
                    <ellipse
                      cx="200"
                      cy="135"
                      rx="85"
                      ry="105"
                      fill="none"
                      stroke={poseStatus.ready ? '#10b981' : '#3b82f6'}
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeDasharray="600"
                      strokeDashoffset={600 - (600 * Math.min(100, Math.max(0, poseStatus.progress || 0))) / 100}
                      style={{
                        transition: 'stroke-dashoffset 0.08s linear, stroke 0.2s ease',
                        filter: poseStatus.ready ? 'drop-shadow(0 0 8px rgba(16, 185, 129, 0.8))' : 'none'
                      }}
                    />
                  </svg>

                  {/* Top HUD: Directional Cue, Real-Time Angle Meter & Lighting Indicator */}
                  <div
                    className="position-absolute top-0 start-0 w-100 px-3 py-2 d-flex justify-content-between align-items-center"
                    style={{ zIndex: 15, pointerEvents: 'none', background: 'linear-gradient(to bottom, rgba(0,0,0,0.65), transparent)' }}
                  >
                    {/* Live Yaw Angle Meter */}
                    <span
                      className={`badge rounded-pill fw-semibold shadow-sm ${poseStatus.ready ? 'bg-success text-white' : 'bg-dark bg-opacity-75 text-light border border-light border-opacity-25'
                        }`}
                      style={{ fontSize: '11px' }}
                    >
                      Yaw: {poseStatus.yaw !== undefined ? `${poseStatus.yaw > 0 ? '+' : ''}${poseStatus.yaw}°` : '0°'}
                      {poseStatus.ready ? ' ✓' : ''}
                    </span>

                    {/* Directional Cue Overlay */}
                    <span
                      className="badge rounded-pill bg-primary bg-opacity-90 text-white shadow-sm d-flex align-items-center gap-1"
                      style={{ fontSize: '11px' }}
                    >
                      {enrollActiveAngle === 'LEFT' ? (
                        <>
                          <ArrowLeft size={12} /> Turn Left (~15°)
                        </>
                      ) : enrollActiveAngle === 'RIGHT' ? (
                        <>
                          Turn Right (~15°) <ArrowRight size={12} />
                        </>
                      ) : (
                        <>
                          <Compass size={12} /> Face Forward (0°)
                        </>
                      )}
                    </span>

                    {/* Illumination & Quality Metric */}
                    <span
                      className={`badge rounded-pill fw-semibold shadow-sm ${(poseStatus.luminance || 100) < 42
                          ? 'bg-warning text-dark'
                          : 'bg-dark bg-opacity-75 text-light border border-light border-opacity-25'
                        }`}
                      style={{ fontSize: '11px' }}
                    >
                      {(poseStatus.luminance || 100) < 42 ? '💡 Dim' : '💡 Light OK'}
                    </span>
                  </div>

                  {/* Shutter Flash Animation */}
                  {flashActive && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        backgroundColor: '#ffffff',
                        opacity: 0.9,
                        zIndex: 25,
                        pointerEvents: 'none'
                      }}
                    />
                  )}

                  {/* Hands-Free Live Guidance Badge */}
                  <div
                    className="position-absolute start-50 translate-middle-x px-3 py-1.5 rounded-pill small fw-semibold text-white shadow-sm d-flex align-items-center gap-2"
                    style={{
                      bottom: '12px',
                      backgroundColor: poseStatus.ready ? 'rgba(16, 185, 129, 0.95)' : 'rgba(15, 23, 42, 0.88)',
                      backdropFilter: 'blur(8px)',
                      border: poseStatus.ready ? '1px solid #10b981' : '1px solid rgba(255, 255, 255, 0.2)',
                      fontSize: '11px',
                      zIndex: 20,
                      transition: 'all 0.18s ease',
                      whiteSpace: 'nowrap',
                      maxWidth: '92%'
                    }}
                  >
                    {autoCaptureEnabled && (
                      <Zap
                        size={13}
                        className={poseStatus.ready ? 'text-warning' : 'text-info'}
                      />
                    )}
                    <span className="text-truncate">
                      {poseStatus.instruction || poseStatus.label || (autoCaptureEnabled ? 'Align your face in oval' : 'Ready to capture')}
                    </span>
                    {autoCaptureEnabled && (poseStatus.progress || 0) > 0 && (
                      <span className="badge bg-white text-success fw-bold px-1.5 py-0" style={{ fontSize: '10px' }}>
                        {poseStatus.progress}%
                      </span>
                    )}
                  </div>
                </div>

                <div className="d-flex justify-content-center align-items-center gap-2 mb-3 flex-wrap">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-1 shadow-sm"
                    onClick={() => {
                      if (enrollVideoRef.current && enrollStreamRef.current) {
                        enrollVideoRef.current.srcObject = enrollStreamRef.current;
                        enrollVideoRef.current.play().catch(console.warn);
                      } else {
                        startEnrollCamera();
                      }
                    }}
                  >
                    <RefreshCw size={13} /> Restart Camera
                  </button>

                  <button
                    type="button"
                    className={`btn btn-sm d-inline-flex align-items-center gap-1 shadow-sm ${autoCaptureEnabled ? 'btn-success text-white' : 'btn-outline-secondary'
                      }`}
                    onClick={() => setAutoCaptureEnabled(!autoCaptureEnabled)}
                    title={autoCaptureEnabled ? 'Hands-Free Auto Snap is ON' : 'Turn Auto-Snap ON'}
                  >
                    <Zap size={13} />
                    {autoCaptureEnabled ? 'Auto-Snap: ON' : 'Auto-Snap: OFF'}
                  </button>

                  <button
                    type="button"
                    className="btn btn-primary btn-sm px-3 fw-semibold d-inline-flex align-items-center gap-1 shadow-sm"
                    onClick={() => handleCaptureEnrollPhoto(enrollActiveAngle)}
                  >
                    <Camera size={14} /> Snap {enrollActiveAngle} Photo
                  </button>

                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm p-1 px-2"
                    onClick={() => playBiometricChime('captured')}
                    title="Test Audio Chime"
                  >
                    <Volume2 size={13} />
                  </button>
                </div>

                {/* Captured previews */}
                {enrollPhotos.length > 0 && (
                  <div className="d-flex justify-content-center gap-2 mb-3 p-2 bg-light rounded-3">
                    {enrollPhotos.map((p) => (
                      <div key={p.angle} className="position-relative text-center">
                        <img
                          src={p.imageBase64}
                          alt={p.angle}
                          className="rounded-2 border border-2 border-success"
                          style={{ width: '64px', height: '64px', objectFit: 'cover' }}
                        />
                        <span className="badge bg-dark position-absolute bottom-0 start-50 translate-middle-x" style={{ fontSize: '9px' }}>
                          {p.angle}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="d-grid gap-2">
                  <button
                    type="button"
                    className="btn btn-success fw-bold py-2 shadow-sm d-flex align-items-center justify-content-center gap-2"
                    disabled={enrollPhotos.length === 0 || enrollSubmitting}
                    onClick={handleSubmitFaceEnrollment}
                  >
                    {enrollSubmitting ? (
                      <>
                        <span className="spinner-border spinner-border-sm" role="status"></span>
                        Saving & Verifying Face Profile...
                      </>
                    ) : (
                      <>
                        <Check size={18} />
                        Save Biometric Profile ({enrollPhotos.length} / 3 Captured)
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => {
                      stopEnrollCamera();
                      setShowEnrollModal(false);
                    }}
                    disabled={enrollSubmitting}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Screen Fill Flash Full-Viewport White Illumination */}
      {isFlashing && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: '#ffffff',
            zIndex: 999999,
            pointerEvents: 'none',
            opacity: 0.95
          }}
        />
      )}

      {/* Modal: Request Physical In-Person Warden Review */}
      {showPhysicalReviewModal && (
        <div className="modal show d-block hg-modal-backdrop" tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content hg-card border-0 rounded-2 shadow">
              <div className="modal-header border-bottom py-2.5 px-3 bg-light rounded-top-2">
                <h6 className="modal-title fw-bold text-dark d-flex align-items-center gap-2 mb-0">
                  <UserCheck className="text-primary" size={18} /> Request In-Person Warden Check-In
                </h6>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setShowPhysicalReviewModal(false)}
                  disabled={physicalReviewSubmitting}
                />
              </div>
              <div className="modal-body p-3">
                {physicalReviewSuccess ? (
                  <div className="alert alert-success d-flex align-items-center gap-2 mb-0">
                    <CheckCircle2 size={18} />
                    <div>{physicalReviewSuccess}</div>
                  </div>
                ) : (
                  <form onSubmit={handleRequestPhysicalVerification}>
                    <p className="text-muted hg-text-xs mb-3">
                      If you have medical facial bandages, swelling, eye injury, or a broken smartphone camera, you can request an in-person roll-call check-in. The hostel warden will verify your presence in your room during evening rounds.
                    </p>
                    <div className="mb-3">
                      <label className="form-label hg-text-xs fw-bold text-dark">Reason for Physical Verification</label>
                      <select
                        className="form-select form-select-sm rounded-2"
                        value={physicalReviewReason}
                        onChange={(e) => setPhysicalReviewReason(e.target.value)}
                        required
                      >
                        <option value="Medical condition / facial bandage">Medical condition / facial bandage</option>
                        <option value="Eye injury / temporary facial distortion">Eye injury / temporary facial distortion</option>
                        <option value="Front camera hardware failure / cracked lens">Front camera hardware failure / cracked lens</option>
                        <option value="Religious / Cultural accommodation">Religious / Cultural accommodation</option>
                        <option value="Persistent low-light / environment constraint">Persistent low-light / environment constraint</option>
                      </select>
                    </div>
                    <div className="mb-3">
                      <label className="form-label hg-text-xs fw-bold text-dark">Additional Details (Optional)</label>
                      <textarea
                        className="form-control form-control-sm rounded-2"
                        rows="2"
                        placeholder="E.g., Room A-204, resting with eye drops after clinic visit"
                        value={physicalReviewNotes}
                        onChange={(e) => setPhysicalReviewNotes(e.target.value)}
                      />
                    </div>
                    <div className="d-flex justify-content-end gap-2 mt-3">
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm px-3"
                        onClick={() => setShowPhysicalReviewModal(false)}
                        disabled={physicalReviewSubmitting}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn btn-primary btn-sm px-3 fw-semibold"
                        disabled={physicalReviewSubmitting}
                      >
                        {physicalReviewSubmitting ? 'Submitting Request...' : 'Submit Request to Warden'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rapido-Style Mock Location / Fake GPS Blocker Modal */}
      {showSpoofModal && (
        <div
          className="modal show d-block hg-modal-backdrop"
          style={{ zIndex: 1060 }}
        >
          <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: '440px' }}>
            <div className="modal-content hg-card border-0 rounded-2 shadow overflow-hidden">
              <div className="bg-danger text-white p-3 text-center">
                <div className="d-inline-flex p-2 rounded-circle bg-white bg-opacity-20 mb-2">
                  <ShieldAlert size={36} className="text-white" />
                </div>
                <h6 className="fw-bold mb-0 text-white">Mock Location Detected</h6>
                <p className="hg-text-xs mb-0 text-white-50">
                  Anti-Spoofing Policy Violation &bull; Hardware GPS Required
                </p>
              </div>

              <div className="modal-body p-3 text-start">
                <div className="alert alert-danger bg-danger bg-opacity-10 border-danger border-opacity-25 rounded-2 p-2.5 mb-3">
                  <div className="fw-semibold text-danger hg-text-xs mb-1">
                    Fake GPS or Location Spoofer Active
                  </div>
                  <div className="text-dark hg-text-xs">
                    HostelGuard strict biometric security requires authentic hardware GPS coordinates and live Bluetooth beacon proximity. To complete attendance roll call, you must disable mock location providers and uninstall spoofing applications.
                  </div>
                </div>

                {spoofModalData.apps && spoofModalData.apps.length > 0 && (
                  <div className="mb-3">
                    <div className="fw-bold text-dark hg-text-xs mb-1.5 text-uppercase">
                      Detected Mock Applications ({spoofModalData.apps.length}):
                    </div>
                    <div className="d-flex flex-column gap-1.5">
                      {spoofModalData.apps.map((app, idx) => (
                        <div
                          key={idx}
                          className="d-flex align-items-center justify-content-between p-2 rounded-2 bg-light border"
                        >
                          <div className="d-flex align-items-center gap-2 overflow-hidden">
                            <AlertTriangle size={16} className="text-danger flex-shrink-0" />
                            <div className="text-truncate">
                              <div className="fw-semibold text-dark hg-text-xs text-truncate">
                                {app.appName || app.packageName || 'Unknown Spoofer'}
                              </div>
                              <div className="text-muted text-truncate hg-text-xs">
                                {app.packageName || ''}
                              </div>
                            </div>
                          </div>
                          {isNativeMobile() && (
                            <button
                              type="button"
                              className="btn btn-outline-danger btn-sm py-0.5 px-2 fw-semibold flex-shrink-0 hg-text-xs"
                              onClick={() => openSpoofAppSettings(app.packageName)}
                            >
                              App Info
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="p-2.5 bg-light rounded-2 border mb-3">
                  <div className="fw-bold text-dark hg-text-xs mb-1">
                    How to resolve:
                  </div>
                  <ol className="mb-0 ps-3 hg-text-xs text-muted">
                    <li className="mb-0.5">Uninstall the mock GPS applications listed above.</li>
                    <li className="mb-0.5">Go to <b>Settings &rarr; Developer Options</b> and set <b>Select mock location app</b> to <b>None</b>.</li>
                    <li>Return to HostelGuard and tap <b>Re-check Location</b>.</li>
                  </ol>
                </div>

                <div className="d-flex flex-column gap-2">
                  {isNativeMobile() && (
                    <button
                      type="button"
                      className="btn btn-outline-dark fw-semibold py-2 d-flex align-items-center justify-content-center gap-2"
                      style={{ fontSize: '12px' }}
                      onClick={() => openSpoofAppSettings(null)}
                    >
                      <Settings size={14} /> Open Developer Settings
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary fw-bold py-2.5 d-flex align-items-center justify-content-center gap-2 shadow-sm"
                    style={{ fontSize: '13px' }}
                    onClick={() => {
                      setShowSpoofModal(false);
                      handleVerifyLocation();
                    }}
                  >
                    <RefreshCw size={14} /> Re-check Location &amp; Hardware
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
