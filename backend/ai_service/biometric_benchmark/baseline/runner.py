import os
import sys

# Ensure backend/ai_service is importable
AI_SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if AI_SERVICE_DIR not in sys.path:
    sys.path.insert(0, AI_SERVICE_DIR)

from app.models.face_engine import FaceEngine
from app.services.liveness_detector import LivenessDetector

class BaselineARunner:
    """
    BASELINE-A Pipeline:
    - Detector: OpenCV YuNet ONNX
    - Recognizer: OpenCV SFace ONNX (128-D)
    - Comparison: Cosine similarity (threshold 0.65)
    - Liveness: Multi-signal passive stack (Laplacian + FFT Moiré + YCrCb Skin)
    """

    def __init__(self, models_dir: str = None):
        if models_dir is None:
            models_dir = os.path.join(AI_SERVICE_DIR, "models")
        self.engine = FaceEngine(models_dir)
        self.liveness = LivenessDetector()
        self.name = "BASELINE-A (YuNet + SFace 128D + Passive PAD)"
        self.threshold = 0.65

    def extract_features(self, bgr_img):
        vec, aligned, conf = self.engine.extract_embedding(bgr_img)
        return vec, aligned, conf

    def compare(self, vec1, vec2):
        if vec1 is None or vec2 is None:
            return 0.0
        return self.engine.compute_cosine_similarity(vec1, vec2)

    def evaluate_pad(self, aligned_or_face):
        if aligned_or_face is None:
            return {"is_live": False, "score": 0.0}
        res = self.liveness.evaluate_liveness(aligned_or_face)
        return {"is_live": res["is_live"], "score": res["liveness_score"], "details": res}
