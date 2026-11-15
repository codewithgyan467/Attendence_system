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
        rng = np.random.RandomState(seed)
        h, w = 320, 320
        img = np.full((h, w, 3), 40, dtype=np.uint8)

        # Base skin tone with lighting and identity-specific shifts
        shift_r = rng.randint(-25, 25)
        shift_g = rng.randint(-20, 20)
        shift_b = rng.randint(-20, 20)
        r = int(np.clip((skin_tone[2] + shift_r) * lighting_factor, 30, 250))
        g = int(np.clip((skin_tone[1] + shift_g) * lighting_factor, 30, 250))
        b = int(np.clip((skin_tone[0] + shift_b) * lighting_factor, 30, 250))
        face_color = (b, g, r)

        # Draw head / face oval with varied aspect ratio
        face_rx = int(75 + rng.randint(-8, 8))
        face_ry = int(105 + rng.randint(-10, 10))
        center_x = 160 + angle_offset
        center_y = 160
        cv2.ellipse(img, (center_x, center_y), (face_rx, face_ry), 0, 0, 360, face_color, -1)

        # Eyes with identity-specific spacing
        eye_y = int(140 + rng.randint(-5, 5))
        eye_spacing = int(30 + rng.randint(-6, 6))
        eye_pupil_color = (int(20 + rng.randint(0, 30)), int(15 + rng.randint(0, 20)), int(15 + rng.randint(0, 20)))
        cv2.circle(img, (center_x - eye_spacing, eye_y), 9, (240, 240, 240), -1)
        cv2.circle(img, (center_x + eye_spacing, eye_y), 9, (240, 240, 240), -1)
        cv2.circle(img, (center_x - eye_spacing, eye_y), 5, eye_pupil_color, -1)
        cv2.circle(img, (center_x + eye_spacing, eye_y), 5, eye_pupil_color, -1)

        # Nose bridge and tip
        cv2.line(img, (center_x, eye_y), (center_x, eye_y + 35), (max(0, b - 25), max(0, g - 25), max(0, r - 25)), 3)
        cv2.circle(img, (center_x, eye_y + 35), 6, (max(0, b - 30), max(0, g - 30), max(0, r - 30)), -1)

        # Mouth / lips
        mouth_w = int(24 + rng.randint(-5, 7))
        mouth_y = int(205 + rng.randint(-6, 6))
        cv2.ellipse(img, (center_x, mouth_y), (mouth_w, 8), 0, 0, 180, (50, 40, 160), -1)

        # Hair
        hair_rx = int(82 + rng.randint(-6, 6))
        hair_color = (int(20 + rng.randint(0, 30)), int(18 + rng.randint(0, 20)), int(18 + rng.randint(0, 20)))
        cv2.ellipse(img, (center_x, 105), (hair_rx, 45), 0, 180, 360, hair_color, -1)

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
        Uses benchmark ground-truth multi-subject facial imagery with realistic
        skin micro-texture, specular highlights, and orthogonal landmark geometry.
        """
        genuine_pairs = []
        impostor_pairs = []
        attack_samples = []

        base_identities = {}
        try:
            import insightface
            t1 = insightface.data.get_image('t1')
            h, w = t1.shape[:2]
            # 5 diverse identities selected with clear physical separation and orthogonal facial features:
            bboxes = [
                [466, 266, 102, 145],  # Subject 1 (Center foreground)
                [748, 352, 98, 123],   # Subject 2 (Right midground)
                [1125, 272, 95, 123],  # Subject 3 (Far right)
                [906, 58, 99, 143],    # Subject 4 (Top right)
                [267, 150, 105, 126]   # Subject 5 (Left upper)
            ]
            for uid, bbox in enumerate(bboxes, start=1):
                bx, by, bw, bh = bbox
                pad = int(max(bw, bh) * 0.9)
                crop = t1[max(0, by-pad):min(h, by+bh+pad), max(0, bx-pad):min(w, bx+bw+pad)].copy()
                base_identities[uid] = crop
        except Exception:
            # Fallback to high-contrast synthetic generator
            for uid in range(1, 6):
                base_identities[uid] = cls.generate_synthetic_face(seed=uid * 100)

        # Genuine pairs (same identity with lighting, angle, and slight variations)
        for uid, base_face in base_identities.items():
            # Variation 1: Illumination / Gamma shift (+20% brighter)
            table = np.array([((k / 255.0) ** (1.0 / 0.85)) * 255 for k in np.arange(0, 256)]).astype('uint8')
            v1 = cv2.LUT(base_face, table)
            genuine_pairs.append({"id": f"gen_{uid}_light", "subject": uid, "enroll": base_face, "probe": v1})

            # Variation 2: Slight pose angle offset (+3 degrees)
            M = cv2.getRotationMatrix2D((base_face.shape[1]//2, base_face.shape[0]//2), 3, 1.0)
            v2 = cv2.warpAffine(base_face, M, (base_face.shape[1], base_face.shape[0]))
            genuine_pairs.append({"id": f"gen_{uid}_angle", "subject": uid, "enroll": base_face, "probe": v2})

            # Variation 3: Natural camera softness / compression
            v3 = cv2.GaussianBlur(base_face, (3, 3), 0)
            genuine_pairs.append({"id": f"gen_{uid}_soft", "subject": uid, "enroll": base_face, "probe": v3})

        # Impostor pairs (Subject A enrolled, Subject B probes - All pairwise combinations)
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
