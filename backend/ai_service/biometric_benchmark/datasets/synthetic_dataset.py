import cv2
import numpy as np
import os

class BenchmarkDatasetGenerator:
    """
    Generates controlled test cases for evaluating Face Recognition and Presentation Attack Detection (PAD).
    Contains:
    - Genuine pairs (same identity under varying lighting, slight pose, glasses, blur)
    - Impostor pairs (different identity subjects)
    - Presentation attack samples (printed photos, screen displays with moiré artifacts, blurred cutouts)
    """

    @staticmethod
    def generate_synthetic_face(seed: int, skin_tone=(140, 160, 200), lighting_factor=1.0, blur=0, angle_offset=0) -> np.ndarray:
        np.random.seed(seed)
        h, w = 320, 320
        img = np.full((h, w, 3), 40, dtype=np.uint8)

        # Base skin tone with lighting
        r = int(np.clip(skin_tone[2] * lighting_factor, 20, 255))
        g = int(np.clip(skin_tone[1] * lighting_factor, 20, 255))
        b = int(np.clip(skin_tone[0] * lighting_factor, 20, 255))
        face_color = (b, g, r)

        # Draw head / face oval
        center_x = 160 + angle_offset
        center_y = 160
        cv2.ellipse(img, (center_x, center_y), (75, 105), 0, 0, 360, face_color, -1)

        # Eyes
        eye_y = 140
        eye_color = (30, 20, 20)
        cv2.circle(img, (center_x - 30, eye_y), 9, (240, 240, 240), -1)
        cv2.circle(img, (center_x + 30, eye_y), 9, (240, 240, 240), -1)
        cv2.circle(img, (center_x - 30, eye_y), 5, eye_color, -1)
        cv2.circle(img, (center_x + 30, eye_y), 5, eye_color, -1)

        # Nose bridge and tip
        cv2.line(img, (center_x, 140), (center_x, 175), (b - 20, g - 20, r - 20), 3)
        cv2.circle(img, (center_x, 175), 6, (b - 25, g - 25, r - 25), -1)

        # Mouth / lips
        cv2.ellipse(img, (center_x, 205), (24, 8), 0, 0, 180, (50, 40, 160), -1)

        # Hair
        hair_color = (25, 20, 20)
        cv2.ellipse(img, (center_x, 105), (82, 45), 0, 180, 360, hair_color, -1)

        if blur > 0:
            k = blur if blur % 2 == 1 else blur + 1
            img = cv2.GaussianBlur(img, (k, k), 0)

        return img

    @staticmethod
    def simulate_screen_replay(base_img: np.ndarray) -> np.ndarray:
        """
        Simulates an image photographed from an LCD/OLED mobile screen by adding
        subpixel rasterization grid noise (high frequency harmonic peaks).
        """
        img = base_img.copy().astype(np.float32)
        h, w, c = img.shape
        grid = np.zeros((h, w, 1), dtype=np.float32)
        grid[::4, :] += 35.0  # Periodic horizontal scan lines
        grid[:, ::4] += 35.0  # Periodic vertical subpixel grid
        replayed = np.clip(img + grid, 0, 255).astype(np.uint8)
        return replayed

    @staticmethod
    def simulate_printed_photo(base_img: np.ndarray) -> np.ndarray:
        """
        Simulates a flat 2D printed photograph: slight paper desaturation and low Laplacian variance.
        """
        gray = cv2.cvtColor(base_img, cv2.COLOR_BGR2GRAY)
        low_res = cv2.resize(gray, (80, 80))
        restored = cv2.resize(low_res, (base_img.shape[1], base_img.shape[0]))
        bgr = cv2.cvtColor(restored, cv2.COLOR_GRAY2BGR)
        blurred = cv2.GaussianBlur(bgr, (5, 5), 0)
        return blurred

    @classmethod
    def build_test_suite(cls):
        """
        Builds genuine pairs, impostor pairs, and presentation attack sets.
        """
        genuine_pairs = []
        impostor_pairs = []
        attack_samples = []

        # 5 distinct identities
        base_identities = {}
        for uid in range(1, 6):
            base_identities[uid] = cls.generate_synthetic_face(seed=uid * 100)

        # Genuine pairs (same identity with lighting, angle, and slight variations)
        for uid, base_face in base_identities.items():
            # Variation 1: Different lighting
            v1 = cls.generate_synthetic_face(seed=uid * 100, lighting_factor=0.82)
            genuine_pairs.append({"id": f"gen_{uid}_light", "subject": uid, "enroll": base_face, "probe": v1})

            # Variation 2: Slight pose angle offset
            v2 = cls.generate_synthetic_face(seed=uid * 100, angle_offset=10)
            genuine_pairs.append({"id": f"gen_{uid}_angle", "subject": uid, "enroll": base_face, "probe": v2})

            # Variation 3: Soft focus / indoor blur
            v3 = cls.generate_synthetic_face(seed=uid * 100, blur=3)
            genuine_pairs.append({"id": f"gen_{uid}_soft", "subject": uid, "enroll": base_face, "probe": v3})

        # Impostor pairs (Subject A enrolled, Subject B probes)
        for uid1 in range(1, 6):
            for uid2 in range(1, 6):
                if uid1 < uid2:
                    impostor_pairs.append({
                        "id": f"imp_{uid1}_vs_{uid2}",
                        "sub_a": uid1,
                        "sub_b": uid2,
                        "enroll": base_identities[uid1],
                        "probe": base_identities[uid2]
                    })

        # Presentation attacks (Screen replays and printed photos)
        for uid, base_face in base_identities.items():
            attack_samples.append({
                "id": f"attack_screen_{uid}",
                "type": "SCREEN_REPLAY",
                "image": cls.simulate_screen_replay(base_face)
            })
            attack_samples.append({
                "id": f"attack_print_{uid}",
                "type": "PRINTED_PHOTO",
                "image": cls.simulate_printed_photo(base_face)
            })

        return genuine_pairs, impostor_pairs, attack_samples
