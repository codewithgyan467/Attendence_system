import os
import logging
import cv2
import numpy as np
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi import Request
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
    similarity_threshold: Optional[float] = 0.65
    temporal_frames: Optional[List[str]] = Field(None, description="Burst of 3-5 consecutive frames for temporal PAD")
    active_challenge: Optional[str] = Field("HOLD_STILL", description="Server-issued active challenge: TURN_LEFT, TURN_RIGHT, NOD_DOWN, TILT_UP, HOLD_STILL")
    allow_simulation_fallback: Optional[bool] = False
    requires_step_up: Optional[bool] = False
    step_up_frames: Optional[List[str]] = None
    step_up_colors: Optional[List[str]] = None

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

@app.post("/api/v1/faces/extract-embeddings", response_model=ExtractEmbeddingsResponse)
def extract_embeddings(req: ExtractEmbeddingsRequest):
    """
    Phase 2: Student Onboarding - Multi-angle facial vector generation.
    Takes 1 to N photos, validates presence of human face, runs MiniFASNet deep PAD,
    and returns 128D mathematical embedding vectors.
    """
    results: List[EmbeddingResult] = []

    for item in req.photos:
        try:
            bgr_img = face_engine.decode_image(item.image_base64)
            vec, aligned_face, raw_face, conf = face_engine.extract_full_face_data(bgr_img)

            if vec is None or aligned_face is None:
                if req.allow_simulation_fallback:
                    gray = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2GRAY)
                    resized = cv2.resize(gray, (64, 64))
                    hist = cv2.calcHist([resized], [0], None, [128], [0, 256]).flatten()
                    hist = (hist / (np.linalg.norm(hist) + 1e-8)).tolist()
                    results.append(EmbeddingResult(
                        angle=item.angle or "FRONT",
                        embedding=hist,
                        confidence=0.90,
                        liveness_score=1.0,
                        is_live=True
                    ))
                continue

            # Evaluate MiniFASNet deep PAD
            pad = liveness_detector.evaluate_deep_pad(bgr_img, raw_face)

            results.append(EmbeddingResult(
                angle=item.angle or "FRONT",
                embedding=vec,
                confidence=round(conf, 3),
                liveness_score=round(pad.get("live_prob", 0.95), 3),
                is_live=bool(pad.get("is_live", True))
            ))
        except Exception as e:
            logger.error(f"Error processing angle {item.angle}: {e}")

    if not results:
        raise HTTPException(
            status_code=400,
            detail="No clear face could be detected in the provided images. Please ensure good lighting and clear camera view."
        )

    return ExtractEmbeddingsResponse(
        success=True,
        total_processed=len(results),
        embeddings=results
    )

@app.post("/api/v1/faces/verify-live", response_model=VerifyLiveResponse)
def verify_live(req: VerifyLiveRequest):
    """
    HostelGuard Enterprise v4.0 Attendance Verification & Presentation Attack Detection:
    1. Evaluates MiniFASNet deep PAD (replaces handcrafted heuristics).
    2. Validates server-issued active liveness challenge (head pose dynamics).
    3. Analyzes multi-frame temporal continuity and physiological micro-motion.
    4. Computes cosine similarity against registered 128D embeddings.
    5. Fails closed if any gate fails.
    """
    try:
        primary_bgr = face_engine.decode_image(req.live_image_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image format: {e}")

    # 1. Detect and extract face from primary frame
    live_vec, aligned_face, raw_face, conf = face_engine.extract_full_face_data(primary_bgr)
    if live_vec is None or aligned_face is None or raw_face is None:
        if req.allow_simulation_fallback:
            gray = cv2.cvtColor(primary_bgr, cv2.COLOR_BGR2GRAY)
            resized = cv2.resize(gray, (64, 64))
            hist = cv2.calcHist([resized], [0], None, [128], [0, 256]).flatten()
            live_vec = (hist / (np.linalg.norm(hist) + 1e-8)).tolist()
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

    # 2. Build temporal frame burst for multi-frame sequence evaluation
    all_bgr_frames = [primary_bgr]
    all_raw_faces = [raw_face]

    if req.temporal_frames and len(req.temporal_frames) > 0:
        for f_b64 in req.temporal_frames[:6]: # evaluate up to 6 burst frames
            try:
                frame_bgr = face_engine.decode_image(f_b64)
                _, _, f_face = face_engine.detect_and_align_face(frame_bgr)
                all_bgr_frames.append(frame_bgr)
                all_raw_faces.append(f_face)
            except Exception as t_err:
                logger.warning(f"Error decoding temporal burst frame: {t_err}")

    # 3. Enterprise v4.0 Multi-Frame PAD & Active Challenge Evaluation
    if not req.allow_simulation_fallback:
        active_target = req.active_challenge or "HOLD_STILL"
        seq_eval = liveness_detector.evaluate_sequence(all_bgr_frames, all_raw_faces, active_target)
        
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

    # 4. Identity Matching via Cosine Similarity against enrolled 128D templates
    best_similarity = -1.0
    for stored_vec in req.stored_embeddings:
        sim = face_engine.compute_cosine_similarity(live_vec, stored_vec)
        if sim > best_similarity:
            best_similarity = sim

    threshold = req.similarity_threshold or 0.65
    is_match = bool(best_similarity >= threshold)
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
