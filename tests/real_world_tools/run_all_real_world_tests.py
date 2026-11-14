#!/usr/bin/env python3
"""
HostelGuard Enterprise v4.0 - Master Real-World Test Suite Runner
Orchestrates:
1. InsightFace Biometric & Facial Analysis Evaluation (deepinsight/insightface)
2. Bleak IoT & BLE Proximity Simulation (hbldh/bleak)
3. Grafana k6 API Load & Concurrency Testing - Curfew Rush Simulation (grafana/k6)
"""

import os
import sys
import time
import subprocess
import requests

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
K6_BIN = os.path.join(REPO_ROOT, "tools", "k6", "k6.exe")

def run_cmd(cmd, cwd=REPO_ROOT, env=None):
    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )
    output = []
    for line in iter(proc.stdout.readline, ''):
        print(line, end='', flush=True)
        output.append(line)
    proc.stdout.close()
    proc.wait()
    return proc.returncode, "".join(output)

def main():
    print("=" * 85)
    print("  HOSTELGUARD ENTERPRISE v4.0 — REAL-WORLD TESTING SUITE ORCHESTRATOR")
    print("  Tools: InsightFace (ArcFace/YuNet) | Bleak (BLE IoT) | Grafana k6 (Load & Concurrency)")
    print("=" * 85)
    
    start_time = time.time()
    results = {}

    # =========================================================================
    # 1. BIOMETRIC & FACE ANALYSIS (InsightFace)
    # =========================================================================
    print("\n" + "#" * 85)
    print("  [SUITE 1/3] Biometric & Face Analysis Evaluation (InsightFace)")
    print("#" * 85)
    code_bio, out_bio = run_cmd([sys.executable, "tests/real_world_tools/biometric_insightface_eval.py"])
    results["InsightFace Biometric Evaluation"] = "PASSED" if code_bio == 0 else "FAILED"
    if code_bio != 0:
        print("  ❌ Biometric evaluation failed!")

    # =========================================================================
    # 2. IoT & BLE PROXIMITY SIMULATION (Bleak)
    # =========================================================================
    print("\n" + "#" * 85)
    print("  [SUITE 2/3] IoT & BLE Proximity Simulation (Bleak)")
    print("#" * 85)
    code_ble, out_ble = run_cmd([sys.executable, "tests/real_world_tools/bleak_proximity_simulator.py"])
    results["Bleak IoT & BLE Proximity Simulation"] = "PASSED" if code_ble == 0 else "FAILED"
    if code_ble != 0:
        print("  ❌ Bleak proximity simulation failed!")

    # =========================================================================
    # 3. API LOAD & CONCURRENCY (Grafana k6 - Curfew Rush Simulation)
    # =========================================================================
    print("\n" + "#" * 85)
    print("  [SUITE 3/3] API Load & Concurrency Testing (Grafana k6 — Curfew Rush)")
    print("#" * 85)

    test_port = 5055
    server_env = os.environ.copy()
    server_env["PORT"] = str(test_port)
    server_env["NODE_ENV"] = "test"
    server_env["JWT_SECRET"] = "production_hardened_jwt_secret_32_characters_minimum!!"
    
    print(f"[*] Starting local backend test instance on port {test_port}...")
    server_proc = subprocess.Popen(
        ["node", "backend/src/server.js"],
        cwd=REPO_ROOT,
        env=server_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True
    )

    # Wait for server readiness
    server_ready = False
    for attempt in range(25):
        time.sleep(0.5)
        try:
            r = requests.get(f"http://127.0.0.1:{test_port}/health", timeout=1)
            if r.status_code == 200:
                server_ready = True
                print(f"  ✓ Backend test server operational on http://127.0.0.1:{test_port}/health (Attempt {attempt+1})")
                break
        except Exception:
            pass

    if not server_ready:
        print("  ❌ Test server failed to initialize within 12 seconds.")
        results["Grafana k6 Curfew Rush Load Test"] = "FAILED (Server Start Timeout)"
        if server_proc.poll() is None:
            server_proc.terminate()
    else:
        print(f"[*] Launching k6 Curfew Rush load simulation using {K6_BIN}...")
        k6_cmd = [
            K6_BIN,
            "run",
            "tests/real_world_tools/curfew_rush_k6.js",
            "--env", f"TARGET_URL=http://127.0.0.1:{test_port}"
        ]
        code_k6, out_k6 = run_cmd(k6_cmd)
        results["Grafana k6 Curfew Rush Load Test"] = "PASSED" if code_k6 == 0 else "FAILED"

        # Graceful shutdown of test server
        print("[*] Terminating local backend test server...")
        try:
            server_proc.terminate()
            server_proc.wait(timeout=3)
        except Exception:
            server_proc.kill()
        print("  ✓ Test server terminated.")

    # =========================================================================
    # EXECUTIVE SUMMARY REPORT
    # =========================================================================
    total_elapsed = time.time() - start_time
    all_passed = all(status == "PASSED" for status in results.values())

    print("\n" + "=" * 85)
    print("  HOSTELGUARD ENTERPRISE v4.0 — REAL-WORLD TESTING SCORECARD")
    print("=" * 85)
    print(f"  Execution Time: {total_elapsed:.2f} seconds")
    print(f"  Overall Result: {'✅ ALL REAL-WORLD TEST SUITES PASSED (100%)' if all_passed else '❌ SOME TESTS FAILED'}")
    print("-" * 85)
    for suite, status in results.items():
        icon = "✅" if status == "PASSED" else "❌"
        print(f"  {icon} {suite:<48} | {status}")
    print("=" * 85)

    return 0 if all_passed else 1

if __name__ == "__main__":
    sys.exit(main())
