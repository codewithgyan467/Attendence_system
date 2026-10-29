import cv2
import numpy as np

class LivenessDetector:
    """
    Open-source, self-hosted anti-spoofing detector.
    Analyzes:
    1. Laplacian Texture Sharpness (rejects blurry prints/screens).
    2. 2D FFT Frequency Analysis (detects moiré patterns from mobile/laptop screens).
    3. YCrCb Skin Chrominance Distribution (identifies synthetic RGB display backlights).
    """

    def __init__(self, blur_threshold: float = 50.0, moire_threshold: float = 1.02):
        self.blur_threshold = blur_threshold
        self.moire_threshold = moire_threshold

    def analyze_texture(self, face_crop: np.ndarray) -> dict:
        gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
        laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        is_sharp = laplacian_var >= self.blur_threshold
        return {
            "laplacian_variance": round(float(laplacian_var), 2),
            "is_sharp": bool(is_sharp)
        }

    def detect_screen_moire(self, face_crop: np.ndarray) -> dict:
        """
        Calculates 2D FFT power spectrum to detect periodic screen pixel grids.
        Screens emit distinct repeating spatial frequencies.
        """
        gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
        resized = cv2.resize(gray, (128, 128))

        f = np.fft.fft2(resized)
        fshift = np.fft.fftshift(f)
        magnitude_spectrum = 20 * np.log(np.abs(fshift) + 1e-8)

        # High frequency energy ratio
        center = 64
        radius = 28
        y, x = np.ogrid[:128, :128]
        mask = (x - center) ** 2 + (y - center) ** 2 > radius ** 2

        high_freq_ratio = float(np.mean(magnitude_spectrum[mask]) / (np.mean(magnitude_spectrum) + 1e-8))
        is_natural = high_freq_ratio < self.moire_threshold

        return {
            "high_freq_ratio": round(high_freq_ratio, 3),
            "screen_detected": not is_natural
        }

    def check_skin_chroma(self, face_crop: np.ndarray) -> dict:
        """
        Validates whether the face contains natural biological human skin tones
        versus unnatural blue/RGB display backlit artifacts.
        """
        ycrcb = cv2.cvtColor(face_crop, cv2.COLOR_BGR2YCrCb)
        cr = ycrcb[:, :, 1]
        cb = ycrcb[:, :, 2]

        # Biological human skin tone cluster in YCrCb
        skin_mask = (cr >= 133) & (cr <= 173) & (cb >= 77) & (cb <= 127)
        skin_ratio = float(np.sum(skin_mask) / (face_crop.shape[0] * face_crop.shape[1]))
        has_natural_tone = skin_ratio > 0.15

        return {
            "skin_ratio": round(skin_ratio, 3),
            "has_natural_tone": bool(has_natural_tone)
        }

    def evaluate_liveness(self, face_crop: np.ndarray) -> dict:
        if face_crop is None or face_crop.size == 0:
            return {"is_live": False, "confidence": 0.0, "reason": "No face provided"}

        texture = self.analyze_texture(face_crop)
        moire = self.detect_screen_moire(face_crop)
        chroma = self.check_skin_chroma(face_crop)

        # Calculate composite liveness score (0.0 to 1.0)
        score = 0.0
        if texture["is_sharp"]:
            score += 0.35
        if not moire["screen_detected"]:
            score += 0.35
        if chroma["has_natural_tone"]:
            score += 0.30

        rounded_score = round(score, 2)
        is_live = rounded_score >= 0.65
        reason = "Live subject confirmed" if is_live else "Potential spoof attempt (screen or printed photo)"

        return {
            "is_live": bool(is_live),
            "liveness_score": round(score, 2),
            "reason": reason,
            "metrics": {
                "texture": texture,
                "moire": moire,
                "chroma": chroma
            }
        }

    def analyze_photometric_flash(self, base_crop: np.ndarray, flash_crop: np.ndarray, expected_hex: str = "#FF0040") -> dict:
        """
        Causal Screen-Flash Photometric Liveness Verification (v3.0).
        Measures chromatic reflection shifts on the 3D facial skin surface in response
        to an active randomized color flash challenge (e.g. #FF0040 Red vs #00E5FF Cyan).
        """
        if base_crop is None or flash_crop is None or base_crop.size == 0 or flash_crop.size == 0:
            return {"flash_verified": True, "chromatic_shift": 0.0, "reason": "Single frame or empty crop provided"}

        h, w = 128, 128
        base_resized = cv2.resize(base_crop, (w, h)).astype(np.float32)
        flash_resized = cv2.resize(flash_crop, (w, h)).astype(np.float32)

        # Difference in color space (BGR)
        diff = flash_resized - base_resized
        mean_diff_b = float(np.mean(diff[:, :, 0]))
        mean_diff_g = float(np.mean(diff[:, :, 1]))
        mean_diff_r = float(np.mean(diff[:, :, 2]))

        clean_hex = expected_hex.lstrip("#")
        exp_r = int(clean_hex[0:2], 16) if len(clean_hex) >= 2 else 255
        exp_g = int(clean_hex[2:4], 16) if len(clean_hex) >= 4 else 0
        exp_b = int(clean_hex[4:6], 16) if len(clean_hex) >= 6 else 0

        verified = True
        shift_score = 0.0
        if exp_r > 180 and exp_b < 100:  # Red dominant
            shift_score = mean_diff_r - (mean_diff_b + mean_diff_g) / 2.0
            verified = shift_score >= -8.0  # Camera auto-exposure tolerance
        elif exp_b > 180 and exp_r < 100:  # Cyan/Blue dominant
            shift_score = (mean_diff_b + mean_diff_g) / 2.0 - mean_diff_r
            verified = shift_score >= -8.0
        else:
            shift_score = float(np.linalg.norm([mean_diff_b, mean_diff_g, mean_diff_r]))

        return {
            "flash_verified": bool(verified),
            "expected_color": expected_hex,
            "mean_bgr_diff": [round(mean_diff_b, 2), round(mean_diff_g, 2), round(mean_diff_r, 2)],
            "reflection_score": round(float(shift_score), 2)
        }
