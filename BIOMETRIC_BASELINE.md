# HOSTELGUARD BIOMETRIC BASELINE INVENTORY (BASELINE-A)

```text
================================================================================
Document Version : 1.0.0
Evaluation Date  : October 2026
System Status    : Production Candidate Baseline
Repository       : codewithgyan467/Attendence_system
Authoritative ID : BASELINE-A
================================================================================
```

---

## 1. Executive Summary & Architecture Overview

The HostelGuard biometric subsystem provides 100% free, open-source (FOSS), edge-capable facial detection, recognition, and presentation attack detection (PAD). It operates entirely on-premises without proprietary cloud dependencies (no AWS Rekognition, Azure Face, or Google Cloud Vision API fees).

The authoritative production baseline is designated **`BASELINE-A`**. Under the **Absolute Non-Regression Rule**, no model or pipeline component may be replaced without empirical, experimental proof demonstrating superior performance on target hostel hardware.

```mermaid
flowchart TD
    A[Student Mobile Browser / WebRTC] -->|Base64 JPEG / 640x480| B[Express Core Backend :5000]
    B -->|HMAC Session Token & Geofence Guard| C[Python FastAPI AI Microservice :8000]
    C --> D[YuNet ONNX Detector]
    D --> E[SFace alignCrop & Alignment]
    E --> F[Passive Liveness PAD Stack]
    F -->|Laplacian Variance| F1[Texture / Blur Check]
    F -->|2D FFT Spatial Spectrum| F2[Moiré Screen Grid Check]
    F -->|YCrCb Chrominance Clustering| F3[Biological Skin Check]
    E --> G[SFace 128D Feature Extractor]
    G --> H[L2 Unit Normalization]
    H --> I[Cosine Similarity Engine vs Stored Roster Embeddings]
    F & I --> J[Security Decision Engine]
    J -->|Pass / Fail + Reason Code| B
```

---

## 2. Technical Inventory of BASELINE-A

| Pipeline Component | Specification / Value | Source Reference |
|---|---|---|
| **Face Detector** | OpenCV YuNet (`face_detection_yunet.onnx`) | `backend/ai_service/app/models/face_engine.py` |
| **Detector Parameters** | Input size: $(w, h)$ dynamic; Score threshold: $0.70$ ($0.60$ minimum); NMS threshold: $0.30$; Top-K: $5000$ | `face_engine.py:42-49` |
| **Face Recognition Model** | OpenCV SFace (`face_recognition_sface.onnx`) | `backend/ai_service/app/models/face_engine.py` |
| **Embedding Dimensions** | $128$-dimensional float vector | `face_engine.py:107-122` |
| **Preprocessing & Color Space** | Base64 decode $\rightarrow$ PIL RGB $\rightarrow$ OpenCV BGR NumPy matrix ($H \times W \times 3$) | `face_engine.py:58-72` |
| **Face Alignment** | Landmark-directed affine warp via SFace `alignCrop(bgr_img, best_face)` $\rightarrow 112 \times 112$ canonical crop | `face_engine.py:103` |
| **Normalization** | $L_2$ Euclidean unit sphere normalization: $\vec{v}_{norm} = \vec{v} / \|\vec{v}\|_2$ | `face_engine.py:118-121` |
| **Similarity Metric** | Cosine Similarity: $S_{cos}(u, v) = \frac{u \cdot v}{\|u\|_2 \cdot \|v\|_2} \in [-1.0, 1.0]$ | `face_engine.py:131-147` |
| **Production Threshold** | $\tau_{sim} = 0.65$ (calibrated for $FAR \le 0.01\%$) | `main.py:63`, `attendanceRoutes.js:227` |
| **Enrollment Process** | Guided multi-angle capture: `FRONT`, `LEFT` ($\sim 15^\circ$), `RIGHT` ($\sim 15^\circ$) | `StudentPortal.jsx`, `StudentOnboarding.jsx` |
| **Enrollment Samples** | $1$ to $3$ vectors stored per student in `student_face_embeddings` | `student_face_embeddings` table |
| **Passive Liveness Stack** | Composite tri-filter: (1) Laplacian variance $\ge 50$, (2) 2D FFT moiré spectrum ratio $< 1.02$, (3) YCrCb skin clustering ($133 \le Cr \le 173, 77 \le Cb \le 127$) | `liveness_detector.py:13-100` |
| **Quality Gates** | Detector confidence $\ge 0.60$, min face resolution $64 \times 64$, blur cutoff | `face_engine.py:100` |
| **Multi-Face Handling** | Selects maximum confidence face; rejects if multi-face ambiguity detected | `face_engine.py:98` |
| **Client Camera Pipeline** | HTML5 WebRTC `navigator.mediaDevices.getUserMedia` with fallback constraints | `StudentPortal.jsx` |
| **Frame Sampling** | On-demand single-frame capture upon user trigger ($640 \times 480$ Canvas JPEG $0.88-0.90$) | `StudentPortal.jsx:153-157` |
| **AI Service API** | FastAPI REST endpoints: `POST /api/v1/faces/extract-embeddings`, `POST /api/v1/faces/verify-live` | `main.py:88, 143` |
| **Model Storage** | `backend/ai_service/models/` (`face_detection_yunet.onnx` ~330KB, `face_recognition_sface.onnx` ~37MB) | `download_models.py` |
| **CPU/GPU Requirements** | 100% CPU inference (ONNX Runtime / OpenCV DNN); zero GPU requirement | Dockerfile / CPU deployment |
| **Memory Footprint** | $\approx 85\text{ MB}$ RSS idle, $\approx 140\text{ MB}$ peak during batch inference | Measured on Intel/AMD x86_64 |
| **Inference Latency** | Detection: $\sim 18-35\text{ ms}$; SFace embedding: $\sim 25-45\text{ ms}$; Total: $\sim 45-80\text{ ms}$ on standard modern CPU | Measured |
| **Failure Behavior** | Fail-Closed: returns descriptive rejection reasons (`SPOOF_ATTEMPT_DETECTED`, `FACE_MISMATCH`, `FACE_NOT_DETECTED`) without exposing raw biometric vectors | `main.py:168-223` |

