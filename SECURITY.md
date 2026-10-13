# Security Hardening & Threat Mitigation: HostelGuard Enterprise

## 1. Threat Modeling & Controls Matrix

| Threat Category | Attack Vector | Technical Countermeasure | Severity |
|---|---|---|---|
| **Location Spoofing** | Android Mock Location apps, fake GPS tunnels, proxy headers | Server-side Haversine mathematical calculation, device mock-location indicator inspection, GPS accuracy thresholds ($\le 40$m), and 3-strike Forge Location rule. | High |
| **Token Replay** | Intercepting a valid geofence session token and reusing it later | `attendance_challenges` table records tokens with 5-minute expiry and `is_used` atomic flag. Subsequent requests with used tokens fail with HTTP 403. | High |
| **Biometric Presentation Attack** | Printed color photos, high-res smartphone screen replays, paper cutouts | Laplacian texture variance filtering ($\ge 40.0$), 2D FFT frequency analysis for digital moiré screen lines, multi-angle onboarding requirement. | High |
| **Identity Theft / Impersonation** | Manually typing a different student's name during registration | Strict Pre-Allotment Roster constraint: Students select identity from an admin-uploaded dropdown. Official full names cannot be edited by clients. | Critical |
| **Brute Force & Credential Stuffing** | Automated dictionary attacks against `/api/v1/auth/login` | Tiered IP-based rate limiting (`express-rate-limit` window 15 min, max 10 requests), salted bcrypt password hashing (cost factor 10). | Medium |
| **Privilege Escalation** | Client tampering with JWT payload or accessing admin APIs | Server-side verification of HMAC-SHA256 signature, resource-level RBAC middleware (`requireRole`). | Critical |
| **Database Injection** | SQL Injection via form input | 100% parameterized queries (`db.run(sql, params)`) throughout all service layers. Zero raw string concatenation. | Critical |
| **Audit Tampering** | Malicious administrator deleting evidence of unauthorized overrides | Non-destructive audit pattern: Manual overrides preserve original check-in evidence; all actions record to immutable `admin_audit_events`. | High |

---

## 2. Biometric Liveness Limitations & Honest Assessment

While HostelGuard implements local anti-spoofing techniques, no 2D RGB computer-vision system can guarantee 100% presentation-attack detection.

### Verified Signals:
1. **Laplacian Variance Texture Analysis**: Detects blurred or printed paper photographs by measuring high-frequency image edge gradients.
2. **2D Fast Fourier Transform (FFT) Frequency Analysis**: Detects digital screen replays by identifying regular pixel grids and moiré interference patterns emitted by LCD/OLED phone screens.

### Documented Limitations:
- **High-Definition Tablets / 4K Displays**: High pixel-density OLED screens held at optimal focal distances can occasionally bypass 2D texture variance checks.
- **Extreme Lighting Variations**: Very low ambient lighting reduces Laplacian variance, which may trigger false rejections for legitimate students.
- **Physical 3D Masks**: 2D monocular cameras cannot measure depth or infrared reflectance without dedicated 3D structured light hardware (e.g. Apple TrueDepth or Intel RealSense).

### Fail-Safe Administrative Workflow:
To prevent students from being penalized by false rejections or camera sensor limitations, students can submit an appeal through the **Student Attendance Appeal Desk**, allowing wardens to review and apply non-destructive overrides with documented justification.

---

## 3. Defense-in-Depth Implementation

```
1. Client TLS Encryption (HTTPS Reverse Proxy)
        │
2. Helmet Security Headers (HSTS, CSP, X-Frame-Options)
        │
3. Express Rate Limiting (Tiered per endpoint category)
        │
4. JWT Signature & Expiration Verification
        │
5. Role-Based Authorization Guards (ADMIN, WARDEN, STUDENT)
        │
6. Server-Authoritative Haversine Geofence Engine
        │
7. Single-Use Replay-Protected Challenge Tokens
        │
8. Local Python AI Computer Vision (YuNet + SFace 128D)
        │
9. Parameterized SQLite WAL Atomic Transactions
```
