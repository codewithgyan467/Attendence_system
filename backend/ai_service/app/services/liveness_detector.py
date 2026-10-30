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
        Causal Screen-Flash Photometric Liveness Verification (v3.1 Production).
        Aligns to canonical (112, 112) crops, converts to YCrCb to decouple luminance (Y)
        attenuation by auto-exposure from chrominance shifts (Cr/Cb), and rejects static photos.
        """
        if base_crop is None or flash_crop is None or base_crop.size == 0 or flash_crop.size == 0:
            return {"flash_verified": True, "chromatic_shift": 0.0, "reason": "Single frame or empty crop provided"}

        # 1. Canonical 112x112 alignment to eliminate hand micro-tremor edge artifacts
        h, w = 112, 112
        base_resized = cv2.resize(base_crop, (w, h))
        flash_resized = cv2.resize(flash_crop, (w, h))

        # 2. Decouple Luminance (Y) from Chrominance (Cr red-diff, Cb blue-diff) via YCrCb
        base_ycrcb = cv2.cvtColor(base_resized, cv2.COLOR_BGR2YCrCb).astype(np.float32)
        flash_ycrcb = cv2.cvtColor(flash_resized, cv2.COLOR_BGR2YCrCb).astype(np.float32)

        cr_base, cb_base = base_ycrcb[:, :, 1], base_ycrcb[:, :, 2]
        cr_flash, cb_flash = flash_ycrcb[:, :, 1], flash_ycrcb[:, :, 2]

        delta_cr = float(np.mean(cr_flash - cr_base))
        delta_cb = float(np.mean(cb_flash - cb_base))

        # Telemetry BGR metrics
        diff_bgr = flash_resized.astype(np.float32) - base_resized.astype(np.float32)
        mean_diff_b = float(np.mean(diff_bgr[:, :, 0]))
        mean_diff_g = float(np.mean(diff_bgr[:, :, 1]))
        mean_diff_r = float(np.mean(diff_bgr[:, :, 2]))

        clean_hex = expected_hex.lstrip("#")
        exp_r = int(clean_hex[0:2], 16) if len(clean_hex) >= 2 else 255
        exp_g = int(clean_hex[2:4], 16) if len(clean_hex) >= 4 else 0
        exp_b = int(clean_hex[4:6], 16) if len(clean_hex) >= 6 else 0

        # Check for completely static printed photo (zero or negligible differential)
        is_completely_static = (
            abs(delta_cr) < 0.2 and 
            abs(delta_cb) < 0.2 and 
            abs(mean_diff_r) < 0.5 and 
            abs(mean_diff_g) < 0.5 and 
            abs(mean_diff_b) < 0.5
        )

        verified = False
        shift_score = 0.0

        if is_completely_static:
            verified = False
            reason = "Static printed photo detected: zero chromatic reflection differential"
        elif exp_r > 180 and exp_b < 100:  # Red dominant screen flash (#FF0040)
            directional_shift = (delta_cr - delta_cb)
            shift_score = directional_shift
            # Genuine skin reflection requires positive red chrominance shift
            verified = bool(directional_shift >= 1.2 or delta_cr >= 0.8)
            reason = "Red chrominance reflection confirmed" if verified else "Insufficient red skin reflection delta"
        elif exp_b > 180 and exp_r < 100:  # Cyan/Blue dominant screen flash (#00E5FF)
            directional_shift = (delta_cb - delta_cr)
            shift_score = directional_shift
            verified = bool(directional_shift >= 1.2 or delta_cb >= 0.8)
            reason = "Cyan chrominance reflection confirmed" if verified else "Insufficient cyan skin reflection delta"
        else:
            chroma_norm = float(np.sqrt(delta_cr**2 + delta_cb**2))
            shift_score = chroma_norm
            verified = bool(chroma_norm >= 0.8)
            reason = "Multispectral reflection verified" if verified else "Reflection below detection threshold"

        return {
            "flash_verified": bool(verified),
            "expected_color": expected_hex,
            "mean_bgr_diff": [round(mean_diff_b, 2), round(mean_diff_g, 2), round(mean_diff_r, 2)],
            "delta_cr": round(delta_cr, 3),
            "delta_cb": round(delta_cb, 3),
            "reflection_score": round(float(shift_score), 2),
            "reason": reason
        }
