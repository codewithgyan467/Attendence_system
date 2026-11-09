import os
import cv2
import numpy as np
import base64
import logging
from io import BytesIO
from PIL import Image

# Optimize OpenCV thread pool for sub-500ms multi-core execution
cv2.setNumThreads(min(4, os.cpu_count() or 2))

# Low-CPU ONNX Runtime Configuration for Dual-Core Warden Office Laptops
try:
    import onnxruntime as ort
    ort_session_options = ort.SessionOptions()
    ort_session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    ort_session_options.intra_op_num_threads = 2
    ort_session_options.inter_op_num_threads = 1
    ort_session_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
except ImportError:
    ort_session_options = None

logger = logging.getLogger("face_engine")

class FaceEngine:
    def __init__(self, models_dir: str):
        self.models_dir = models_dir
        self.yunet_path = os.path.join(models_dir, "face_detection_yunet.onnx")
        self.sface_path = os.path.join(models_dir, "face_recognition_sface.onnx")
        self.arcface_path = os.path.join(models_dir, "face_recognition_arcface.onnx")

        self.detector = None
        self.recognizer = None
        self.arcface_net = None
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
                    logger.info("Auto-downloading missing OpenCV YuNet, SFace, and ArcFace models...")
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

        if os.path.exists(self.arcface_path) and os.path.getsize(self.arcface_path) > 1000000:
            try:
                self.arcface_net = cv2.dnn.readNetFromONNX(self.arcface_path)
                logger.info("Initializing InsightFace MobileFaceNet ArcFace 512D deep feature recognizer...")
            except Exception as arc_err:
                logger.warning(f"ArcFace ONNX load notice: {arc_err}")
                self.arcface_net = None

        if not self.detector or (not self.recognizer and not self.arcface_net):
            logger.warning("YuNet or face recognition models missing! Fallback mode enabled.")

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

        # Proportionally downscale large images > 512px for sub-500ms inference
        h, w = bgr_arr.shape[:2]
        max_dim = max(h, w)
        if max_dim > 512:
            scale = 512.0 / max_dim
            new_w, new_h = int(w * scale), int(h * scale)
            bgr_arr = cv2.resize(bgr_arr, (new_w, new_h), interpolation=cv2.INTER_AREA)

        return bgr_arr

    def apply_clahe_lab(self, bgr_img: np.ndarray) -> np.ndarray:
        """
        Applies Contrast Limited Adaptive Histogram Equalization (CLAHE) on the L (luminance)
        channel in LAB color space. Normalizes shadows, backlight, and dim indoor hostel lighting
        without altering facial chrominance.
        """
        if bgr_img is None:
            return bgr_img
        try:
            lab = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2LAB)
            l, a, b = cv2.split(lab)
            clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
            cl = clahe.apply(l)
            limg = cv2.merge((cl, a, b))
            return cv2.cvtColor(limg, cv2.COLOR_LAB2BGR)
        except Exception as e:
            logger.warning(f"CLAHE normalization warning: {e}")
            return bgr_img

    def detect_and_align_face(self, bgr_img: np.ndarray):
        """
        Detects primary face, extracts bounding box and aligned crop.
        Enhanced with CLAHE illumination normalization and 25% border padding fallback.
        """
        if bgr_img is None:
            return None, None, None
        h, w, _ = bgr_img.shape

        # Illumination and backlight normalization
        enhanced_img = self.apply_clahe_lab(bgr_img)

        if self.detector is None or self.recognizer is None:
            # Fallback using standard Haar cascade
            cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
            gray = cv2.cvtColor(enhanced_img, cv2.COLOR_BGR2GRAY)
            faces = cascade.detectMultiScale(gray, 1.2, 4)
            if len(faces) == 0:
                return None, None, None
            (x, y, fw, fh) = faces[0]
            face_crop = enhanced_img[y:y+fh, x:x+fw]
            return face_crop, np.array([x, y, fw, fh]), None

        # Pass 1: Standard YuNet detection on CLAHE-enhanced image
        self.detector.setInputSize((w, h))
        self.detector.setScoreThreshold(0.60)
        faces = self.detector.detect(enhanced_img)

        best_face = None
        if faces[1] is not None and len(faces[1]) > 0:
            candidate = max(faces[1], key=lambda f: f[-1])
            if float(candidate[-1]) >= 0.60:
                best_face = candidate

        # Pass 2: Multi-Scale & Padded Fallback Detection
        # When face fills >= 75% of frame (close-up mobile selfie), YuNet often misses boundary points.
        # Adding 25% border padding allows YuNet to cleanly detect edges and facial features.
        if best_face is None:
            pad_x = max(16, int(w * 0.25))
            pad_y = max(16, int(h * 0.25))
            padded_img = cv2.copyMakeBorder(enhanced_img, pad_y, pad_y, pad_x, pad_x, cv2.BORDER_REFLECT)
            pw, ph = w + 2 * pad_x, h + 2 * pad_y
            self.detector.setInputSize((pw, ph))
            self.detector.setScoreThreshold(0.45)
            padded_faces = self.detector.detect(padded_img)

            if padded_faces[1] is not None and len(padded_faces[1]) > 0:
                padded_best = max(padded_faces[1], key=lambda f: f[-1])
                if float(padded_best[-1]) >= 0.45:
                    aligned_face = self.recognizer.alignCrop(padded_img, padded_best)

                    # Shift coordinates back to original unpadded coordinate frame
                    unpadded = padded_best.copy()
                    unpadded[0] = max(0, padded_best[0] - pad_x)
                    unpadded[1] = max(0, padded_best[1] - pad_y)
                    unpadded[2] = min(w - unpadded[0], padded_best[2])
                    unpadded[3] = min(h - unpadded[1], padded_best[3])
                    for idx in [4, 6, 8, 10, 12]:
                        unpadded[idx] = max(0, min(w, padded_best[idx] - pad_x))
                    for idy in [5, 7, 9, 11, 13]:
                        unpadded[idy] = max(0, min(h, padded_best[idy] - pad_y))
                    bbox = unpadded[:4].astype(int)
                    return aligned_face, bbox, unpadded

        if best_face is None:
            # Fallback using standard Haar cascade
            cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
            gray = cv2.cvtColor(enhanced_img, cv2.COLOR_BGR2GRAY)
            faces = cascade.detectMultiScale(gray, 1.15, 3)
            if len(faces) > 0:
                (x, y, fw, fh) = faces[0]
                face_crop = enhanced_img[y:y+fh, x:x+fw]
                return face_crop, np.array([x, y, fw, fh]), None
            return None, None, None

        aligned_face = self.recognizer.alignCrop(enhanced_img, best_face)
        bbox = best_face[:4].astype(int)
        return aligned_face, bbox, best_face

    def extract_arcface_512d(self, aligned_face: np.ndarray) -> list[float] | None:
        """
        InsightFace MobileFaceNet ArcFace 512D deep feature extraction.
        Normalized on the unit hypersphere for state-of-the-art cosine matching.
        """
        if self.arcface_net is None or aligned_face is None:
            return None
        try:
            face_112 = cv2.resize(aligned_face, (112, 112))
            blob = cv2.dnn.blobFromImage(
                face_112,
                scalefactor=1.0 / 127.5,
                size=(112, 112),
                mean=(127.5, 127.5, 127.5),
                swapRB=True
            )
            self.arcface_net.setInput(blob)
            feat = self.arcface_net.forward()[0]
            norm = np.linalg.norm(feat)
            if norm > 0:
                feat = feat / norm
            return feat.tolist()
        except Exception as e:
            logger.warning(f"ArcFace 512D forward warning: {e}")
            return None

    def extract_full_face_data(self, bgr_img: np.ndarray):
        """
        Detects face and returns aligned crop, raw YuNet 15D face array, and embedding vector.
        Supports both InsightFace ArcFace 512D and OpenCV SFace 128D.
        """
        aligned_face, bbox, raw_face = self.detect_and_align_face(bgr_img)
        if aligned_face is None or raw_face is None:
            return None, None, None, 0.0

        conf = float(raw_face[-1])
        if self.arcface_net is not None:
            arc_feat = self.extract_arcface_512d(aligned_face)
            if arc_feat is not None:
                return arc_feat, aligned_face, raw_face, conf

        if self.recognizer is not None:
            feat = self.recognizer.feature(aligned_face)
            feat_norm = feat.flatten()
            norm = np.linalg.norm(feat_norm)
            if norm > 0:
                feat_norm = feat_norm / norm
            return feat_norm.tolist(), aligned_face, raw_face, conf
        else:
            gray = cv2.cvtColor(aligned_face, cv2.COLOR_BGR2GRAY)
            resized = cv2.resize(gray, (64, 64))
            hist = cv2.calcHist([resized], [0], None, [128], [0, 256]).flatten()
            hist = hist / (np.linalg.norm(hist) + 1e-8)
            return hist.tolist(), aligned_face, raw_face, 0.85

    def extract_from_pre_cropped(self, crop_112_bgr: np.ndarray):
        """
        Direct feature extraction from a client-provided 112x112 pre-cropped face.
        Bypasses YuNet detection completely, saving ~80% CPU time on low-spec Warden laptops.
        Enhanced with CLAHE illumination normalization.
        """
        if crop_112_bgr is None:
            return None, 0.0

        enhanced_crop = self.apply_clahe_lab(crop_112_bgr)
        aligned_112 = cv2.resize(enhanced_crop, (112, 112))
        if self.arcface_net is not None:
            feat = self.extract_arcface_512d(aligned_112)
            if feat is not None:
                return feat, 0.98

        if self.recognizer is not None:
            try:
                feat = self.recognizer.feature(aligned_112)
                feat_norm = feat.flatten()
                norm = np.linalg.norm(feat_norm)
                if norm > 0:
                    feat_norm = feat_norm / norm
                return feat_norm.tolist(), 0.98
            except Exception:
                pass

        gray = cv2.cvtColor(aligned_112, cv2.COLOR_BGR2GRAY)
        resized = cv2.resize(gray, (64, 64))
        hist = cv2.calcHist([resized], [0], None, [128], [0, 256]).flatten()
        hist = (hist / (np.linalg.norm(hist) + 1e-8)).tolist()
        return hist, 0.90

    def extract_embedding(self, bgr_img: np.ndarray) -> tuple[list[float] | None, np.ndarray | None, float]:
        """
        Detects face, aligns it, and computes mathematical vector (ArcFace 512D or SFace 128D).
        """
        aligned_face, bbox, raw_face = self.detect_and_align_face(bgr_img)
        if aligned_face is None:
            return None, None, 0.0

        conf = float(raw_face[-1] if raw_face is not None else 0.9)
        if self.arcface_net is not None:
            arc_feat = self.extract_arcface_512d(aligned_face)
            if arc_feat is not None:
                return arc_feat, aligned_face, conf

        if self.recognizer is not None:
            feat = self.recognizer.feature(aligned_face)
            # Normalize embedding
            feat_norm = feat.flatten()
            norm = np.linalg.norm(feat_norm)
            if norm > 0:
                feat_norm = feat_norm / norm
            return feat_norm.tolist(), aligned_face, conf
        else:
            # Synthetic 128D projection from image histogram if model absent
            gray = cv2.cvtColor(aligned_face, cv2.COLOR_BGR2GRAY)
            resized = cv2.resize(gray, (64, 64))
            hist = cv2.calcHist([resized], [0], None, [128], [0, 256]).flatten()
            hist = hist / (np.linalg.norm(hist) + 1e-8)
            return hist.tolist(), aligned_face, 0.85

    def compute_cosine_similarity(self, vec1, vec2) -> float:
        """
        Computes cosine similarity between two vectors (SFace 128D or ArcFace 512D).
        Output range: [-1.0, 1.0] where 1.0 is identical.
        Supports multi-pose embedding banks (dict or list of pose vectors),
        returning the maximum similarity score across all enrolled poses.
        """
        if vec1 is None or vec2 is None:
            return 0.0

        if isinstance(vec2, dict):
            candidates = []
            if "centroid" in vec2 and vec2["centroid"]:
                candidates.append(vec2["centroid"])
            if "poses" in vec2 and isinstance(vec2["poses"], list):
                candidates.extend(vec2["poses"])
            if not candidates:
                return 0.0
            return max([self.compute_cosine_similarity(vec1, c) for c in candidates])

        if len(vec2) > 0 and isinstance(vec2[0], (list, tuple, np.ndarray)):
            return max([self.compute_cosine_similarity(vec1, sub_v) for sub_v in vec2])

        u = np.array(vec1, dtype=np.float32)
        v = np.array(vec2, dtype=np.float32)

        dot = np.dot(u, v)
        norm_u = np.linalg.norm(u)
        norm_v = np.linalg.norm(v)

        if norm_u == 0 or norm_v == 0:
            return 0.0

        similarity = float(dot / (norm_u * norm_v))
        return round(similarity, 4)
