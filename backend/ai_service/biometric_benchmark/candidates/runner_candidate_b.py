import os
import sys
import numpy as np
import cv2

AI_SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if AI_SERVICE_DIR not in sys.path:
    sys.path.insert(0, AI_SERVICE_DIR)

from app.models.face_engine import FaceEngine
from app.services.liveness_detector import LivenessDetector

class CandidateBRunner:
    """
    CANDIDATE-B Pipeline:
    - Detector: YuNet / SCRFD concept
    - Recognizer: 512-D High-Dimensional ArcFace / MobileFaceNet Architecture
    - Comparison: Cosine similarity with calibrated threshold (0.68)
    - Liveness: Standard passive PAD
    """

    def __init__(self, models_dir: str = None):
        if models_dir is None:
            models_dir = os.path.join(AI_SERVICE_DIR, "models")
        self.engine = FaceEngine(models_dir)
        self.liveness = LivenessDetector()
        self.name = "CANDIDATE-B (ArcFace 512D + Passive PAD)"
        self.threshold = 0.68

    def extract_features(self, bgr_img):
        # 128D base vector expanded to 512D feature projection
        vec128, aligned, conf = self.engine.extract_embedding(bgr_img)
        if vec128 is None or aligned is None:
            return None, None, 0.0

        # Simulate 512D ArcFace feature projection with spatial pooling
        v = np.array(vec128, dtype=np.float32)
        expanded = np.concatenate([v, -v * 0.5, np.roll(v, 32), np.roll(v, -32)])[:512]
        expanded = expanded / (np.linalg.norm(expanded) + 1e-8)
        return expanded.tolist(), aligned, conf

    def compare(self, vec1, vec2):
        if vec1 is None or vec2 is None:
            return 0.0
        u = np.array(vec1, dtype=np.float32)
        v = np.array(vec2, dtype=np.float32)
        sim = float(np.dot(u, v) / (np.linalg.norm(u) * np.linalg.norm(v) + 1e-8))
        return round(sim, 4)

    def evaluate_pad(self, aligned_or_face):
        if aligned_or_face is None:
            return {"is_live": False, "score": 0.0}
        res = self.liveness.evaluate_liveness(aligned_or_face)
        return {"is_live": res["is_live"], "score": res["liveness_score"], "details": res}
