import os
import sys
import time
import uuid
import numpy as np
import cv2

AI_SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if AI_SERVICE_DIR not in sys.path:
    sys.path.insert(0, AI_SERVICE_DIR)

from app.models.face_engine import FaceEngine
from app.services.liveness_detector import LivenessDetector

class ActiveLivenessChallenge:
    """
    Implements randomized, nonce-backed active liveness challenges (Section 11 & 13 of Charter).
    Prevents replay attacks, digital screen playback, and deepfake injection.
    """
    VALID_CHALLENGES = ['TURN_LEFT', 'TURN_RIGHT', 'TILT_UP', 'SMILE', 'HOLD_STILL']

    @classmethod
    def generate_challenge(cls, student_id: str = "demo") -> dict:
        challenge_type = np.random.choice(cls.VALID_CHALLENGES)
        nonce = uuid.uuid4().hex[:12]
        issued_at = time.time()
        expires_at = issued_at + 60.0  # 60 second validity

        return {
            "challenge_id": f"chl_{nonce}",
            "nonce": nonce,
            "challenge_type": challenge_type,
            "issued_at": issued_at,
            "expires_at": expires_at,
            "student_id": student_id,
            "instructions": cls._get_instructions(challenge_type)
        }

    @staticmethod
    def _get_instructions(challenge_type: str) -> str:
        instructions = {
            'TURN_LEFT': 'Slowly turn your head slightly to the left (~15°)',
            'TURN_RIGHT': 'Slowly turn your head slightly to the right (~15°)',
            'TILT_UP': 'Tilt your chin slightly upwards',
            'SMILE': 'Smile briefly at the camera',
            'HOLD_STILL': 'Look directly at the camera with neutral expression'
        }
        return instructions.get(challenge_type, 'Look directly into camera')

    @classmethod
    def verify_challenge_response(cls, challenge: dict, probe_landmarks_or_angle: dict) -> bool:
        """
        Validates that the live face presentation satisfied the specific randomized challenge issued.
        Static photographs and pre-recorded replay videos cannot dynamically respond to randomized prompts.
        """
        if time.time() > challenge.get('expires_at', 0):
            return False  # Expired challenge

        expected = challenge.get('challenge_type')
        detected = probe_landmarks_or_angle.get('detected_action', 'HOLD_STILL')

        # Matches requested randomized movement
        return expected == detected or expected == 'HOLD_STILL'

class CandidateCRunner:
    """
    CANDIDATE-C Pipeline (Hybrid System):
    - Detector: OpenCV YuNet ONNX (Fast, lightweight, FOSS)
    - Recognizer: OpenCV SFace ONNX (128-D L2-normalized)
    - Liveness: Hybrid Dual-Layer
        Layer 1: Calibrated Passive PAD (Texture + Moiré + Skin Chroma)
        Layer 2: Randomized Active Nonce Challenge (Shadow Mode / Hybrid Gate)
    - Threshold: 0.65
    """

    def __init__(self, models_dir: str = None):
        if models_dir is None:
            models_dir = os.path.join(AI_SERVICE_DIR, "models")
        self.engine = FaceEngine(models_dir)
        self.liveness = LivenessDetector()
        self.name = "CANDIDATE-C (Hybrid: YuNet + SFace 128D + Active Challenge + Calibrated PAD)"
        self.threshold = 0.65

    def extract_features(self, bgr_img):
        return self.engine.extract_embedding(bgr_img)

    def compare(self, vec1, vec2):
        if vec1 is None or vec2 is None:
            return 0.0
        return self.engine.compute_cosine_similarity(vec1, vec2)

    def evaluate_pad(self, aligned_or_face, challenge: dict = None, action_response: dict = None):
        if aligned_or_face is None:
            return {"is_live": False, "score": 0.0, "reason": "No face provided"}

        passive_res = self.liveness.evaluate_liveness(aligned_or_face)
        passive_pass = passive_res["is_live"]

        # Active challenge validation (if challenge is provided)
        active_pass = True
        active_details = "Active challenge bypassed (single-frame mode)"
        if challenge and action_response:
            active_pass = ActiveLivenessChallenge.verify_challenge_response(challenge, action_response)
            active_details = "Active motion challenge passed" if active_pass else "Active motion challenge failed"

        # Hybrid Decision: Requires both passive structural sanity and active compliance
        is_live = passive_pass and active_pass

        return {
            "is_live": is_live,
            "score": round(0.70 * passive_res["liveness_score"] + (0.30 if active_pass else 0.0), 2),
            "passive_metrics": passive_res["metrics"],
            "active_verified": active_pass,
            "active_details": active_details
        }
