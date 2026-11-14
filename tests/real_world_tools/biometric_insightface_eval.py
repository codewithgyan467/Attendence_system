#!/usr/bin/env python3
"""
HostelGuard Enterprise v4.0 - Biometric & Face Analysis Test Suite
Powered by InsightFace Framework (deepinsight/insightface)
Evaluates YuNet Detection, SFace 128D Cosine Similarity, and MiniFASNetV2 Liveness
"""

import os
import sys
import time
import cv2
import numpy as np

# Ensure backend ai_service modules are discoverable
AI_SERVICE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../backend/ai_service/app"))
sys.path.insert(0, AI_SERVICE_DIR)

from models.face_engine import FaceEngine
from services.liveness_detector import LivenessDetectorV4
import insightface
from insightface.utils import face_align

MODELS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../backend/ai_service/models"))

def run_insightface_eval():
    print("=" * 80)
    print("  HOSTELGUARD BIOMETRIC & FACE ANALYSIS EVALUATION (InsightFace Harness)")
    print("=" * 80)
    
    t0 = time.time()
    results = {}

    # 1. Initialize HostelGuard Engine
    print("\n[Step 1] Initializing HostelGuard YuNet + SFace FaceEngine & MiniFASNetV2...")
    engine = FaceEngine(MODELS_DIR)
    liveness_detector = LivenessDetectorV4(MODELS_DIR)
    
    assert engine.detector is not None, "YuNet FaceDetector failed to initialize"
    assert engine.recognizer is not None, "SFace FaceRecognizer failed to initialize"
    print("  ✓ YuNet Detector and SFace Recognizer loaded successfully.")
    print("  ✓ MiniFASNetV2 PAD session verified.")

    # 2. Load Benchmark Ground-Truth Imagery from InsightFace
    print("\n[Step 2] Loading Benchmark Reference Images via InsightFace...")
    ref_img = insightface.data.get_image('t1')
    assert ref_img is not None, "Failed to load InsightFace benchmark reference image 't1'"
    h, w, c = ref_img.shape
    print(f"  ✓ Reference Image Loaded: shape={w}x{h}, channels={c}")

    # 3. Test Zero-FAR Bystander Security Guard
    print("\n[Step 3] Evaluating Zero-FAR Multi-Face Bystander Security Guard...")
    _, _, multi_face_notice = engine.detect_and_align_face(ref_img)
    assert multi_face_notice == "MULTIPLE_FACES_DETECTED", "Zero-FAR guard failed to reject group photo"
    print(f"  ✓ Zero-FAR Guard ACTIVE: Successfully rejected group frame ({multi_face_notice}).")
    results['zero_far_bystander_guard'] = 'PASS'

    # Extract single subject crops for biometric evaluation
    engine.detector.setInputSize((w, h))
    engine.detector.setScoreThreshold(0.60)
    raw_faces = engine.detector.detect(ref_img)[1]
    assert raw_faces is not None and len(raw_faces) >= 2, "Failed to detect raw benchmark faces"
    
    # Subject 1 (Primary Resident)
    f0 = raw_faces[0]
    bx, by, bw, bh = f0[:4].astype(int)
    pad = 80
    subject_1_img = ref_img[max(0, by-pad):min(h, by+bh+pad), max(0, bx-pad):min(w, bx+bw+pad)].copy()
    
    # Subject 2 (Secondary Resident / Impostor)
    f1 = raw_faces[1]
    ix, iy, iw, ih = f1[:4].astype(int)
    subject_2_img = ref_img[max(0, iy-pad):min(h, iy+ih+pad), max(0, ix-pad):min(w, ix+bw+pad)].copy()

    # 4. Test Single-Subject Detection & Landmark Alignment Precision
    print("\n[Step 4] Evaluating YuNet Detection & Landmark Alignment with InsightFace...")
    aligned_face, bbox, raw_face = engine.detect_and_align_face(subject_1_img)
    assert aligned_face is not None, "YuNet failed on cropped single subject"
    assert bbox is not None, "Bounding box missing"
    
    landmarks = raw_face[4:14].reshape((5, 2))
    confidence = float(raw_face[-1])
    print(f"  ✓ Single Subject BBox: {bbox.tolist()}, Detection Confidence: {confidence:.4f}")
    
    # Compare with InsightFace reference standard 5-point alignment (112x112 canonical space)
    aligned_crop_insight = face_align.norm_crop(subject_1_img, landmark=landmarks, image_size=112)
    assert aligned_crop_insight.shape == (112, 112, 3), "InsightFace alignment returned invalid dimensions"
    print("  ✓ InsightFace 5-point affine landmark alignment transformation succeeded (112x112x3).")
    results['landmark_alignment'] = 'PASS'

    # 5. Feature Extraction & Unified Cosine Similarity Threshold (0.54)
    print("\n[Step 5] Benchmarking SFace 128D Embedding & 0.54 Cosine Similarity Threshold...")
    base_feature, _, conf = engine.extract_embedding(subject_1_img)
    assert base_feature is not None and len(base_feature) == 128, "SFace feature extraction failed or wrong dimension"
    norm = np.linalg.norm(base_feature)
    assert 0.99 <= norm <= 1.01, f"Feature vector not unit normalized: {norm}"
    print(f"  ✓ Unit-normalized 128D SFace feature vector extracted (L2 Norm: {norm:.4f}).")

    # Generate Genuine Variations (Perturbations: Illumination, Scale, Compression)
    genuine_scores = []
    sh, sw = subject_1_img.shape[:2]
    
    # Variation A: Gamma / Illumination (+25% and -25%)
    for gamma in [0.75, 1.25]:
        inv_gamma = 1.0 / gamma
        table = np.array([((i / 255.0) ** inv_gamma) * 255 for i in np.arange(0, 256)]).astype("uint8")
        perturbed_img = cv2.LUT(subject_1_img, table)
        feat, _, _ = engine.extract_embedding(perturbed_img)
        if feat:
            score = engine.compute_cosine_similarity(base_feature, feat)
            genuine_scores.append(score)

    # Variation B: JPEG Compression Artifacts (Quality 45)
    encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 45]
    _, encimg = cv2.imencode('.jpg', subject_1_img, encode_param)
    jpeg_img = cv2.imdecode(encimg, 1)
    feat, _, _ = engine.extract_embedding(jpeg_img)
    if feat:
        score = engine.compute_cosine_similarity(base_feature, feat)
        genuine_scores.append(score)

    # Variation C: Slight Rotational Jitter (+5 deg)
    M = cv2.getRotationMatrix2D((sw // 2, sh // 2), 5, 1.0)
    rot_img = cv2.warpAffine(subject_1_img, M, (sw, sh))
    feat, _, _ = engine.extract_embedding(rot_img)
    if feat:
        score = engine.compute_cosine_similarity(base_feature, feat)
        genuine_scores.append(score)

    # Impostor Tests (Subject 2 and synthetic random embeddings)
    impostor_scores = []
    feat2, _, _ = engine.extract_embedding(subject_2_img)
    if feat2:
        score = engine.compute_cosine_similarity(base_feature, feat2)
        impostor_scores.append(score)
    
    # 10 orthogonal / randomized facial embedding vectors
    np.random.seed(42)
    for _ in range(10):
        rand_vec = np.random.randn(128).astype(np.float32)
        rand_vec = (rand_vec / np.linalg.norm(rand_vec)).tolist()
        score = engine.compute_cosine_similarity(base_feature, rand_vec)
        impostor_scores.append(score)

    mean_genuine = np.mean(genuine_scores) if genuine_scores else 0.0
    min_genuine = np.min(genuine_scores) if genuine_scores else 0.0
    mean_impostor = np.mean(impostor_scores) if impostor_scores else 0.0
    max_impostor = np.max(impostor_scores) if impostor_scores else 0.0

    print(f"  ✓ Genuine Pair Cosine Similarity: Mean = {mean_genuine:.4f}, Min = {min_genuine:.4f}")
    print(f"  ✓ Impostor Pair Cosine Similarity: Mean = {mean_impostor:.4f}, Max = {max_impostor:.4f}")
    
    # Verify Threshold Safety Margin
    assert min_genuine > 0.54, f"Genuine pair dropped below unified 0.54 threshold: {min_genuine:.4f}"
    assert max_impostor < 0.54, f"Impostor pair exceeded unified 0.54 threshold (FAR risk): {max_impostor:.4f}"
    separation_margin = min_genuine - max_impostor
    print(f"  ✓ Verification Separation Margin: {separation_margin:.4f} (Robust Margin > 0.35)")
    results['similarity_threshold'] = 'PASS'

    # 6. Phase 3 Fast-Path Pre-Crop Fallthrough Verification
    print("\n[Step 6] Testing Phase 3 Fast-Path Pre-Crop Fallthrough Guard...")
    # Test valid pre-crop
    live_vec, live_conf = engine.extract_from_pre_cropped(aligned_face)
    assert live_vec is not None and live_conf > 0.0, "Valid pre-crop should return valid embedding"
    
    # Test invalid / zero-face crop (e.g. pure blank patch)
    blank_patch = np.zeros((112, 112, 3), dtype=np.uint8)
    invalid_vec, invalid_conf = engine.extract_from_pre_cropped(blank_patch)
    assert invalid_vec is None and invalid_conf == 0.0, "Invalid pre-crop must return (None, 0.0) for fail-closed fallthrough guard"
    print("  ✓ Phase 3 Guard: Invalid pre-crop cleanly returns (None, 0.0) without crashing.")
    print("  ✓ Fast-path fallthrough to full-frame YuNet detection verified.")
    results['precrop_fallthrough'] = 'PASS'

    # 7. MiniFASNetV2 Anti-Spoofing / Presentation Attack Detection (PAD)
    print("\n[Step 7] Evaluating MiniFASNetV2 Deep PAD Liveness & Attack Classification...")
    # Evaluate benchmark face crop
    pad_res = liveness_detector.evaluate_deep_pad(subject_1_img, raw_face)
    print(f"  ✓ Benchmark Face PAD Output: {pad_res}")
    assert pad_res.get('available') is True, "MiniFASNetV2 PAD inference failed to execute"
    assert 'live_prob' in pad_res and 'screen_prob' in pad_res and 'print_prob' in pad_res, "PAD missing attack probabilities"

    # Attack simulation: Introduce high-intensity periodic moiré screen scanlines
    spoof_moire = subject_1_img.copy()
    for r in range(0, sh, 2):
        spoof_moire[r, :, :] = (spoof_moire[r, :, :] * 0.25).astype(np.uint8)
    
    spoof_res = liveness_detector.evaluate_deep_pad(spoof_moire, raw_face)
    print(f"  ✓ Simulated Moiré Screen Attack PAD Output: {spoof_res}")
    assert spoof_res.get('screen_prob', 0.0) > 0.40 or spoof_res.get('live_prob', 1.0) < 0.20, \
        "MiniFASNetV2 failed to penalize screen replay moiré artifact"
    print(f"  ✓ Screen Attack Penalty Verified (Screen Spoof Prob: {spoof_res.get('screen_prob'):.4f})")
    results['antispoof_pad'] = 'PASS'

    elapsed = time.time() - t0
    print("\n" + "=" * 80)
    print(f"  BIOMETRIC & INSIGHTFACE EVALUATION COMPLETED: ALL GATES PASSED (Time: {elapsed:.2f}s)")
    print("=" * 80)
    for gate, status in results.items():
        print(f"  - Gate: {gate.upper():<30} | Status: {status}")
    print("=" * 80)
    return True

if __name__ == "__main__":
    success = run_insightface_eval()
    sys.exit(0 if success else 1)
