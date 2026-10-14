import os
import cv2
import numpy as np
import base64
import logging
from io import BytesIO
from PIL import Image

logger = logging.getLogger("face_engine")

class FaceEngine:
    def __init__(self, models_dir: str):
        self.models_dir = models_dir
        self.yunet_path = os.path.join(models_dir, "face_detection_yunet.onnx")
        self.sface_path = os.path.join(models_dir, "face_recognition_sface.onnx")

        self.detector = None
        self.recognizer = None
        self._init_models()

    def _init_models(self):
        # Auto-download models if missing
        yunet_ok = os.path.exists(self.yunet_path) and os.path.getsize(self.yunet_path) > 50000
        sface_ok = os.path.exists(self.sface_path) and os.path.getsize(self.sface_path) > 1000000

        if not yunet_ok or not sface_ok:
            try:
                ai_dir = os.path.dirname(os.path.abspath(self.models_dir))
                dl_script = os.path.join(ai_dir, "download_models.py")
                if os.path.exists(dl_script):
                    import importlib.util
                    spec = importlib.util.spec_from_file_location("download_models", dl_script)
                    mod = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(mod)
                    logger.info("Auto-downloading missing OpenCV YuNet and SFace models...")
                    mod.ensure_models_downloaded()
            except Exception as dl_err:
                logger.warning(f"Model auto-download notice: {dl_err}")

        if os.path.exists(self.yunet_path) and os.path.getsize(self.yunet_path) > 50000:
            logger.info("Initializing YuNet face detector...")
            self.detector = cv2.FaceDetectorYN.create(
                self.yunet_path,
                "",
                (320, 320),
                score_threshold=0.7,
                nms_threshold=0.3,
                top_k=5000
            )

        if os.path.exists(self.sface_path) and os.path.getsize(self.sface_path) > 1000000:
            logger.info("Initializing SFace 128D feature recognizer...")
            self.recognizer = cv2.FaceRecognizerSF.create(self.sface_path, "")

        if not self.detector or not self.recognizer:
            logger.warning("YuNet or SFace models missing! Fallback mode enabled.")

    def decode_image(self, image_data: str | bytes) -> np.ndarray:
        """
        Decodes base64 string or raw bytes into OpenCV BGR numpy array.
        """
        if isinstance(image_data, str):
            if "," in image_data:
                image_data = image_data.split(",")[1]
            image_bytes = base64.b64decode(image_data)
        else:
            image_bytes = image_data

        pil_img = Image.open(BytesIO(image_bytes)).convert("RGB")
        rgb_arr = np.array(pil_img)
        bgr_arr = cv2.cvtColor(rgb_arr, cv2.COLOR_RGB2BGR)
        return bgr_arr

    def detect_and_align_face(self, bgr_img: np.ndarray):
        """
        Detects primary face, extracts bounding box and aligned crop.
        """
        h, w, _ = bgr_img.shape
        if self.detector is None or self.recognizer is None:
            # Fallback using standard Haar cascade
            cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
            gray = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2GRAY)
            faces = cascade.detectMultiScale(gray, 1.3, 5)
            if len(faces) == 0:
                return None, None, None
            (x, y, fw, fh) = faces[0]
            face_crop = bgr_img[y:y+fh, x:x+fw]
            return face_crop, np.array([x, y, fw, fh]), None

        # Update YuNet input resolution
        self.detector.setInputSize((w, h))
        faces = self.detector.detect(bgr_img)

        if faces[1] is None or len(faces[1]) == 0:
            return None, None, None

        # Select the face with highest confidence score
        best_face = max(faces[1], key=lambda f: f[-1])
        confidence = float(best_face[-1])
        if confidence < 0.60:
            return None, None, None

        aligned_face = self.recognizer.alignCrop(bgr_img, best_face)
        bbox = best_face[:4].astype(int)
        return aligned_face, bbox, best_face

    def extract_embedding(self, bgr_img: np.ndarray) -> tuple[list[float] | None, np.ndarray | None, float]:
        """
        Detects face, aligns it, and computes 128-dimensional mathematical vector.
        """
        aligned_face, bbox, raw_face = self.detect_and_align_face(bgr_img)
        if aligned_face is None:
            return None, None, 0.0

        if self.recognizer is not None:
            feat = self.recognizer.feature(aligned_face)
            # Normalize embedding
            feat_norm = feat.flatten()
            norm = np.linalg.norm(feat_norm)
            if norm > 0:
                feat_norm = feat_norm / norm
            return feat_norm.tolist(), aligned_face, float(raw_face[-1] if raw_face is not None else 0.9)
        else:
            # Synthetic 128D projection from image histogram if model absent
            gray = cv2.cvtColor(aligned_face, cv2.COLOR_BGR2GRAY)
            resized = cv2.resize(gray, (64, 64))
            hist = cv2.calcHist([resized], [0], None, [128], [0, 256]).flatten()
            hist = hist / (np.linalg.norm(hist) + 1e-8)
            return hist.tolist(), aligned_face, 0.85

    def compute_cosine_similarity(self, vec1: list[float], vec2: list[float]) -> float:
        """
        Computes cosine similarity between two 128D vectors.
        Output range: [-1.0, 1.0] where 1.0 is identical.
        """
        u = np.array(vec1, dtype=np.float32)
        v = np.array(vec2, dtype=np.float32)

        dot = np.dot(u, v)
        norm_u = np.linalg.norm(u)
        norm_v = np.linalg.norm(v)

        if norm_u == 0 or norm_v == 0:
            return 0.0

        similarity = float(dot / (norm_u * norm_v))
        return round(similarity, 4)
