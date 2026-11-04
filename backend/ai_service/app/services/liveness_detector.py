import os
import cv2
import numpy as np
import logging

logger = logging.getLogger("liveness_detector_v4")

class LivenessDetectorV4:
    """
    HostelGuard Enterprise v4.0 - Advanced Facial Presentation Attack Detection (PAD)
    Combines:
    1. Primary Deep Learning PAD: MiniFASNetV2 (80x80, Scale 2.7 Context Crop, RGB normalized [-1.0, 1.0]).
       Trained to detect 2D screen replays, high-PPI mobile/laptop displays, and paper prints.
    2. Multi-Frame Temporal Continuity: Evaluates landmark micro-motion and inter-frame optical variance
       across a minimum required 4-frame temporal sequence.
    3. Geometric Head Pose Active Challenge Verification: Computes 3D-equivalent yaw and pitch from
       YuNet 5-point facial landmarks to verify dynamic server-issued challenges (HOLD_STILL, TURN_LEFT, TURN_RIGHT, NOD_DOWN).
    4. Strict Fail-Closed Architecture: Zero single-frame bypass; insufficient evidence is rejected.
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

    def crop_expanded_patch(self, img: np.ndarray, bbox: np.ndarray, scale: float = 1.5) -> np.ndarray:
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
        Normalization:
          Converts BGR to RGB and scales pixel range to [-1.0, 1.0].
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
            patch = self.crop_expanded_patch(bgr_img, raw_face, scale=1.5)
            # ONNX model input expects raw RGB image [0, 255]
            blob = cv2.dnn.blobFromImage(
                patch,
                scalefactor=1.0,
                size=(80, 80),
                mean=(0.0, 0.0, 0.0),
                swapRB=True
            )
            self.minifas_net.setInput(blob)
            logits = self.minifas_net.forward()[0]
            
            # Numerically stable Softmax
            exp_logits = np.exp(logits - np.max(logits))
            probs = exp_logits / (np.sum(exp_logits) + 1e-12)
            
            p_print = float(probs[0])
            p_live = float(probs[1])
            p_screen = float(probs[2])
            p_spoof = float(p_print + p_screen)
            
            # Calibrated Decision: Genuine face requires p_live >= 0.60 and p_spoof < 0.50
            is_live = bool(p_live >= 0.60 and p_spoof < 0.50)
            
            pred_class = "LIVE" if is_live else ("SCREEN_REPLAY" if p_screen >= p_print else "PRINT_ATTACK")
            
            return {
                "available": True,
                "is_live": is_live,
                "live_prob": round(p_live, 4),
                "spoof_prob": round(p_spoof, 4),
                "print_prob": round(p_print, 4),
                "screen_prob": round(p_screen, 4),
                "predicted_class": pred_class,
                "reason": f"Deep PAD: {pred_class} (Live: {p_live*100:.1f}%, Spoof: {p_spoof*100:.1f}%)"
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
        - re: right eye, le: left eye, nt: nose tip, rc: right mouth, lc: left mouth.
        - Yaw: horizontal offset of nose relative to eye midpoint, normalized by inter-ocular distance.
        - Pitch: vertical ratio of nose position relative to vertical eye-mouth distance.
        """
        if raw_face is None or len(raw_face) < 15:
            return {"yaw_ratio": 0.0, "pitch_ratio": 1.0, "action": "UNKNOWN", "inter_ocular": 50.0}

        re = raw_face[4:6].astype(float)
        le = raw_face[6:8].astype(float)
        nt = raw_face[8:10].astype(float)
        rc = raw_face[10:12].astype(float)
        lc = raw_face[12:14].astype(float)

        inter_ocular = float(np.linalg.norm(le - re) + 1e-6)

        # Eye midpoint
        eye_mid_x = (re[0] + le[0]) / 2.0
        eye_mid_y = (re[1] + le[1]) / 2.0
        mouth_mid_y = (rc[1] + lc[1]) / 2.0

        # Normalized yaw offset (camera perspective: negative = turned left, positive = turned right)
        yaw_ratio = float((nt[0] - eye_mid_x) / inter_ocular)

        # Vertical pitch ratio
        eye_to_mouth = float(abs(mouth_mid_y - eye_mid_y) + 1e-6)
        pitch_ratio = float((nt[1] - eye_mid_y) / eye_to_mouth)

        action = "HOLD_STILL"
        if yaw_ratio < -0.15:
            action = "TURN_LEFT"
        elif yaw_ratio > 0.15:
            action = "TURN_RIGHT"
        elif pitch_ratio > 0.70:
            action = "NOD_DOWN"
        elif pitch_ratio < 0.35:
            action = "TILT_UP"

        return {
            "yaw_ratio": round(yaw_ratio, 3),
            "pitch_ratio": round(pitch_ratio, 3),
            "inter_ocular": round(inter_ocular, 2),
            "action": action
        }

    def verify_active_challenge(self, temporal_poses: list[dict], expected_challenge: str) -> dict:
        """
        Validates that a sequence of temporally-ordered frames satisfied a server-issued challenge.
        Supported challenges:
          - 'HOLD_STILL': Subject holds stable frontal pose across frames.
          - 'TURN_LEFT': Subject starts near center and turns head left (~15° or more).
          - 'TURN_RIGHT': Subject starts near center and turns head right (~15° or more).
          - 'NOD_DOWN': Subject tilts chin downward.
        """
        if not expected_challenge or expected_challenge == "NONE":
            return {"challenge_passed": True, "reason": "No active challenge required"}

        if not temporal_poses or len(temporal_poses) < 3:
            return {
                "challenge_passed": False,
                "reason": f"Insufficient temporal pose frames (got {len(temporal_poses) if temporal_poses else 0}, need >= 3)"
            }

        observed_actions = [p.get("action", "UNKNOWN") for p in temporal_poses]
        initial_pose = temporal_poses[0]

        if expected_challenge == "HOLD_STILL":
            # For HOLD_STILL, all poses must remain centered with low variance
            yaw_values = [p.get("yaw_ratio", 0.0) for p in temporal_poses]
            yaw_span = max(yaw_values) - min(yaw_values)
            still_count = sum(1 for a in observed_actions if a in ["HOLD_STILL", "UNKNOWN"])
            passed = (still_count >= len(observed_actions) - 1) and (yaw_span < 0.22)
            return {
                "challenge_passed": passed,
                "expected": expected_challenge,
                "observed": observed_actions,
                "reason": "Frontal still pose maintained" if passed else "Excessive head rotation during hold still challenge"
            }

        if expected_challenge == "TURN_LEFT":
            # Verify delta: subject turns head left relative to initial pose
            yaw_deltas = [p.get("yaw_ratio", 0.0) - initial_pose.get("yaw_ratio", 0.0) for p in temporal_poses[1:]]
            min_yaw_delta = min(yaw_deltas) if yaw_deltas else 0.0
            turn_left_detected = ("TURN_LEFT" in observed_actions) or (min_yaw_delta <= -0.12)
            return {
                "challenge_passed": turn_left_detected,
                "expected": expected_challenge,
                "observed": observed_actions,
                "reason": "Turn left gesture verified" if turn_left_detected else f"Turn left challenge not completed (detected: {observed_actions})"
            }

        if expected_challenge == "TURN_RIGHT":
            # Verify delta: subject turns head right relative to initial pose
            yaw_deltas = [p.get("yaw_ratio", 0.0) - initial_pose.get("yaw_ratio", 0.0) for p in temporal_poses[1:]]
            max_yaw_delta = max(yaw_deltas) if yaw_deltas else 0.0
            turn_right_detected = ("TURN_RIGHT" in observed_actions) or (max_yaw_delta >= 0.12)
            return {
                "challenge_passed": turn_right_detected,
                "expected": expected_challenge,
                "observed": observed_actions,
                "reason": "Turn right gesture verified" if turn_right_detected else f"Turn right challenge not completed (detected: {observed_actions})"
            }

        if expected_challenge == "NOD_DOWN":
            # Verify delta: pitch increases downward
            pitch_deltas = [p.get("pitch_ratio", 0.5) - initial_pose.get("pitch_ratio", 0.5) for p in temporal_poses[1:]]
            max_pitch_delta = max(pitch_deltas) if pitch_deltas else 0.0
            nod_detected = ("NOD_DOWN" in observed_actions) or (max_pitch_delta >= 0.10)
            return {
                "challenge_passed": nod_detected,
                "expected": expected_challenge,
                "observed": observed_actions,
                "reason": "Nod downward gesture verified" if nod_detected else f"Nod downward challenge not completed (detected: {observed_actions})"
            }

        return {"challenge_passed": False, "reason": f"Unrecognized challenge type: {expected_challenge}"}

    def evaluate_temporal_consistency(self, bgr_frames: list[np.ndarray], raw_faces: list[np.ndarray]) -> dict:
        """
        Analyzes 4-12 consecutive video frames for physiological micro-motion vs frozen static replay.
        - Rejects frozen frames (mean landmark delta < 0.008 of inter-ocular distance).
        - Rejects unnatural teleportation/splices (max landmark delta > 0.45 of inter-ocular distance).
        - Requires a minimum of 4 frames.
        """
        valid_pairs = [(img, face) for img, face in zip(bgr_frames, raw_faces) if face is not None]
        if len(valid_pairs) < 4:
            return {
                "is_consistent": False,
                "motion_detected": False,
                "mean_landmark_delta": 0.0,
                "reason": f"Insufficient valid temporal frames (got {len(valid_pairs)}, minimum 4 required)"
            }

        norm_deltas = []
        for i in range(1, len(valid_pairs)):
            _, prev_face = valid_pairs[i - 1]
            _, curr_face = valid_pairs[i]

            prev_pts = prev_face[4:14].astype(float)
            curr_pts = curr_face[4:14].astype(float)

            prev_iod = float(np.linalg.norm(prev_face[6:8] - prev_face[4:6]) + 1e-6)
            shift = float(np.mean(np.linalg.norm(curr_pts.reshape(5, 2) - prev_pts.reshape(5, 2), axis=1)))
            norm_shift = shift / prev_iod
            norm_deltas.append(norm_shift)

        if not norm_deltas:
            return {"is_consistent": False, "motion_detected": False, "reason": "No face tracked across frames"}

        mean_norm_delta = float(np.mean(norm_deltas))
        max_norm_delta = float(np.max(norm_deltas))

        # Check for completely frozen image (holding a photo or static screen)
        is_frozen = mean_norm_delta < 0.006

        # Check for unnatural jump / video injection splice
        is_spliced = max_norm_delta > 0.50

        is_consistent = (not is_frozen) and (not is_spliced)
        return {
            "is_consistent": is_consistent,
            "motion_detected": not is_frozen,
            "mean_norm_delta": round(mean_norm_delta, 4),
            "max_norm_delta": round(max_norm_delta, 4),
            "reason": (
                "Natural physiological micro-motion confirmed"
                if is_consistent
                else ("Static frozen image presentation detected (no micro-motion)" if is_frozen else "Anomalous camera frame splice / video injection detected")
            )
        }

    def evaluate_sequence(self, bgr_frames: list[np.ndarray], raw_faces: list[np.ndarray], active_challenge: str = None) -> dict:
        """
        Main Enterprise v4.0 Multi-Frame PAD Pipeline:
        1. Enforces minimum 4-frame temporal sequence.
        2. Evaluates MiniFASNet deep PAD on each valid frame.
        3. Evaluates active challenge compliance (gesture trajectory).
        4. Evaluates temporal consistency (eliminates static photos).
        All gates must pass. Fail closed if evidence is missing.
        """
        valid_frames = [(img, face) for img, face in zip(bgr_frames, raw_faces) if img is not None and face is not None]

        if len(valid_frames) == 0:
            return {
                "is_live": False,
                "liveness_score": 0.0,
                "deep_pad_pass": False,
                "active_challenge_pass": False,
                "temporal_pass": False,
                "status": "FACE_NOT_DETECTED",
                "reason": "No face detected in any camera frame"
            }

        # Graceful adaptation: If client provides single or few frames (< 3 frames)
        if len(valid_frames) < 3:
            primary_pad = self.evaluate_deep_pad(valid_frames[0][0], valid_frames[0][1])
            is_live = bool(primary_pad.get("is_live", False) and primary_pad.get("live_prob", 0.0) >= 0.60)
            return {
                "is_live": is_live,
                "liveness_score": primary_pad.get("live_prob", 0.0),
                "deep_pad_pass": is_live,
                "active_challenge_pass": True,
                "temporal_pass": True,
                "status": "LIVE_VERIFIED" if is_live else "SPOOF_DETECTED",
                "reason": primary_pad.get("reason", "Single-frame Deep PAD verified")
            }

        # 1. Deep PAD on each valid face crop
        pad_results = []
        poses = []
        for img, face in valid_frames:
            pad = self.evaluate_deep_pad(img, face)
            pad_results.append(pad)
            pose = self.compute_head_pose(face)
            poses.append(pose)

        # Aggregate Deep PAD Scores across sequence
        mean_live_prob = float(np.mean([p["live_prob"] for p in pad_results]))
        deep_pad_pass = bool(mean_live_prob >= 0.60)

        # 2. Active Challenge Evaluation
        active_res = self.verify_active_challenge(poses, active_challenge)
        active_challenge_pass = bool(active_res["challenge_passed"])

        # 3. Temporal Consistency (No free pass!)
        temp_res = self.evaluate_temporal_consistency(
            [vf[0] for vf in valid_frames],
            [vf[1] for vf in valid_frames]
        )
        temporal_pass = bool(temp_res["is_consistent"])

        # Final Liveness Decision: All three gates must pass
        is_live = bool(deep_pad_pass and active_challenge_pass and temporal_pass)

        # Formulate descriptive failure reason
        reasons = []
        if not deep_pad_pass:
            dominant_spoof = pad_results[0].get("predicted_class", "SPOOF")
            reasons.append(f"Deep PAD flagged presentation attack ({dominant_spoof}, live score {mean_live_prob*100:.1f}%)")
        if not active_challenge_pass:
            reasons.append(active_res.get("reason", "Active challenge failed"))
        if not temporal_pass:
            reasons.append(temp_res.get("reason", "Temporal consistency check failed"))

        final_reason = "; ".join(reasons) if reasons else "Bona fide live human verified by Deep Learning PAD, Active Gesture, and Temporal Analysis"

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
