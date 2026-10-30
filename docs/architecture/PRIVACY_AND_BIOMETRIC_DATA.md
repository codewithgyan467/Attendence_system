# Biometric Data Handling & Privacy Policy: HostelGuard Enterprise

## 1. Principles of Biometric Privacy

HostelGuard is engineered under strict privacy-by-design standards:
1. **Zero External Cloud AI APIs**: No biometric facial images, live video frames, or feature vectors are ever sent to external cloud vendors (such as AWS Rekognition, Google Cloud Vision, or Azure Face API). All computer-vision processing occurs entirely on the local server.
2. **Ephemeral Image Processing**: Raw facial photographs submitted during daily attendance check-ins are processed in memory and immediately discarded after vector comparison. They are never written to public folders or permanently stored on disk.
3. **Protected Mathematical Embeddings**: Registered face templates are stored as 128-dimensional floating-point vector arrays (derived from OpenCV SFace). Reconstructing a human face photograph from a 128-dimensional mathematical vector is computationally irreversible.
4. **Data Minimization**: The platform records only the minimum data required to verify attendance: timestamp, great-circle distance at submission, and verification status (`PRESENT`, `ABSENT`). Precise personal GPS breadcrumbs or location histories are never tracked.

---

## 2. Biometric Template Lifecycle

```
[Student Webcam] ──► [Base64 In-Memory Buffer]
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
[Phase 2 Onboarding]            [Phase 3 Check-In]
128-D Vectors Extracted         Transient Live Frame
             │                           │
             ▼                           ▼
[student_face_embeddings]       Cosine Vector Comparison
(Protected SQL Table)           (Stored Vectors vs Live)
                                         │
                                         ▼
                                [Destroy Live Frame Buffer]
                                [Persist Attendance Record]
```

---

## 3. Student Rights & Data Management

- **Right to Erasure**: When a student graduates or is archived from the hostel roster, administrators can purge their biometric embedding records (`student_face_embeddings`) while preserving historical attendance reporting logs.
- **Access Transparency**: Students can inspect their stored enrollment status, number of registered embedding angles, and attendance records through the authenticated Student Portal at any time.
- **Administrative Correction**: Legitimate residents who experience sensor errors or facial appearance alterations (e.g. temporary injuries) can submit correction appeals for authorized warden review.
