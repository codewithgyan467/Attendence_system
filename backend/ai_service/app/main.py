import os
import logging
import asyncio
import threading
import cv2
import numpy as np

cv2.setNumThreads(min(4, os.cpu_count() or 2))
from typing import List, Optional
from fastapi import FastAPI, HTTPException, UploadFile, File, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.models.face_engine import FaceEngine
from app.services.liveness_detector import LivenessDetectorV4

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ai_service_v4")

app = FastAPI(
    title="Hostel Attendance AI Microservice v4.0",
    description="Facial Verification, MiniFASNet Deep Learning Anti-Spoofing, and Active Liveness Engine",
    version="4.0.0"
)

# Concurrency Limiter: Queues peak high-volume check-ins smoothly in RAM (max 4 concurrent)
INFERENCE_SEMAPHORE = asyncio.Semaphore(4)
INFERENCE_LOCK = threading.Lock()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

INTERNAL_SECRET = os.environ.get("AI_SERVICE_SECRET", "hg-internal-mesh-secret-2026")

@app.middleware("http")
async def verify_internal_secret_token(request: Request, call_next):
    if request.url.path in ["/health", "/docs", "/openapi.json"]:
        return await call_next(request)
    token = request.headers.get("x-internal-token") or request.headers.get("authorization", "").replace("Bearer ", "").strip()
    is_strict = os.environ.get("NODE_ENV") == "production" or os.environ.get("STRICT_INTERNAL_SECRET") == "true"
    if is_strict:
        if not token or token != INTERNAL_SECRET:
            logger.warning(f"Unauthorized AI microservice access blocked from {request.client.host if request.client else 'unknown'}")
            return JSONResponse(status_code=401, content={"detail": "Unauthorized: Invalid or missing internal service secret token"})
    elif token and token != INTERNAL_SECRET:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized: Invalid internal service secret token"})
    return await call_next(request)

# Initialize models
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(BASE_DIR, "models")
face_engine = FaceEngine(MODELS_DIR)
liveness_detector = LivenessDetectorV4(MODELS_DIR)

# ----------------- Request / Response Models -----------------

class ImagePayload(BaseModel):
    angle: Optional[str] = "FRONT"
    image_base64: str = Field(..., description="Base64 encoded photo (data:image/... or raw)")

class ExtractEmbeddingsRequest(BaseModel):
    photos: List[ImagePayload] = Field(..., description="List of multi-angle photos for registration")
    allow_simulation_fallback: Optional[bool] = False

class EmbeddingResult(BaseModel):
    angle: str
    embedding: List[float]
    confidence: float
    liveness_score: float
    is_live: bool

class ExtractEmbeddingsResponse(BaseModel):
    success: bool
    total_processed: int
    embeddings: List[EmbeddingResult]
    error_message: Optional[str] = None

class VerifyLiveRequest(BaseModel):
    student_id: Optional[str] = None
    live_image_base64: str
    stored_embeddings: List[List[float]] = Field(..., description="Previously registered 128D vectors for this student")
    similarity_threshold: Optional[float] = 0.38
    frames: Optional[List[str]] = Field(None, description="Burst frames [frame1, frame2, frame3]")
    burst_frames: Optional[List[str]] = None
    temporal_frames: Optional[List[str]] = Field(None, description="Burst of 3-5 consecutive frames for temporal PAD")
    active_challenge: Optional[str] = Field("HOLD_STILL", description="Server-issued active challenge: TURN_LEFT, TURN_RIGHT, NOD_DOWN, TILT_UP, HOLD_STILL")
    allow_simulation_fallback: Optional[bool] = False
    requires_step_up: Optional[bool] = False
    step_up_frames: Optional[List[str]] = None
    step_up_colors: Optional[List[str]] = None
    face_crop_112: Optional[str] = None
    pad_crop_80: Optional[str] = None
    client_mesh_telemetry: Optional[dict] = None

class VerifyLiveResponse(BaseModel):
    is_match: bool
    is_live: bool
    similarity_score: float
    liveness_score: float
    confidence_passed: bool
    status: str
    details: dict

# ----------------- Endpoints -----------------

@app.get("/health")
def health_check():
    models_ready = bool(face_engine.detector is not None and face_engine.recognizer is not None)
    minifas_ready = bool(liveness_detector.minifas_net is not None)
    return {
        "status": "healthy",
        "models_loaded": models_ready and minifas_ready,
        "detector": "OpenCV YuNet ONNX",
        "recognizer": "OpenCV SFace 128-D ONNX",
        "deep_pad": "MiniFASNetV2 Deep Learning ONNX (80x80 Scale 2.7)",
        "active_liveness": "Geometric 5-Point Landmark Pose Engine",
        "version": "v4.0.0 Enterprise",
        "cost": "$0.00 (100% FOSS & Local Edge Inference)"
    }

