import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  X,
  Download,
  QrCode,
  Smartphone,
  Check,
  Copy,
  ExternalLink,
  ShieldCheck,
  Share2,
  PlusSquare,
  Sparkles,
  Compass
} from 'lucide-react';

export default function AppDownloadModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('android'); // 'android' | 'ios'
  const canvasRef = useRef(null);
  const [copied, setCopied] = useState(false);

  // Direct APK binary download URL
  const directApkUrl = 'https://github.com/codewithgyan467/Attendence_system/releases/latest/download/app-release.apk';
  const releasesPageUrl = 'https://github.com/codewithgyan467/Attendence_system/releases/latest';

  // Current web app URL for iOS Safari scanning
  const webAppUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

  useEffect(() => {
    if (isOpen && canvasRef.current) {
      const targetUrl = activeTab === 'android' ? directApkUrl : webAppUrl;

      QRCode.toCanvas(
        canvasRef.current,
        targetUrl,
        {
          width: 180,
          margin: 2,
          color: {
            dark: '#0f172a',
            light: '#ffffff'
          }
        },
        (error) => {
          if (error) console.error('QR code generation error:', error);
        }
      );
    }
  }, [isOpen, activeTab, directApkUrl, webAppUrl]);

  if (!isOpen) return null;

  const handleCopyLink = (urlToCopy) => {
    navigator.clipboard.writeText(urlToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div
      className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
      style={{
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(6px)',
        zIndex: 1060,
        padding: '16px'
      }}
    >
      <div
        className="card border-0 shadow-lg rounded-4 overflow-hidden"
        style={{ maxWidth: '470px', width: '100%', animation: 'fadeIn 0.2s ease-out' }}
      >
        {/* Modal Header */}
        <div
          className="p-3 text-white d-flex align-items-center justify-content-between"
          style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' }}
        >
          <div className="d-flex align-items-center gap-2">
            <div
              className="d-flex align-items-center justify-content-center rounded-circle"
              style={{ width: '32px', height: '32px', backgroundColor: 'rgba(255, 255, 255, 0.12)' }}
            >
              <Smartphone size={18} className="text-white" />
            </div>
            <div>
              <h6 className="fw-bold mb-0 text-white">Get HostelGuard Mobile App</h6>
              <small className="text-secondary" style={{ fontSize: '11px' }}>
                Required for satellite GPS roll call check-in
              </small>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-link text-white p-1 text-decoration-none opacity-75 hover-opacity-100"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        {/* Platform Selection Tabs */}
        <div className="d-flex bg-light border-bottom p-1">
          <button
            type="button"
            className={`btn btn-sm flex-fill fw-semibold d-flex align-items-center justify-content-center gap-2 py-2 rounded-3 transition-all ${
              activeTab === 'android' ? 'btn-white bg-white shadow-sm text-success' : 'text-muted border-0 bg-transparent'
            }`}
            onClick={() => setActiveTab('android')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill={activeTab === 'android' ? '#10b981' : '#64748b'}>
              <path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.551 0 .9993.4482.9993.9993.0001.5511-.4483.9997-.9993.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m11.4045-6.02l1.9973-3.4592a.416.416 0 00-.1521-.5676.416.416 0 00-.5676.1521l-2.0223 3.503C15.5902 8.4116 13.8533 8.0822 12 8.0822s-3.5902.3294-5.1368.8676L4.841 5.4468a.416.416 0 00-.5677-.1521.4157.4157 0 00-.152.5676l1.9972 3.4592C2.6889 11.1867.3432 14.6589 0 18.761h24c-.3432-4.1021-2.6889-7.5743-6.1185-9.4396" />
            </svg>
            <span>Android Phone / Tablet</span>
          </button>

          <button
            type="button"
            className={`btn btn-sm flex-fill fw-semibold d-flex align-items-center justify-content-center gap-2 py-2 rounded-3 transition-all ${
              activeTab === 'ios' ? 'btn-white bg-white shadow-sm text-primary' : 'text-muted border-0 bg-transparent'
            }`}
            onClick={() => setActiveTab('ios')}
          >
            {/* Apple Logo SVG */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill={activeTab === 'ios' ? '#4f46e5' : '#64748b'}>
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.85c.66-.8 1.11-1.92.99-3.04-.96.04-2.12.64-2.8 1.44-.6.69-1.12 1.83-1 2.93 1.07.08 2.15-.53 2.81-1.33z" />
            </svg>
            <span>iPhone / iPad (iOS)</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="card-body p-4 text-center">
          {activeTab === 'android' ? (
            /* ================= ANDROID TAB ================= */
            <div>
              {/* QR Code Container */}
              <div className="p-3 bg-light rounded-4 d-inline-block border mb-3 shadow-sm">
                <canvas ref={canvasRef} style={{ display: 'block', borderRadius: '8px' }} />
              </div>

              <div className="mb-3">
                <h6 className="fw-bold text-dark mb-1 d-flex align-items-center justify-content-center gap-1">
                  <QrCode size={16} className="text-success" /> Scan with Phone Camera
                </h6>
                <p className="text-muted small mb-0" style={{ fontSize: '12px' }}>
                  Point your phone's camera at the screen to start the direct APK download immediately. No account required.
                </p>
              </div>

              {/* Direct Download Button */}
              <div className="d-grid gap-2 mb-3">
                <a
                  href={directApkUrl}
                  className="btn btn-success py-2 d-flex align-items-center justify-content-center gap-2 fw-semibold shadow-sm"
                  download
                >
                  <Download size={16} /> Direct Download (.APK)
                </a>

                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm d-flex align-items-center justify-content-center gap-2"
                  onClick={() => handleCopyLink(directApkUrl)}
                >
                  {copied ? (
                    <>
                      <Check size={14} className="text-success" />
                      <span className="text-success fw-semibold">Download Link Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={14} /> Copy Direct Download Link
                    </>
                  )}
                </button>
              </div>

              {/* Quick 3-Step Guide */}
              <div className="card bg-body-tertiary border-0 p-3 rounded-3 text-start mb-2">
                <div className="fw-bold text-dark small mb-2 d-flex align-items-center gap-1">
                  <ShieldCheck size={14} className="text-success" /> Easy 3-Step Setup
                </div>
                <ol className="small text-muted ps-3 mb-0" style={{ fontSize: '11px', lineHeight: 1.5 }}>
                  <li>Scan the QR code or tap <strong>Direct Download</strong>.</li>
                  <li>When Android prompts, tap <strong>"Download anyway"</strong> and then <strong>"Install"</strong>.</li>
                  <li>Open the app and log in with your Roll Number to complete roll call check-ins.</li>
                </ol>
              </div>

              <div className="text-center mt-2">
                <a
                  href={releasesPageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted small text-decoration-none d-inline-flex align-items-center gap-1"
                  style={{ fontSize: '11px' }}
                >
                  <span>View GitHub Releases page</span>
                  <ExternalLink size={10} />
                </a>
              </div>
            </div>
          ) : (
            /* ================= IPHONE & IPAD TAB ================= */
            <div>
              {/* iOS QR Code */}
              <div className="p-3 bg-light rounded-4 d-inline-block border mb-3 shadow-sm">
                <canvas ref={canvasRef} style={{ display: 'block', borderRadius: '8px' }} />
              </div>

              <div className="mb-3">
                <h6 className="fw-bold text-dark mb-1 d-flex align-items-center justify-content-center gap-1">
                  <QrCode size={16} className="text-primary" /> Scan with iPhone Camera
                </h6>
                <p className="text-muted small mb-0" style={{ fontSize: '12px' }}>
                  Point your iPhone or iPad camera at the screen to open the app in <strong>Safari</strong>.
                </p>
              </div>

              {/* 3-Step iOS PWA Installation Guide */}
              <div className="card border-primary border-opacity-25 bg-primary bg-opacity-10 p-3 rounded-3 text-start mb-3">
                <div className="fw-bold text-primary small mb-2 d-flex align-items-center gap-1">
                  <Sparkles size={14} className="text-primary" /> How to Install on iPhone in 5 Seconds:
                </div>
                <div className="d-flex flex-column gap-2 small text-dark" style={{ fontSize: '11.5px', lineHeight: 1.4 }}>
                  <div className="d-flex align-items-start gap-2">
                    <span className="badge bg-primary rounded-circle p-1" style={{ width: '20px', height: '20px' }}>1</span>
                    <span>Open this website in <strong>Safari</strong> on your iPhone or iPad.</span>
                  </div>
                  <div className="d-flex align-items-start gap-2">
                    <span className="badge bg-primary rounded-circle p-1" style={{ width: '20px', height: '20px' }}>2</span>
                    <span>
                      Tap the <strong>Share button</strong> <Share2 size={13} className="text-primary inline" /> at the bottom center of Safari.
                    </span>
                  </div>
                  <div className="d-flex align-items-start gap-2">
                    <span className="badge bg-primary rounded-circle p-1" style={{ width: '20px', height: '20px' }}>3</span>
                    <span>
                      Scroll down and tap <strong>"Add to Home Screen"</strong> <PlusSquare size={13} className="text-primary inline" />, then tap <strong>Add</strong>.
                    </span>
                  </div>
                </div>
              </div>

              {/* Feature Highlights for iOS */}
              <div className="card bg-body-tertiary border-0 p-3 rounded-3 text-start mb-3">
                <div className="fw-bold text-dark small mb-1 d-flex align-items-center gap-1">
                  <Compass size={14} className="text-success" /> Why this works on iPhone:
                </div>
                <ul className="small text-muted ps-3 mb-0" style={{ fontSize: '11px', lineHeight: 1.4 }}>
                  <li>Launches as a standalone app with no browser address bar.</li>
                  <li>Engages the iPhone’s physical <strong>Apple Bionic GPS chip (±5m accuracy)</strong> for hostel geofence verification.</li>
                  <li>Full front-camera support for facial biometric check-ins.</li>
                </ul>
              </div>

              {/* Copy URL Button */}
              <button
                type="button"
                className="btn btn-outline-primary btn-sm w-100 d-flex align-items-center justify-content-center gap-2"
                onClick={() => handleCopyLink(webAppUrl)}
              >
                {copied ? (
                  <>
                    <Check size={14} className="text-success" />
                    <span className="text-success fw-semibold">App URL Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy size={14} /> Copy Web App Link to Share (WhatsApp / iMessage)
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
