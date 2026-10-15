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
          width: 120,
          margin: 1,
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
      className="position-fixed top-0 start-0 w-100 h-100 d-flex justify-content-center p-2 p-sm-3"
      style={{
        backgroundColor: 'rgba(15, 23, 42, 0.8)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 1060,
        overflowY: 'auto'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card border-0 shadow-lg rounded-4 overflow-hidden d-flex flex-column my-auto"
        style={{
          maxWidth: '640px',
          width: '100%',
          maxHeight: 'calc(100vh - 24px)',
          animation: 'fadeIn 0.2s ease-out'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header (Fixed at top) */}
        <div
          className="px-3 py-2 text-white d-flex align-items-center justify-content-between flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' }}
        >
          <div className="d-flex align-items-center gap-2">
            <img
              src="/icon-192.png"
              alt="HostelGuard Officer Mascot"
              className="rounded-circle border border-white border-opacity-25 shadow-sm flex-shrink-0"
              style={{ width: '28px', height: '28px', objectFit: 'cover' }}
            />
            <div>
              <h6 className="fw-bold mb-0 text-white" style={{ fontSize: '13px' }}>HostelGuard Mobile App</h6>
              <small className="text-secondary" style={{ fontSize: '10px' }}>
                Required for satellite GPS roll call check-in
              </small>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-link text-white p-1 text-decoration-none opacity-75 hover-opacity-100"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Platform Selection Tabs (Fixed) */}
        <div className="d-flex bg-light border-bottom p-1 flex-shrink-0">
          <button
            type="button"
            className={`btn btn-sm flex-fill fw-semibold d-flex align-items-center justify-content-center gap-1.5 py-1 px-2 rounded-3 transition-all ${
              activeTab === 'android' ? 'bg-white shadow-sm text-success' : 'text-muted border-0 bg-transparent'
            }`}
            style={{ fontSize: '12px' }}
            onClick={() => setActiveTab('android')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill={activeTab === 'android' ? '#10b981' : '#64748b'}>
              <path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.551 0 .9993.4482.9993.9993.0001.5511-.4483.9997-.9993.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m11.4045-6.02l1.9973-3.4592a.416.416 0 00-.1521-.5676.416.416 0 00-.5676.1521l-2.0223 3.503C15.5902 8.4116 13.8533 8.0822 12 8.0822s-3.5902.3294-5.1368.8676L4.841 5.4468a.416.416 0 00-.5677-.1521.4157.4157 0 00-.152.5676l1.9972 3.4592C2.6889 11.1867.3432 14.6589 0 18.761h24c-.3432-4.1021-2.6889-7.5743-6.1185-9.4396" />
            </svg>
            <span>Android Phone / Tablet (APK)</span>
          </button>

          <button
            type="button"
            className={`btn btn-sm flex-fill fw-semibold d-flex align-items-center justify-content-center gap-1.5 py-1 px-2 rounded-3 transition-all ${
              activeTab === 'ios' ? 'bg-white shadow-sm text-primary' : 'text-muted border-0 bg-transparent'
            }`}
            style={{ fontSize: '12px' }}
            onClick={() => setActiveTab('ios')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={activeTab === 'ios' ? '#4f46e5' : '#64748b'}>
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.85c.66-.8 1.11-1.92.99-3.04-.96.04-2.12.64-2.8 1.44-.6.69-1.12 1.83-1 2.93 1.07.08 2.15-.53 2.81-1.33z" />
            </svg>
            <span>iPhone / iPad (iOS Safari)</span>
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="card-body p-3 overflow-y-auto" style={{ flex: '1 1 auto' }}>
          {activeTab === 'android' ? (
            /* ================= ANDROID TAB (2-COLUMN ON >= 576px) ================= */
            <div className="row g-3 align-items-center">
              {/* Left Column: QR Code */}
              <div className="col-sm-5 text-center">
                <div className="p-1.5 bg-light rounded-3 d-inline-block border mb-1 shadow-sm">
                  <canvas ref={canvasRef} style={{ display: 'block', borderRadius: '4px' }} />
                </div>
                <div className="fw-bold text-dark small mb-0.5 d-flex align-items-center justify-content-center gap-1" style={{ fontSize: '11.5px' }}>
                  <QrCode size={13} className="text-success" /> Scan with Phone
                </div>
                <p className="text-muted small mb-0" style={{ fontSize: '10px', lineHeight: 1.25 }}>
                  Point camera at screen to download APK directly.
                </p>
              </div>

              {/* Right Column: Actions & Guide */}
              <div className="col-sm-7">
                <div className="d-grid gap-1.5 mb-2">
                  <a
                    href={directApkUrl}
                    className="btn btn-success py-1.5 d-flex align-items-center justify-content-center gap-1.5 fw-semibold shadow-sm"
                    style={{ fontSize: '12.5px' }}
                    download
                  >
                    <Download size={14} /> Direct Download (.APK)
                  </a>

                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm d-flex align-items-center justify-content-center gap-1 py-1"
                    style={{ fontSize: '11px' }}
                    onClick={() => handleCopyLink(directApkUrl)}
                  >
                    {copied ? (
                      <>
                        <Check size={12} className="text-success" />
                        <span className="text-success fw-semibold">Direct Link Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy size={12} /> Copy Download Link
                      </>
                    )}
                  </button>
                </div>

                {/* 3-Step Guide */}
                <div className="card bg-body-tertiary border-0 p-2 px-2.5 rounded-3 text-start mb-1.5">
                  <div className="fw-bold text-dark small mb-1 d-flex align-items-center gap-1" style={{ fontSize: '11px' }}>
                    <ShieldCheck size={12} className="text-success" /> Quick 3-Step Install:
                  </div>
                  <ol className="small text-muted ps-3 mb-0" style={{ fontSize: '10px', lineHeight: 1.35 }}>
                    <li>Scan QR code or click <strong>Direct Download</strong>.</li>
                    <li>Tap <strong>"Download anyway"</strong> ➔ <strong>"Install"</strong>.</li>
                    <li>Open app &amp; sign in with your Roll Number.</li>
                  </ol>
                </div>

                <div className="text-center text-sm-start">
                  <a
                    href={releasesPageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted small text-decoration-none d-inline-flex align-items-center gap-1"
                    style={{ fontSize: '10px' }}
                  >
                    <span>View GitHub Releases page</span>
                    <ExternalLink size={9} />
                  </a>
                </div>
              </div>
            </div>
          ) : (
            /* ================= IPHONE & IPAD TAB (2-COLUMN ON >= 576px) ================= */
            <div className="row g-3 align-items-center">
              {/* Left Column: iOS QR Code */}
              <div className="col-sm-5 text-center">
                <div className="p-1.5 bg-light rounded-3 d-inline-block border mb-1 shadow-sm">
                  <canvas ref={canvasRef} style={{ display: 'block', borderRadius: '4px' }} />
                </div>
                <div className="fw-bold text-dark small mb-0.5 d-flex align-items-center justify-content-center gap-1" style={{ fontSize: '11.5px' }}>
                  <QrCode size={13} className="text-primary" /> Scan with iPhone
                </div>
                <p className="text-muted small mb-0" style={{ fontSize: '10px', lineHeight: 1.25 }}>
                  Point camera to open website in <strong>Safari</strong>.
                </p>
              </div>

              {/* Right Column: Instructions & PWA Highlights */}
              <div className="col-sm-7">
                {/* 3-Step Safari Guide */}
                <div className="card border-primary border-opacity-25 bg-primary bg-opacity-10 p-2 px-2.5 rounded-3 text-start mb-1.5">
                  <div className="fw-bold text-primary small mb-1 d-flex align-items-center gap-1" style={{ fontSize: '11px' }}>
                    <Sparkles size={12} className="text-primary" /> Add to Home Screen in 5 Seconds:
                  </div>
                  <div className="d-flex flex-column gap-1 small text-dark" style={{ fontSize: '10px', lineHeight: 1.3 }}>
                    <div className="d-flex align-items-start gap-1">
                      <span className="badge bg-primary rounded-circle p-0 d-inline-flex align-items-center justify-content-center" style={{ width: '14px', height: '14px', fontSize: '8.5px', minWidth: '14px' }}>1</span>
                      <span>Open website in <strong>Safari</strong> on your iPhone.</span>
                    </div>
                    <div className="d-flex align-items-start gap-1">
                      <span className="badge bg-primary rounded-circle p-0 d-inline-flex align-items-center justify-content-center" style={{ width: '14px', height: '14px', fontSize: '8.5px', minWidth: '14px' }}>2</span>
                      <span>
                        Tap <strong>Share</strong> <Share2 size={10} className="text-primary inline" /> at the bottom center of Safari.
                      </span>
                    </div>
                    <div className="d-flex align-items-start gap-1">
                      <span className="badge bg-primary rounded-circle p-0 d-inline-flex align-items-center justify-content-center" style={{ width: '14px', height: '14px', fontSize: '8.5px', minWidth: '14px' }}>3</span>
                      <span>
                        Tap <strong>"Add to Home Screen"</strong> <PlusSquare size={10} className="text-primary inline" /> ➔ <strong>Add</strong>.
                      </span>
                    </div>
                  </div>
                </div>

                {/* Feature Highlights */}
                <div className="card bg-body-tertiary border-0 p-2 px-2.5 rounded-3 text-start mb-1.5">
                  <div className="fw-bold text-dark small mb-0.5 d-flex align-items-center gap-1" style={{ fontSize: '10.5px' }}>
                    <Compass size={11} className="text-success" /> Why this works on iPhone:
                  </div>
                  <ul className="small text-muted ps-3 mb-0" style={{ fontSize: '9.5px', lineHeight: 1.3 }}>
                    <li>Launches as a standalone app with no browser address bar.</li>
                    <li>Engages physical <strong>Apple Bionic GPS (±5m accuracy)</strong> for hostel check-in.</li>
                  </ul>
                </div>

                {/* Copy Link Button */}
                <button
                  type="button"
                  className="btn btn-outline-primary btn-sm w-100 d-flex align-items-center justify-content-center gap-1 py-1"
                  style={{ fontSize: '11px' }}
                  onClick={() => handleCopyLink(webAppUrl)}
                >
                  {copied ? (
                    <>
                      <Check size={12} className="text-success" />
                      <span className="text-success fw-semibold">App URL Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={12} /> Copy Link to Share (WhatsApp / iMessage)
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
