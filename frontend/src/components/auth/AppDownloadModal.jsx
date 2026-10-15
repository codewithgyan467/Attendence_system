import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { X, Download, QrCode, Smartphone, Check, Copy, ExternalLink, ShieldCheck } from 'lucide-react';
import { getApiBaseUrl } from '../../utils/api';

export default function AppDownloadModal({ isOpen, onClose }) {
  const canvasRef = useRef(null);
  const [copied, setCopied] = useState(false);

  // Direct APK binary download URL
  // Uses backend direct route if available, otherwise direct GitHub release asset download
  const directApkUrl = 'https://github.com/codewithgyan467/Attendence_system/releases/latest/download/app-release.apk';
  const releasesPageUrl = 'https://github.com/codewithgyan467/Attendence_system/releases/latest';

  useEffect(() => {
    if (isOpen && canvasRef.current) {
      QRCode.toCanvas(
        canvasRef.current,
        directApkUrl,
        {
          width: 190,
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
  }, [isOpen, directApkUrl]);

  if (!isOpen) return null;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(directApkUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div
      className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
      style={{
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(5px)',
        zIndex: 1060,
        padding: '16px'
      }}
    >
      <div
        className="card border-0 shadow-lg rounded-4 overflow-hidden"
        style={{ maxWidth: '440px', width: '100%', animation: 'fadeIn 0.2s ease-out' }}
      >
        {/* Modal Header */}
        <div
          className="p-3 text-white d-flex align-items-center justify-content-between"
          style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' }}
        >
          <div className="d-flex align-items-center gap-2">
            <div
              className="d-flex align-items-center justify-content-center rounded-circle"
              style={{ width: '32px', height: '32px', backgroundColor: 'rgba(16, 185, 129, 0.15)' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#10b981" aria-hidden="true">
                <path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.551 0 .9993.4482.9993.9993.0001.5511-.4483.9997-.9993.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m11.4045-6.02l1.9973-3.4592a.416.416 0 00-.1521-.5676.416.416 0 00-.5676.1521l-2.0223 3.503C15.5902 8.4116 13.8533 8.0822 12 8.0822s-3.5902.3294-5.1368.8676L4.841 5.4468a.416.416 0 00-.5677-.1521.4157.4157 0 00-.152.5676l1.9972 3.4592C2.6889 11.1867.3432 14.6589 0 18.761h24c-.3432-4.1021-2.6889-7.5743-6.1185-9.4396" />
              </svg>
            </div>
            <div>
              <h6 className="fw-bold mb-0 text-white">HostelGuard Android App</h6>
              <small className="text-secondary" style={{ fontSize: '11px' }}>Direct 1-Click Installation</small>
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

        {/* Modal Body */}
        <div className="card-body p-4 text-center">
          {/* QR Code Container */}
          <div className="p-3 bg-light rounded-4 d-inline-block border mb-3 shadow-sm">
            <canvas ref={canvasRef} style={{ display: 'block', borderRadius: '8px' }} />
          </div>

          <div className="mb-3">
            <h6 className="fw-bold text-dark mb-1 d-flex align-items-center justify-content-center gap-1">
              <QrCode size={16} className="text-primary" /> Scan with Phone Camera
            </h6>
            <p className="text-muted small mb-0" style={{ fontSize: '12px' }}>
              Point your phone's camera at the screen to start the direct APK download immediately. No account required.
            </p>
          </div>

          {/* Direct Download Button (For Mobile or Direct Browser Download) */}
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
              onClick={handleCopyLink}
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
              <li>When Android asks, tap <strong>"Download anyway"</strong> and then <strong>"Install"</strong>.</li>
              <li>Open the app and log in with your Roll Number to complete geofence check-ins.</li>
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
      </div>
    </div>
  );
}
