"""
scripts/test_curfew_load.py
Simulates 30 concurrent student curfew check-ins against the AI Biometric Engine (/verify-attendance)
to verify that INFERENCE_SEMAPHORE(4) queues requests cleanly under 2 seconds average latency.
"""

import sys
import os
import time
import asyncio
import numpy as np
import cv2

# Add backend/ai_service to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend", "ai_service")))

from app.main import app, INFERENCE_SEMAPHORE
from httpx import AsyncClient, ASGITransport

def generate_synthetic_face_jpg() -> bytes:
    # Create a clean synthetic face frame with face-like geometry (eyes, nose, mouth)
    img = np.ones((250, 250, 3), dtype=np.uint8) * 180
    # Head contour
    cv2.ellipse(img, (125, 125), (70, 95), 0, 0, 360, (210, 210, 210), -1)
    # Eyes
    cv2.circle(img, (95, 105), 10, (50, 50, 50), -1)
    cv2.circle(img, (155, 105), 10, (50, 50, 50), -1)
    # Nose
    cv2.line(img, (125, 115), (125, 140), (80, 80, 80), 3)
    # Mouth
    cv2.ellipse(img, (125, 165), (25, 12), 0, 0, 180, (60, 60, 60), 3)
    _, buf = cv2.imencode(".jpg", img)
    return buf.tobytes()

async def simulate_curfew_load(concurrent_requests: int = 30):
    print(f"\n=======================================================")
    print(f"  HOSTELGUARD CURFEW LOAD SIMULATION ({concurrent_requests} CONCURRENT USERS)")
    print(f"=======================================================")

    face_bytes = generate_synthetic_face_jpg()
    transport = ASGITransport(app=app)
    latencies = []

    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        async def send_single_checkin(request_id: int):
            t0 = time.perf_counter()
            files = {"file": ("face.jpg", face_bytes, "image/jpeg")}
            resp = await client.post("/verify-attendance", files=files)
            elapsed = time.perf_counter() - t0
            latencies.append(elapsed)
            return resp.status_code, elapsed

        start_time = time.perf_counter()
        tasks = [send_single_checkin(i) for i in range(concurrent_requests)]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        total_time = time.perf_counter() - start_time

    success_count = sum(1 for r in results if isinstance(r, tuple) and r[0] == 200)
    error_count = len(results) - success_count
    avg_latency = np.mean(latencies) if latencies else 0.0
    p95_latency = np.percentile(latencies, 95) if latencies else 0.0
    p99_latency = np.percentile(latencies, 99) if latencies else 0.0

    print(f"\n📊 RESULTS SUMMARY:")
    print(f"  - Total Requests:      {concurrent_requests}")
    print(f"  - Successful (200 OK): {success_count} / {concurrent_requests}")
    print(f"  - Failed / Errors:     {error_count}")
    print(f"  - Total Elapsed Time:  {total_time:.2f} seconds")
    print(f"  - Throughput:          {concurrent_requests / total_time:.1f} req/sec")
    print(f"  - Average Latency:     {avg_latency:.3f} seconds")
    print(f"  - 95th Percentile:     {p95_latency:.3f} seconds")
    print(f"  - 99th Percentile:     {p99_latency:.3f} seconds")

    if avg_latency < 2.0 and success_count == concurrent_requests:
        print(f"\n✅ CURFEW LOAD TEST PASSED: Average response time ({avg_latency:.3f}s) is well under 2.0s limit!")
        return True
    else:
        print(f"\n⚠️ CURFEW LOAD TEST NOTICE: Check throughput or error count.")
        return False

if __name__ == "__main__":
    success = asyncio.run(simulate_curfew_load(30))
    sys.exit(0 if success else 1)