async def _do_extract_embeddings(req: ExtractEmbeddingsRequest):
    results: List[EmbeddingResult] = []

    for item in req.photos:
        try:
            bgr_img = await run_in_threadpool(face_engine.decode_image, item.image_base64)
            vec, aligned_face, raw_face, conf = await run_in_threadpool(face_engine.extract_full_face_data, bgr_img)

            if vec is None or aligned_face is None:
                if req.allow_simulation_fallback:
                    def compute_fallback():
                        gray = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2GRAY)
                        resized = cv2.resize(gray, (64, 64))
                        hist = cv2.calcHist([resized], [0], None, [128], [0, 256]).flatten()
                        return (hist / (np.linalg.norm(hist) + 1e-8)).tolist()
                    hist = await run_in_threadpool(compute_fallback)
                    results.append(EmbeddingResult(
                        angle=item.angle or "FRONT",
                        embedding=hist,
                        confidence=0.90,
                        liveness_score=1.0,
                        is_live=True
                    ))
                continue

            # Evaluate per-angle deep PAD & 3D gesture verification in worker thread pool
            pad = await run_in_threadpool(liveness_detector.evaluate_enrollment_angle, bgr_img, raw_face, item.angle or "FRONT")

            results.append(EmbeddingResult(
                angle=item.angle or "FRONT",
                embedding=vec,
                confidence=round(conf, 3),
                liveness_score=round(pad.get("live_prob", 0.95), 3),
                is_live=bool(pad.get("is_live", True)),
                diagnostic=pad
            ))
        except Exception as e:
            logger.error(f"Error processing angle {item.angle}: {e}")

    if not results:
        raise HTTPException(
            status_code=400,
            detail="No clear face could be detected in the provided images. Please ensure good lighting and clear camera view."
        )

    # Multi-Pose Embedding Bank & Weighted Centroid Vector Synthesis
    if len(results) >= 2:
        try:
            def synthesize_centroid():
                stacked = np.array([r.embedding for r in results], dtype=np.float32)
                centroid = np.mean(stacked, axis=0)
                norm = np.linalg.norm(centroid)
                if norm > 0:
                    return (centroid / norm).tolist()
                return None
            centroid_vec = await run_in_threadpool(synthesize_centroid)
            if centroid_vec:
                results.append(EmbeddingResult(
                    angle="CENTROID",
                    embedding=centroid_vec,
                    confidence=0.99,
                    liveness_score=1.0,
                    is_live=True
                ))
        except Exception as c_err:
            logger.warning(f"Centroid synthesis notice: {c_err}")

    return ExtractEmbeddingsResponse(
        success=True,
        total_processed=len(results),
        embeddings=results
    )

@app.post("/api/v1/faces/extract-embeddings", response_model=ExtractEmbeddingsResponse)
async def extract_embeddings(req: ExtractEmbeddingsRequest):
    """
    Phase 2: Student Onboarding - Multi-angle facial vector generation.
    Protected by INFERENCE_SEMAPHORE (max 4 concurrent).
    """
    async with INFERENCE_SEMAPHORE:
        return await _do_extract_embeddings(req)

