import React from 'react';
import {
  X,
  Download,
  FileText,
  ExternalLink,
  Printer,
  ShieldCheck,
  Cpu,
  Layers,
  Sparkles
} from 'lucide-react';

export default function TechnicalReportsModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  const pdfUrl = '/reports/CAMERA_FACE_VERIFICATION_WORKFLOW_REPORT.pdf';
  const htmlUrl = '/reports/CAMERA_FACE_VERIFICATION_WORKFLOW_REPORT.html';
  const mdUrl = '/reports/CAMERA_FACE_VERIFICATION_WORKFLOW_REPORT.md';
  const masterReportUrl = 'https://github.com/codewithgyan467/Attendence_system/blob/main/hostelguard_presentation_and_engineering_report.md';

  return (
    <div
      className="modal show d-block"
      style={{ backgroundColor: 'rgba(15, 23, 42, 0.75)', zIndex: 1060, backdropFilter: 'blur(4px)' }}
      tabIndex="-1"
      onClick={onClose}
    >
      <div
        className="modal-dialog modal-dialog-centered modal-lg"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '680px' }}
      >
        <div className="modal-content border-0 shadow-lg rounded-4 overflow-hidden">
          {/* Header */}
          <div className="modal-header bg-dark text-white py-3 px-4 d-flex align-items-center justify-content-between border-0">
            <div className="d-flex align-items-center gap-2">
              <div
                className="rounded-3 d-flex align-items-center justify-content-center"
                style={{ width: '36px', height: '36px', backgroundColor: '#2563eb' }}
              >
                <FileText size={20} className="text-white" />
              </div>
              <div>
                <h5 className="modal-title fw-bold text-white mb-0" style={{ fontSize: '16px' }}>
                  Download Technical Specification Reports
                </h5>
                <span className="text-white-50" style={{ fontSize: '11.5px' }}>
                  HostelGuard Enterprise v3.0 &bull; Architecture &amp; Camera Verification Specs
                </span>
              </div>
            </div>
            <button
              type="button"
              className="btn-close btn-close-white"
              onClick={onClose}
              aria-label="Close"
            />
          </div>

          {/* Body */}
          <div className="modal-body p-4 bg-light">
            <div className="alert alert-primary d-flex align-items-center gap-2 py-2.5 px-3 rounded-3 mb-3 border-0 shadow-sm">
              <Sparkles size={18} className="text-primary flex-shrink-0" />
              <div style={{ fontSize: '12px' }} className="text-primary-emphasis">
                Select your preferred format below to download the official engineering reports or open the interactive print-ready viewer.
              </div>
            </div>

            {/* Primary Report Card: Camera & Face Verification */}
            <div className="card border-0 shadow-sm rounded-3 mb-3 overflow-hidden">
              <div className="card-header bg-white border-bottom py-2.5 px-3 d-flex align-items-center justify-content-between">
                <div className="d-flex align-items-center gap-2">
                  <span className="badge bg-primary text-white px-2 py-1" style={{ fontSize: '10.5px' }}>
                    PRIMARY SPECIFICATION
                  </span>
                  <span className="fw-bold text-dark" style={{ fontSize: '13.5px' }}>
                    Camera Ingestion &amp; Face Verification Architecture
                  </span>
                </div>
                <span className="text-muted small" style={{ fontSize: '11px' }}>
                  v3.0 Zero-Trust
                </span>
              </div>
              <div className="card-body p-3">
                <p className="text-muted mb-3" style={{ fontSize: '12px', lineHeight: 1.5 }}>
                  Exhaustive end-to-end breakdown: WebRTC raw sensor grab, OpenCV YuNet anchor detection, 5-point affine alignment, SFace 128D hypersphere embedding, 3-stage passive PAD (Laplacian, 2D FFT Moiré, YCrCb skin chrominance), and causal screen-flash photometric reflection.
                </p>

                <div className="d-flex flex-wrap gap-2">
                  {/* PDF Download Button */}
                  <a
                    href={pdfUrl}
                    download="CAMERA_FACE_VERIFICATION_WORKFLOW_REPORT.pdf"
                    className="btn btn-danger btn-sm d-inline-flex align-items-center gap-1.5 fw-semibold px-3 py-1.5 shadow-sm"
                    style={{ fontSize: '12px' }}
                  >
                    <Download size={14} /> Download PDF (.pdf, 365 KB)
                  </a>

                  {/* Interactive HTML Viewer */}
                  <a
                    href={htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-outline-primary btn-sm d-inline-flex align-items-center gap-1.5 fw-semibold px-3 py-1.5"
                    style={{ fontSize: '12px' }}
                  >
                    <ExternalLink size={14} /> Open Interactive HTML
                  </a>

                  {/* Markdown Download */}
                  <a
                    href={mdUrl}
                    download="CAMERA_FACE_VERIFICATION_WORKFLOW_REPORT.md"
                    className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-1.5 fw-semibold px-3 py-1.5"
                    style={{ fontSize: '12px' }}
                  >
                    <Download size={14} /> Markdown (.md)
                  </a>
                </div>
              </div>
            </div>

            {/* Secondary Report Card: Master Engineering Report */}
            <div className="card border-0 shadow-sm rounded-3 overflow-hidden">
              <div className="card-header bg-white border-bottom py-2.5 px-3 d-flex align-items-center justify-content-between">
                <div className="d-flex align-items-center gap-2">
                  <span className="badge bg-secondary text-white px-2 py-1" style={{ fontSize: '10.5px' }}>
                    SYSTEM MASTER REPORT
                  </span>
                  <span className="fw-bold text-dark" style={{ fontSize: '13.5px' }}>
                    HostelGuard Enterprise v3.0 Master Presentation &amp; Report
                  </span>
                </div>
                <span className="text-muted small" style={{ fontSize: '11px' }}>
                  Full Suite
                </span>
              </div>
              <div className="card-body p-3">
                <p className="text-muted mb-3" style={{ fontSize: '12px', lineHeight: 1.5 }}>
                  Covers the entire system architecture: 21 BCNF relations, 13-layer anti-spoofing engine, 5-state risk decision matrix, geofence perimeter validation, and administrator exception desk workflows.
                </p>

                <div className="d-flex flex-wrap gap-2">
                  <a
                    href={masterReportUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-outline-dark btn-sm d-inline-flex align-items-center gap-1.5 fw-semibold px-3 py-1.5"
                    style={{ fontSize: '12px' }}
                  >
                    <ExternalLink size={14} /> View Master Report on GitHub
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="modal-footer bg-white border-top py-2.5 px-4 d-flex align-items-center justify-content-between">
            <span className="text-muted" style={{ fontSize: '11px' }}>
              Files are pre-compiled and served directly from the local Host/Server.
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm px-3"
              onClick={onClose}
              style={{ fontSize: '12px' }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
