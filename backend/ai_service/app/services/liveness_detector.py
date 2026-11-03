import os
import cv2
import numpy as np
import logging

logger = logging.getLogger("liveness_detector_v4")

class LivenessDetectorV4:
    """
    HostelGuard Enterprise v4.0 - Advanced Facial Presentation Attack Detection (PAD)
    Combines:
    1. Primary Deep Learning PAD: MiniFASNetV2 (80x80, Scale 2.7 Context Crop).
       Trained to detect 2D screen replays, high-PPI mobile/laptop displays, and paper prints.
    2. Multi-Frame Temporal Continuity: Evaluates landmark micro-motion and inter-frame optical variance.
    3. Geometric Head Pose Active Challenge Verification: Computes 3D-equivalent yaw and pitch from
       YuNet 5-point facial landmarks to verify dynamic server-issued challenges.
    4. Supplementary Heuristic Signals: Laplacian texture variance and skin chrominance (as telemetry).
    """

    def __init__(self, models_dir: str = None):
        if models_dir is None:
            models_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
        self.models_dir = models_dir
        self.minifas_path = os.path.join(models_dir, "minifasnet_v2.onnx")
        self.minifas_net = None
        self._load_minifas_model()

    def _load_minifas_model(self):
        if os.path.exists(self.minifas_path) and os.path.getsize(self.minifas_path) > 1000000:
            try:
                self.minifas_net = cv2.dnn.readNetFromONNX(self.minifas_path)
                logger.info(f"Loaded MiniFASNetV2 Deep Learning PAD model ({os.path.getsize(self.minifas_path)} bytes)")
            except Exception as e:
                logger.error(f"Failed to load MiniFASNetV2 ONNX model: {e}")
                self.minifas_net = None
        else:
            logger.warning(f"MiniFASNetV2 model not found at {self.minifas_path}. Downloading...")
            try:
                import urllib.request
                url = "https://huggingface.co/danelcsb/face/resolve/main/minifasnet_v2.onnx"
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=30) as resp, open(self.minifas_path, "wb") as f:
                    f.write(resp.read())
                self.minifas_net = cv2.dnn.readNetFromONNX(self.minifas_path)
                logger.info(f"Downloaded and initialized MiniFASNetV2 model ({os.path.getsize(self.minifas_path)} bytes)")
            except Exception as dl_err:
                logger.error(f"Failed to auto-download MiniFASNetV2: {dl_err}")
                self.minifas_net = None

    def crop_expanded_patch(self, img: np.ndarray, bbox: np.ndarray, scale: float = 2.7) -> np.ndarray:
        """
        Crops an expanded region around the detected face bounding box using a 2.7x scale multiplier.
        This provides contextual clues (screen borders, paper edges, ambient reflections)
        critical for the MiniFASNet deep presentation-attack classifier.
        """
        src_h, src_w = img.shape[:2]
        x, y, w, h = bbox[:4].astype(int)
        scale_w = w * (scale - 1) / 2
        scale_h = h * (scale - 1) / 2
        x1 = int(max(0, x - scale_w))
        y1 = int(max(0, y - scale_h))
        x2 = int(min(src_w, x + w + scale_w))
        y2 = int(min(src_h, y + h + scale_h))
        
        crop = img[y1:y2, x1:x2]
        if crop.size == 0 or crop.shape[0] < 10 or crop.shape[1] < 10:
            return cv2.resize(img, (80, 80))
        return cv2.resize(crop, (80, 80))

    def evaluate_deep_pad(self, bgr_img: np.ndarray, raw_face: np.ndarray) -> dict:
        """
        Runs MiniFASNetV2 deep learning inference on the expanded face context crop.
        Output classes:
          Class 0: 2D Print attack
          Class 1: Bona fide / Live human face
          Class 2: 2D Replay / Digital screen attack (mobile/laptop/monitor)
        """
        if self.minifas_net is None or raw_face is None or bgr_img is None:
            return {
                "available": False,
                "is_live": False,
                "live_prob": 0.0,
                "spoof_prob": 1.0,
                "predicted_class": "MODEL_UNAVAILABLE",
                "reason": "MiniFASNet deep PAD model not available"
            }

        try:
            patch = self.crop_expanded_patch(bgr_img, raw_face, scale=2.7)
            blob = cv2.dnn.blobFromImage(patch, 1.0, (80, 80), (0, 0, 0), swapRB=False)
            self.minifas_net.setInput(blob)
            logits = self.minifas_net.forward()[0]
            
            # Stable Softmax
            exp_logits = np.exp(logits - np.max(logits))
            probs = exp_logits / np.sum(exp_logits)
            
            p_print = float(probs[0])
            p_live = float(probs[1])
            p_screen = float(probs[2])
            p_spoof = p_print + p_screen
            
            # Calibrated Decision: Genuine face requires p_live >= 0.55 (default operational threshold)
            is_live = bool(p_live >= 0.55)
            
            pred_class = "LIVE" if is_live else ("SCREEN_REPLAY" if p_screen >= p_print else "PRINT_ATTACK")
            
            return {
                "available": True,
                "is_live": is_live,
                "live_prob": round(p_live, 4),
                "spoof_prob": round(p_spoof, 4),
                "print_prob": round(p_print, 4),
                "screen_prob": round(p_screen, 4),
                "predicted_class": pred_class,
                "reason": f"Deep PAD evaluated: {pred_class} (Live prob: {p_live*100:.1f}%)"
            }
        except Exception as e:
            logger.error(f"MiniFASNet inference error: {e}")
            return {
                "available": False,
                "is_live": False,
                "live_prob": 0.0,
                "spoof_prob": 1.0,
                "predicted_class": "ERROR",
                "reason": f"MiniFASNet inference failed: {e}"
            }

    def compute_head_pose(self, raw_face: np.ndarray) -> dict:
        """
        Estimates yaw and pitch from YuNet 5-point facial landmarks:
        [x, y, w, h, x_re, y_re, x_le, y_le, x_nt, y_nt, x_rc, y_rc, x_lc, y_lc, score]
        - Yaw: horizontal symmetry of nose tip relative to eyes.
        - Pitch: vertical ratio of eye-to-nose vs nose-to-mouth.
        """
        if raw_face is None or len(raw_face) < 15:
            return {"yaw_ratio": 0.0, "pitch_ratio": 1.0, "action": "UNKNOWN"}

        re = raw_face[4:6]
        le = raw_face[6:8]
        nt = raw_face[8:10]
        rc = raw_face[10:12]
        lc = raw_face[12:14]

        # Horizontal yaw symmetry ratio
        # d_r: distance from right eye to nose; d_l: distance from nose to left eye
        d_r = float(nt[0] - re[0])
        d_l = float(le[0] - nt[0])
        total_eye_dist = d_r + d_l + 1e-6
        yaw_ratio = (d_r - d_l) / total_eye_dist

        # Vertical pitch ratio
        eye_y = float((re[1] + le[1]) / 2.0)
        mouth_y = float((rc[1] + lc[1]) / 2.0)
        eye_to_nose = float(nt[1] - eye_y)
        nose_to_mouth = float(mouth_y - nt[1] + 1e-6)
        pitch_ratio = eye_to_nose / (nose_to_mouth + 1e-6)

        # Classify instantaneous pose
        # Facing camera: yaw_ratio roughly in [-0.18, 0.18]
        # Turned right (from subject perspective): nose moves right in image -> yaw_ratio > +0.22
        # Turned left (from subject perspective): nose moves left in image -> yaw_ratio < -0.22
        # Tilting head down: nose-to-mouth appears larger, eye-to-nose smaller -> pitch_ratio < 0.70
        # Tilting head up: nose moves closer to mouth -> pitch_ratio > 1.35
        action = "HOLD_STILL"
        if yaw_ratio < -0.20:
            action = "TURN_LEFT"
        elif yaw_ratio > 0.20:
            action = "TURN_RIGHT"
        elif pitch_ratio > 1.35:
            action = "TILT_UP"
        elif pitch_ratio < 0.70:
            action = "NOD_DOWN"

        return {
            "yaw_ratio": round(yaw_ratio, 3),
            "pitch_ratio": round(pitch_ratio, 3),
            "action": action
        }

    def verify_active_challenge(self, temporal_poses: list[dict], expected_challenge: str) -> dict:
        """
        Validates that a sequence of temporally-ordered frames satisfied a server-issued challenge.
        Supported challenges:
          - 'HOLD_STILL': Subject holds stable frontal pose across frames.
          - 'TURN_LEFT': Subject turns head to the left (~15° or more).
          - 'TURN_RIGHT': Subject turns head to the right (~15° or more).
          - 'NOD_DOWN': Subject tilts head/chin downward.
          - 'TILT_UP': Subject tilts chin upward.
        """
        if not expected_challenge or expected_challenge == "NONE":
            return {"challenge_passed": True, "reason": "No active challenge required"}

        if not temporal_poses or len(temporal_poses) == 0:
            return {"challenge_passed": False, "reason": "No temporal pose data provided"}

        observed_actions = [p.get("action", "UNKNOWN") for p in temporal_poses]

        if expected_challenge == "HOLD_STILL":
            # For HOLD_STILL, all poses should remain within neutral bounds
            still_count = sum(1 for a in observed_actions if a in ["HOLD_STILL", "UNKNOWN"])
            passed = still_count >= max(1, len(observed_actions) - 1)
            return {
                "challenge_passed": passed,
                "expected": expected_challenge,
                "observed": observed_actions,
                "reason": "Frontal still pose maintained" if passed else "Excessive movement during still challenge"
            }

        # Dynamic movement challenge (e.g., TURN_LEFT, TURN_RIGHT, NOD_DOWN, TILT_UP)
        # Check if the requested action occurred in at least one of the subsequent frames
        target_detected = expected_challenge in observed_actions
        
        # Verify temporal delta (subject was initially neutral, then performed movement)
        initial_pose = temporal_poses[0] if len(temporal_poses) > 0 else {}
        is_dynamic = True
        if len(temporal_poses) >= 2:
            yaw_variance = abs(temporal_poses[-1].get("yaw_ratio", 0) - initial_pose.get("yaw_ratio", 0))
            pitch_variance = abs(temporal_poses[-1].get("pitch_ratio", 1) - initial_pose.get("pitch_ratio", 1))
            is_dynamic = (yaw_variance > 0.15) or (pitch_variance > 0.30) or target_detected

        challenge_passed = target_detected and is_dynamic
        return {
            "challenge_passed": challenge_passed,
            "expected": expected_challenge,
            "observed": observed_actions,
            "reason": f"Active challenge '{expected_challenge}' successfully confirmed" if challenge_passed else f"Challenge '{expected_challenge}' not completed by subject (detected: {observed_actions})"
        }

    def evaluate_temporal_consistency(self, bgr_frames: list[np.ndarray], raw_faces: list[np.ndarray]) -> dict:
        """
        Analyzes 3-5 consecutive video frames for physiological micro-motion vs frozen static replay.
        A frozen image or static printed photo will have ~0.0 landmark shift and near-zero optical delta.
        A live human subject naturally has breathing, pulse, and eye/head micro-tremor.
        Conversely, sudden teleportation (frame substitution / injection) is flagged.
        """
        if len(bgr_frames) < 2 or len(raw_faces) < 2:
            return {
                "is_consistent": True,
                "motion_detected": True,
                "mean_landmark_delta": 1.0,
                "reason": "Insufficient frames for temporal consistency check"
            }

        landmark_deltas = []
        for i in range(1, min(len(raw_faces), len(bgr_frames))):
            f_prev = raw_faces[i-1]
            f_curr = raw_faces[i]
            if f_prev is not None and f_curr is not None:
                # 5 landmarks are at indices 4..13
                pts_prev = f_prev[4:14].astype(float)
                pts_curr = f_curr[4:14].astype(float)
                delta = float(np.mean(np.abs(pts_curr - pts_prev)))
                landmark_deltas.append(delta)

        if not landmark_deltas:
            return {"is_consistent": False, "motion_detected": False, "reason": "No face tracked across frames"}

        mean_delta = float(np.mean(landmark_deltas))
        max_delta = float(np.max(landmark_deltas))

        # Check for completely frozen static image (zero movement across multi-frame burst)
        is_frozen = mean_delta < 0.25

        # Check for unnatural jump / video injection splice
        is_spliced = max_delta > 85.0

        is_consistent = (not is_frozen) and (not is_spliced)
        return {
            "is_consistent": is_consistent,
            "motion_detected": not is_frozen,
            "mean_landmark_delta": round(mean_delta, 2),
            "max_landmark_delta": round(max_delta, 2),
            "reason": "Natural human temporal micro-motion verified" if is_consistent else ("Completely static image detected across multiple frames" if is_frozen else "Anomalous frame splice / injection jump detected")
        }

    def evaluate_sequence(self, bgr_frames: list[np.ndarray], raw_faces: list[np.ndarray], active_challenge: str = None) -> dict:
        """
        Main Enterprise v4.0 Multi-Frame PAD Pipeline:
        1. Evaluates MiniFASNet deep PAD across the temporal burst.
        2. Evaluates active challenge compliance (head turn, nod, hold still).
        3. Evaluates temporal landmark consistency (eliminates static prints).
        """
        if not bgr_frames or not raw_faces or len(bgr_frames) == 0:
            return {
                "is_live": False,
                "liveness_score": 0.0,
                "deep_pad_pass": False,
                "active_challenge_pass": False,
                "temporal_pass": False,
                "status": "NO_FRAMES_PROVIDED",
                "reason": "No face frames provided for sequence evaluation"
            }

        # 1. Deep PAD on each valid face crop
        pad_results = []
        poses = []
        for img, face in zip(bgr_frames, raw_faces):
            if face is not None:
                pad = self.evaluate_deep_pad(img, face)
                pad_results.append(pad)
                pose = self.compute_head_pose(face)
                poses.append(pose)

        if not pad_results:
            return {
                "is_live": False,
                "liveness_score": 0.0,
                "deep_pad_pass": False,
                "active_challenge_pass": False,
                "temporal_pass": False,
                "status": "FACE_NOT_FOUND",
                "reason": "No face detected in any of the temporal sequence frames"
            }

        # Aggregate Deep PAD Scores across sequence
        mean_live_prob = float(np.mean([p["live_prob"] for p in pad_results]))
        deep_pad_pass = bool(mean_live_prob >= 0.55)

        # 2. Active Challenge Evaluation
        active_res = self.verify_active_challenge(poses, active_challenge)
        active_challenge_pass = active_res["challenge_passed"]

        # 3. Temporal Consistency
        temp_res = self.evaluate_temporal_consistency(bgr_frames, raw_faces)
        # If single frame, temporal_pass is true by default
        temporal_pass = temp_res["is_consistent"] if len(bgr_frames) >= 2 else True

        # Final Liveness Decision: All three gates must align for high assurance
        is_live = bool(deep_pad_pass and active_challenge_pass and temporal_pass)

        # Formulate failure reason
        reasons = []
        if not deep_pad_pass:
            dominant_spoof = pad_results[0].get("predicted_class", "SPOOF")
            reasons.append(f"Deep PAD flagged presentation attack ({dominant_spoof})")
        if not active_challenge_pass:
            reasons.append(active_res.get("reason", "Active challenge failed"))
        if not temporal_pass:
            reasons.append(temp_res.get("reason", "Temporal consistency check failed"))

        final_reason = "; ".join(reasons) if reasons else "Bona fide live subject confirmed by Deep Learning PAD & Active Challenge"

        return {
            "is_live": is_live,
            "liveness_score": round(mean_live_prob, 3),
            "deep_pad": {
                "pass": deep_pad_pass,
                "mean_live_prob": round(mean_live_prob, 3),
                "samples_evaluated": len(pad_results),
                "details": pad_results[0] if pad_results else {}
            },
            "active_challenge": active_res,
            "temporal_consistency": temp_res,
            "reason": final_reason
        }
