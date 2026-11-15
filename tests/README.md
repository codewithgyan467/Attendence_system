# 🧪 ATTENDRA Automated Test Suites

This directory contains integration, real-world scenario simulations, and load testing tooling for the **ATTENDRA** biometric attendance ecosystem.

---

## 📂 Test Suites Overview

| Subsystem | Location | Test Framework | Description |
| :--- | :--- | :--- | :--- |
| **Backend Core & Security** | [`backend/tests/`](../backend/tests/) | Jest (Node.js) | 18 automated security, geofence, dual-beacon, and biometric approval test suites. |
| **Real-World Load Simulation** | [`tests/real_world_tools/curfew_rush_k6.js`](real_world_tools/curfew_rush_k6.js) | Grafana k6 | Simulates 500+ students concurrent check-in rush before hostel curfew. |
| **BLE Proximity & Beacon Scanner** | [`tests/real_world_tools/bleak_proximity_simulator.py`](real_world_tools/bleak_proximity_simulator.py) | Python (Bleak) | ESP32 hardware beacon RSSI signal validation and multi-floor anchor simulation. |
| **Facial Liveness & Accuracy** | [`tests/real_world_tools/biometric_insightface_eval.py`](real_world_tools/biometric_insightface_eval.py) | Python (OpenCV/YuNet) | Evaluates face recognition accuracy and 3D mesh liveness against indoor light variances. |

---

## 🚀 Running the Tests

### 1. Backend Core & Security Tests (100% Offline)
```bash
cd backend
npm test
```

### 2. Comprehensive Real-World Test Suite
```bash
python tests/real_world_tools/run_all_real_world_tests.py
```