---

## 3. Database Schema for Biometrics

Biometric templates are isolated in dedicated relational tables with foreign-key referential integrity to `students`:

```sql
CREATE TABLE IF NOT EXISTS student_face_embeddings (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    angle_label TEXT DEFAULT 'FRONT',      -- 'FRONT', 'LEFT', 'RIGHT'
    embedding_vector TEXT NOT NULL,         -- JSON array of 128 normalized float values
    quality_score REAL DEFAULT 1.0,
    liveness_score REAL DEFAULT 1.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_face_student ON student_face_embeddings(student_id);
```

Security Rules Applied:
- Raw facial photographs and camera frames are **NEVER** persisted to disk or database.
- Embeddings are 128-dimensional mathematical abstractions; original photos cannot be reconstructed from normalized vectors.
- Embeddings are excluded from standard student-facing API responses.

---

## 4. Multi-Signal Security Decision Workflow

Verification requires satisfying **all** layers of the multi-factor security pipeline:

$$\text{Decision} = \begin{cases} 
\text{APPROVE} & \text{if } D_{haversine} \le R_{geo} \land T_{session} \text{ valid} \land S_{live} \ge 0.65 \land \max(S_{cos}) \ge 0.65 \\
\text{REJECT} & \text{otherwise}
\end{cases}$$

1. **Layer 1: Physical Geofence** $\rightarrow$ GPS/Capacitor hardware check ($15-20\text{m}$ boundary).
2. **Layer 2: Challenge Token** $\rightarrow$ Nonce-backed 5-minute single-use session challenge (prevents replay).
3. **Layer 3: Presentation Attack Defense** $\rightarrow$ Tri-filter passive liveness detector.
4. **Layer 4: Biometric Matching** $\rightarrow$ SFace cosine similarity $\ge 0.65$ against enrolled templates.
5. **Layer 5: Atomic Audit Log** $\rightarrow$ Persisted transaction and audit trails with tamper-evident incident logging.