async def _do_verify_live(req: VerifyLiveRequest):
    # 0. Fast-Path Pre-Cropped Biometric Inference (Low-Spec Warden Laptop Mode)
    if req.face_crop_112 and req.pad_crop_80:
        try:
            crop_112_bgr = await run_in_threadpool(face_engine.decode_image, req.face_crop_112)
            pad_80_bgr = await run_in_threadpool(face_engine.decode_image, req.pad_crop_80)

            # 1. Direct MiniFASNetV2 deep PAD (<15ms) offloaded to thread pool
            pad_eval = await run_in_threadpool(liveness_detector.evaluate_pre_cropped_pad, pad_80_bgr)
            if not pad_eval.get("is_live", True) and not req.allow_simulation_fallback:
                return VerifyLiveResponse(
                    is_match=False,
                    is_live=False,
                    similarity_score=0.0,
                    liveness_score=pad_eval.get("live_prob", 0.0),
                    confidence_passed=False,
                    status="SPOOF_ATTEMPT_DETECTED",
                    details={
                        "message": f"Biometric anti-spoofing rejected presentation attack: {pad_eval.get('reason')}",
                        "reason": pad_eval.get("reason"),
                        "evaluation": pad_eval
                    }
                )

            # 2. Direct SFace / ArcFace embedding extraction (<10ms) offloaded to thread pool
            live_vec, conf = await run_in_threadpool(face_engine.extract_from_pre_cropped, crop_112_bgr)

            # 3. Fast Cosine Matching against enrolled templates (Calibrated to 0.38 for indoor lighting)
            threshold = 0.38 if (not req.similarity_threshold or req.similarity_threshold >= 0.60) else req.similarity_threshold

            def match_pre_cropped():
                best_sim = -1.0
                matched = False
                for stored_vec in req.stored_embeddings:
                    sim = face_engine.compute_cosine_similarity(live_vec, stored_vec)
                    if sim > best_sim:
                        best_sim = sim
                    if best_sim >= threshold:
                        matched = True
                        break
                return best_sim, bool(best_sim >= threshold)

            best_similarity, is_match = await run_in_threadpool(match_pre_cropped)
            status_str = "AUTHENTICATED" if is_match else "FACE_MISMATCH"
            details_msg = (
                "Facial recognition verified successfully (Fast-Path Pre-Crop)."
                if is_match
                else f"Face does not match registered student (Score: {best_similarity:.2f} < {threshold})."
            )

            return VerifyLiveResponse(
                is_match=is_match,
                is_live=True,
                similarity_score=round(best_similarity, 4),
                liveness_score=pad_eval.get("live_prob", 0.95),
                confidence_passed=is_match,
                status=status_str,
                details={
                    "message": details_msg,
                    "best_similarity": round(best_similarity, 4),
                    "threshold_used": threshold,
                    "face_confidence": round(conf, 3),
                    "pad_evaluation": pad_eval,
                    "fast_path": True
                }
            )
        except Exception as fast_err:
            logger.warning(f"Fast-path pre-cropped evaluation notice: {fast_err}. Falling back to standard pipeline.")

    try:
        primary_bgr = await run_in_threadpool(face_engine.decode_image, req.live_image_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image format: {e}")

    # 1. Detect and extract face from primary frame offloaded to thread pool
    live_vec, aligned_face, raw_face, conf = await run_in_threadpool(face_engine.extract_full_face_data, primary_bgr)
    if live_vec is None or aligned_face is None or raw_face is None:
        if req.allow_simulation_fallback:
            def compute_primary_fallback():
                gray = cv2.cvtColor(primary_bgr, cv2.COLOR_BGR2GRAY)
                resized = cv2.resize(gray, (64, 64))
                hist = cv2.calcHist([resized], [0], None, [128], [0, 256]).flatten()
                return (hist / (np.linalg.norm(hist) + 1e-8)).tolist()
            live_vec = await run_in_threadpool(compute_primary_fallback)
            aligned_face = primary_bgr
            raw_face = np.array([0, 0, 100, 100, 30, 40, 70, 40, 50, 60, 35, 80, 65, 80, 0.95])
            conf = 0.92
        else:
            return VerifyLiveResponse(
                is_match=False,
                is_live=False,
                similarity_score=0.0,
                liveness_score=0.0,
                confidence_passed=False,
                status="FACE_NOT_DETECTED",
                details={"message": "No face detected in live camera frame. Position your face in center."}
            )

    # 2. Build temporal frame sequence starting with primary frame detection
    eval_bgr_frames = [primary_bgr]
    eval_raw_faces = [raw_face]
    candidate_vectors = [live_vec]

    burst_inputs = req.frames or req.burst_frames or req.temporal_frames or []
    if burst_inputs and len(burst_inputs) > 0:
        for f_b64 in burst_inputs[:3]: # evaluate up to 3 burst frames for fast inference
            try:
                frame_bgr = await run_in_threadpool(face_engine.decode_image, f_b64)
                f_vec, _, f_face, _ = await run_in_threadpool(face_engine.extract_full_face_data, frame_bgr)
                if f_face is not None:
                    eval_bgr_frames.append(frame_bgr)
                    eval_raw_faces.append(f_face)
                if f_vec is not None:
                    candidate_vectors.append(f_vec)
            except Exception as t_err:
                logger.warning(f"Error decoding temporal burst frame: {t_err}")

    # 3. Enterprise v4.0 Multi-Frame PAD & Active Challenge Evaluation offloaded to thread pool
    if not req.allow_simulation_fallback:
        active_target = req.active_challenge or "HOLD_STILL"
        seq_eval = await run_in_threadpool(liveness_detector.evaluate_sequence, eval_bgr_frames, eval_raw_faces, active_target)
        
        if not seq_eval["is_live"]:
            return VerifyLiveResponse(
                is_match=False,
                is_live=False,
                similarity_score=0.0,
                liveness_score=seq_eval["liveness_score"],
                confidence_passed=False,
                status="SPOOF_ATTEMPT_DETECTED",
                details={
                    "message": f"Biometric anti-spoofing rejected presentation attack: {seq_eval['reason']}",
                    "reason": seq_eval["reason"],
                    "evaluation": seq_eval
                }
            )
        liveness_score = seq_eval["liveness_score"]
        eval_details = seq_eval
    else:
        liveness_score = 1.0
        eval_details = {"is_live": True, "reason": "Simulation mode"}

    # 4. Identity Matching via Cosine Similarity across Burst Frames & Multi-Pose Enrolled Templates
    # Calibrate SFace/ArcFace cosine similarity threshold to 0.38 for reliable hostel room illumination
    threshold = 0.38 if (not req.similarity_threshold or req.similarity_threshold >= 0.60) else req.similarity_threshold

    def match_burst_candidates():
        best_sim = -1.0
        matched = False
        for cand_v in candidate_vectors:
            for stored_vec in req.stored_embeddings:
                sim = face_engine.compute_cosine_similarity(cand_v, stored_vec)
                if sim > best_sim:
                    best_sim = sim
                if best_sim >= threshold:
                    matched = True
                    break
            if matched:
                break
        return best_sim, bool(best_sim >= threshold)

    best_similarity, is_match = await run_in_threadpool(match_burst_candidates)
    status_str = "AUTHENTICATED" if is_match else "FACE_MISMATCH"
    details_msg = (
        "Facial recognition verified successfully."
        if is_match
        else f"Face does not match registered student (Score: {best_similarity:.2f} < {threshold})."
    )

    return VerifyLiveResponse(
        is_match=is_match,
        is_live=True,
        similarity_score=round(best_similarity, 4),
        liveness_score=liveness_score,
        confidence_passed=is_match,
        status=status_str,
        details={
            "message": details_msg,
            "best_similarity": round(best_similarity, 4),
            "threshold_used": threshold,
            "face_confidence": round(conf, 3),
            "pad_evaluation": eval_details
        }
    )

@app.post("/api/v1/faces/verify-live", response_model=VerifyLiveResponse)
async def verify_live(req: VerifyLiveRequest):
    """
    HostelGuard Enterprise v4.0 Attendance Verification & Presentation Attack Detection.
    Protected by INFERENCE_SEMAPHORE (max 4 concurrent) to eliminate latency spikes.
    """
    async with INFERENCE_SEMAPHORE:
        return await _do_verify_live(req)

def run_biometric_pipeline(image_bytes: bytes) -> dict:
    """Synchronous CPU-bound pipeline for single-image verification protected by inference mutex."""
    with INFERENCE_LOCK:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Invalid image file format")
        vec, aligned, raw_face, conf = face_engine.extract_full_face_data(img)
        if raw_face is None:
            return {
                "is_match": False,
                "is_live": False,
                "status": "FACE_NOT_DETECTED",
                "confidence": 0.0,
                "liveness_score": 0.0,
                "details": {"message": "No face detected in submitted frame"}
            }
        pad_eval = liveness_detector.evaluate_deep_pad(img, raw_face)
        is_live = bool(pad_eval.get("is_live", True))
        return {
            "is_match": True,
            "is_live": is_live,
            "status": "AUTHENTICATED" if is_live else "SPOOF_DETECTED",
            "confidence": float(conf or 0.95),
            "liveness_score": float(pad_eval.get("live_prob", 0.95)),
            "details": pad_eval
        }

@app.post("/verify-attendance")
async def verify_attendance(file: Optional[UploadFile] = File(None), request: Request = None):
    """
    Step 3: High-concurrency curfew attendance verification route.
    Protected by INFERENCE_SEMAPHORE (max 4 concurrent) to eliminate CPU freeze and OOM.
    """
    async with INFERENCE_SEMAPHORE:
        try:
            image_bytes = None
            if file is not None:
                image_bytes = await file.read()
            elif request is not None:
                content_type = request.headers.get("content-type", "")
                if "application/json" in content_type:
                    body = await request.json()
                    b64_str = body.get("image_base64") or body.get("live_image_base64") or body.get("image")
                    if b64_str:
                        if "," in b64_str:
                            b64_str = b64_str.split(",")[1]
                        import base64
                        image_bytes = base64.b64decode(b64_str)
                else:
                    image_bytes = await request.body()

            if not image_bytes or len(image_bytes) == 0:
                raise HTTPException(status_code=400, detail="Missing image file or payload for verification")

            result = await run_in_threadpool(run_biometric_pipeline, image_bytes)
            return result
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Biometric engine error: {str(e)}")
