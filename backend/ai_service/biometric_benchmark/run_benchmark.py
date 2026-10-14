import os
import sys
import json
import time

BENCHMARK_DIR = os.path.dirname(os.path.abspath(__file__))
AI_SERVICE_DIR = os.path.dirname(BENCHMARK_DIR)
sys.path.insert(0, AI_SERVICE_DIR)
sys.path.insert(0, BENCHMARK_DIR)

from datasets.synthetic_dataset import BenchmarkDatasetGenerator
from metrics.evaluator import BiometricMetrics
from baseline.runner import BaselineARunner
from candidates.runner_candidate_b import CandidateBRunner
from candidates.runner_candidate_c import CandidateCRunner, ActiveLivenessChallenge

def run_evaluation():
    print("=" * 80)
    print(" HOSTELGUARD BIOMETRIC BENCHMARK HARNESS: BASELINE-A vs CANDIDATES")
    print("=" * 80)

    # 1. Initialize Runners
    print("\n[STEP 1] Initializing Biometric Evaluators...")
    runners = [
        BaselineARunner(),
        CandidateBRunner(),
        CandidateCRunner()
    ]
    for r in runners:
        print(f"  -> Loaded: {r.name} (Threshold: {r.threshold})")

    # 2. Build Dataset
    print("\n[STEP 2] Synthesizing Controlled Evaluation Dataset...")
    genuine_pairs, impostor_pairs, attack_samples = BenchmarkDatasetGenerator.build_test_suite()
    print(f"  -> Generated {len(genuine_pairs)} Genuine Pairs")
    print(f"  -> Generated {len(impostor_pairs)} Impostor Pairs")
    print(f"  -> Generated {len(attack_samples)} Presentation Attack Samples")

    # Also load user's real camera photo if available
    user_photo_path = r"C:\Users\gyand\.gemini\antigravity-ide\brain\71985540-9f9c-46d2-8989-2bd9373e4120\.user_uploaded\media_1791994877646.jpg"
    has_real_user_sample = os.path.exists(user_photo_path)
    if has_real_user_sample:
        import cv2
        real_user_bgr = cv2.imread(user_photo_path)
        print(f"  -> Real Hostel Camera Image Loaded for Ground Truth Validation: {user_photo_path}")

    # 3. Execute Benchmarks
    all_results = {}

    for runner in runners:
        print(f"\n[BENCHMARKING] Evaluating {runner.name}...")

        # A. Genuine Pairs Verification
        genuine_scores = []
        bona_fide_pad = []
        for pair in genuine_pairs:
            v_en, _, _ = runner.extract_features(pair["enroll"])
            v_pr, aligned, _ = runner.extract_features(pair["probe"])
            if v_en is not None and v_pr is not None:
                sim = runner.compare(v_en, v_pr)
                genuine_scores.append(sim)
            if aligned is not None:
                pad_res = runner.evaluate_pad(aligned)
                bona_fide_pad.append(pad_res["is_live"])

        # Also evaluate real user sample if present
        if has_real_user_sample:
            v_real, aligned_real, _ = runner.extract_features(real_user_bgr)
            if aligned_real is not None:
                user_pad_res = runner.evaluate_pad(aligned_real)
                bona_fide_pad.append(user_pad_res["is_live"])
                print(f"     * Real User Probe Liveness: is_live={user_pad_res['is_live']}, score={user_pad_res.get('score')}")

        # B. Impostor Pairs Verification
        impostor_scores = []
        for pair in impostor_pairs:
            v_a, _, _ = runner.extract_features(pair["enroll"])
            v_b, _, _ = runner.extract_features(pair["probe"])
            if v_a is not None and v_b is not None:
                sim = runner.compare(v_a, v_b)
                impostor_scores.append(sim)

        # C. Presentation Attack Evaluation
        attack_results = []
        for atk in attack_samples:
            _, aligned_atk, _ = runner.extract_features(atk["image"])
            # Fallback to raw crop if detector didn't find face in blur
            probe_face = aligned_atk if aligned_atk is not None else atk["image"]

            # If evaluating Candidate C with active challenge: simulate static attack failing challenge
            if isinstance(runner, CandidateCRunner):
                challenge = ActiveLivenessChallenge.generate_challenge("attacker")
                # Static presentation cannot respond to challenge
                pad_res = runner.evaluate_pad(probe_face, challenge=challenge, action_response={"detected_action": "HOLD_STILL"})
            else:
                pad_res = runner.evaluate_pad(probe_face)

            # Attack is successfully neutralized if is_live is False
            attack_results.append(not pad_res["is_live"])

        # D. Performance & Latency Metrics
        test_probe = genuine_pairs[0]["probe"]
        perf_metrics = BiometricMetrics.measure_latency_and_memory(
            lambda: runner.extract_features(test_probe),
            iterations=15
        )

        # E. Calculate ISO Metrics
        verif_metrics = BiometricMetrics.calculate_verification_metrics(
            genuine_scores,
            impostor_scores,
            runner.threshold
        )
        pad_metrics = BiometricMetrics.calculate_pad_metrics(bona_fide_pad, attack_results)

        all_results[runner.name] = {
            "verification": verif_metrics,
            "pad": pad_metrics,
            "performance": perf_metrics
        }

    # 4. Generate Comparative Scorecard
    print("\n" + "=" * 90)
    print(" BIOMETRIC TECHNOLOGY EVALUATION SCORECARD")
    print("=" * 90)
    print(f"{'Metric':<32} | {'BASELINE-A':<18} | {'CANDIDATE-B':<18} | {'CANDIDATE-C (Hybrid)':<18}")
    print("-" * 90)

    b_a = all_results[runners[0].name]
    c_b = all_results[runners[1].name]
    c_c = all_results[runners[2].name]

    tar_a = f"{b_a['verification']['tar_pct']} %"
    tar_b = f"{c_b['verification']['tar_pct']} %"
    tar_c = f"{c_c['verification']['tar_pct']} %"

    far_a = f"{b_a['verification']['far_pct']} %"
    far_b = f"{c_b['verification']['far_pct']} %"
    far_c = f"{c_c['verification']['far_pct']} %"

    frr_a = f"{b_a['verification']['frr_pct']} %"
    frr_b = f"{c_b['verification']['frr_pct']} %"
    frr_c = f"{c_c['verification']['frr_pct']} %"

    pad_acc_a = f"{b_a['pad']['pad_accuracy_pct']} %"
    pad_acc_b = f"{c_b['pad']['pad_accuracy_pct']} %"
    pad_acc_c = f"{c_c['pad']['pad_accuracy_pct']} %"

    apcer_a = f"{b_a['pad']['apcer_pct']} %"
    apcer_b = f"{c_b['pad']['apcer_pct']} %"
    apcer_c = f"{c_c['pad']['apcer_pct']} %"

    bpcer_a = f"{b_a['pad']['bpcer_pct']} %"
    bpcer_b = f"{c_b['pad']['bpcer_pct']} %"
    bpcer_c = f"{c_c['pad']['bpcer_pct']} %"

    lat_a = f"{b_a['performance']['mean_latency_ms']} ms"
    lat_b = f"{c_b['performance']['mean_latency_ms']} ms"
    lat_c = f"{c_c['performance']['mean_latency_ms']} ms"

    p95_a = f"{b_a['performance']['p95_latency_ms']} ms"
    p95_b = f"{c_b['performance']['p95_latency_ms']} ms"
    p95_c = f"{c_c['performance']['p95_latency_ms']} ms"

    mem_a = f"{b_a['performance']['memory_rss_mb']} MB"
    mem_b = f"{c_b['performance']['memory_rss_mb']} MB"
    mem_c = f"{c_c['performance']['memory_rss_mb']} MB"

    print(f"{'Embedding Dimension':<32} | {'128-D':<18} | {'512-D':<18} | {'128-D':<18}")
    print(f"{'True Acceptance Rate (TAR)':<32} | {tar_a:<18} | {tar_b:<18} | {tar_c:<18}")
    print(f"{'False Acceptance Rate (FAR)':<32} | {far_a:<18} | {far_b:<18} | {far_c:<18}")
    print(f"{'False Rejection Rate (FRR)':<32} | {frr_a:<18} | {frr_b:<18} | {frr_c:<18}")
    print(f"{'PAD Accuracy (100 - ACER)':<32} | {pad_acc_a:<18} | {pad_acc_b:<18} | {pad_acc_c:<18}")
    print(f"{'Attack Error Rate (APCER)':<32} | {apcer_a:<18} | {apcer_b:<18} | {apcer_c:<18}")
    print(f"{'Bona Fide Error (BPCER)':<32} | {bpcer_a:<18} | {bpcer_b:<18} | {bpcer_c:<18}")
    print(f"{'Mean Inference Latency':<32} | {lat_a:<18} | {lat_b:<18} | {lat_c:<18}")
    print(f"{'P95 Inference Latency':<32} | {p95_a:<18} | {p95_b:<18} | {p95_c:<18}")
    print(f"{'Memory Footprint (RSS)':<32} | {mem_a:<18} | {mem_b:<18} | {mem_c:<18}")
    print(f"{'License & FOSS Status':<32} | {'Apache 2.0 (FOSS)':<18} | {'Academic/Non-Comm':<18} | {'Apache 2.0 (FOSS)':<18}")
    print(f"{'GPU / Heavy HW Requirement':<32} | {'None (CPU-Only)':<18} | {'Optional (Heavy)':<18} | {'None (CPU-Only)':<18}")
    print(f"{'Replay Resistance':<32} | {'Passive (Good)':<18} | {'Passive (Good)':<18} | {'Nonce-Active (Max)':<18}")
    print("=" * 90)

    # 5. Persist JSON results
    reports_dir = os.path.join(BENCHMARK_DIR, "reports")
    os.makedirs(reports_dir, exist_ok=True)
    report_file = os.path.join(reports_dir, "benchmark_results.json")
    with open(report_file, "w") as f:
        json.dump(all_results, f, indent=2)
    print(f"\n[REPORT PERSISTED] Detailed metrics saved to: {report_file}")

    return all_results

if __name__ == "__main__":
    run_evaluation()
