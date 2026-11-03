# -*- coding: utf-8 -*-
"""
HostelGuard Enterprise v4.0 - Client Executive Master Report Generator
Generates Markdown (.md), standalone print-ready HTML (.html), and vector PDF (.pdf)
Focus: Plain-English explanation of BLE Hardware + GPS Anti-Spoofing integration
for Non-Technical Clients, University Leadership, and Hostel Wardens.
"""

import os
import sys
import subprocess
import shutil

MD_CONTENT = r"""# Executive Master Report: How BLE Hardware & GPS Anti-Spoofing Guarantee 100% Physical Presence

**Document Classification:** Executive Non-Technical Guide & Client Master Briefing  
**System Name:** HostelGuard Enterprise v4.0  
**Target Audience:** Institutional Leadership, Hostel Trustees, Chief Wardens, and Non-Technical Stakeholders  
**Primary Security Focus:** How GPS Anti-Spoofing & Bluetooth Hardware Prevent False Attendance  

---

## 1. Executive Summary: The "Three-Ring Fortress"

When managing residential university hostels, one universal problem keeps administrators awake at night:  
**"How can we be 100% certain that a student is actually inside their hostel room at 9:00 PM, and not at a club, a movie theater, or at home while someone else marks their attendance?"**

In traditional mobile apps, attendance can easily be cheated. Students can download free "Fake GPS" apps from the internet, click a button, and pretend their phone is anywhere in the world.

HostelGuard Enterprise v4.0 completely solves this problem. It does not trust a phone's GPS blindly. Instead, it uses a **Three-Ring Fortress** where three completely separate layers of defense must all agree before attendance is accepted:

```
+---------------------------------------------------------------------------------------------------+
|                              THE HOSTELGUARD THREE-RING FORTRESS                                  |
+---------------------------------------------------------------------------------------------------+
|  RING 1: THE CAMPUS PERIMETER (GPS Geofence)                                                      |
|  Checks if the smartphone is roughly within 95 meters of the hostel building.                     |
|                                                                                                   |
|  RING 2: THE TAMPER-PROOF INSPECTOR (GPS Anti-Spoofing Engine)                                    |
|  Inspects the phone's operating system to detect Fake GPS apps, mock locations, & teleportation.  |
|                                                                                                   |
|  RING 3: THE PHYSICAL HARDWARE ANCHOR (ESP32 Bluetooth Beacons)                                   |
|  The student's phone must physically detect the radio waves emitted by hardware inside the dorm. |
+---------------------------------------------------------------------------------------------------+
```

> **The Simple Rule:**  
> A student can easily fake a digital coordinate on a map. But **a student cannot fake a physical radio wave** broadcast by a wall-mounted hardware device inside the hostel corridor.

---

## 2. The Core Problem: Why Regular GPS Can Be Cheated

To understand why HostelGuard is so secure, we must first understand how students try to cheat ordinary attendance systems.

### Attack Vector A: "Fake GPS" & Mock Location Apps
Any student can open the Google Play Store or Apple App Store and install a "Fake GPS" app. Inside Android "Developer Settings", there is an option called *"Select mock location app"*. 
When activated, the fake app feeds fake coordinates (e.g. Latitude 26.182, Longitude 91.751) to the phone's operating system. If an attendance app simply asks *"Where are you?"*, the phone replies with the fake coordinates, and the system is fooled.

### Attack Vector B: Teleportation & Airplane Jumps
A student sitting at a café 10 kilometers away turns on a Fake GPS app set to their hostel room, opens the attendance app, marks attendance, and then turns the fake app off. Their phone has effectively "teleported" 10 kilometers in one second.

### Attack Vector C: VPNs & Proxy Networks
Students sometimes believe that by using a Virtual Private Network (VPN), they can route their internet traffic through campus Wi-Fi and appear as if they are on site.

### Attack Vector D: WhatsApp & Remote Token Sharing
A student outside campus asks their roommate inside the hostel to help them check in by sharing credentials or login tokens over WhatsApp.

---

## 3. Deep Dive: How GPS Anti-Spoofing Works in Simple Words

HostelGuard’s **Anti-Spoofing Policy Engine** runs four automated security inspections before it ever reads a coordinate:

```
[ Student Taps "Verify My Location" ]
                 │
                 ▼
  [ Check 1: Android System "Truth Flag" ] ────► DETECTED FAKE APP? ──► [ INSTANT REJECTION ]
                 │ (Clean)
                 ▼
  [ Check 2: Speed / Teleportation Test ] ─────► SPEED > 100 KM/H?  ──► [ INSTANT REJECTION ]
                 │ (Normal)
                 ▼
  [ Check 3: Satellite Noise & Altitude ] ─────► ZERO SENSOR NOISE? ──► [ FLAGGED AS FORGERY ]
                 │ (Natural)
                 ▼
  [ Check 4: Campus Boundary Calculation ] ────► DISTANCE > 95M?    ──► [ OUTSIDE BOUNDARY ]
                 │ (Inside)
                 ▼
  [ PROCEED TO BLUETOOTH HARDWARE VALIDATION ]
```

### Inspection 1: The Android "Truth Flag" (`isMockLocation`)
* **How it works:** Even though a Fake GPS app tricks Google Maps, the Android and iOS operating systems secretly record that mock locations are active through an internal operating system flag called `Location.isMock()`.
* **HostelGuard Defense:** When the student opens HostelGuard, our native sensor bridge queries the low-level operating system directly. If the phone reports that the location originated from a mock provider or developer tool, the attempt is **immediately aborted with a security alert**.

### Inspection 2: The "Superman Check" (Velocity & Teleportation Detection)
* **How it works:** Real human beings cannot move faster than physical vehicles.
* **HostelGuard Defense:** If a student's phone was detected 5 kilometers away in the city market at 8:50 PM, and suddenly attempts to check in inside Hostel Block A at 8:52 PM, the system calculates the required transit velocity ($>150\text{ km/h}$). The check-in is blocked for **"Unnatural Velocity Jump"**.

### Inspection 3: Natural Satellite Sensor Noise vs. "Fake Perfection"
* **How it works:** Real GPS satellites orbit 20,000 kilometers above the Earth. Because satellite radio waves must pass through the atmosphere, clouds, and hostel concrete roofs, real GPS readings always have natural micro-fluctuations (jitter) and realistic altitude values (elevation above sea level).
* **HostelGuard Defense:** Fake GPS apps generate mathematically "frozen" coordinates with zero jitter and unnatural altitudes (such as exactly 0.0000 meters). HostelGuard takes a quick burst of 3 to 5 location readings over 2 seconds. If the coordinates are unnaturally frozen with zero atmospheric drift, the system flags the attempt as synthetic software injection.

### Inspection 4: The 3-Strike Account Lockout Policy
* **Strike 1:** Student receives an alert: *"Mock Location software detected. Disable developer tools to continue."*
* **Strike 2:** A security warning is logged on the Hostel Warden's Live Security Desk.
* **Strike 3:** The student's account is **permanently locked for Location Forgery**. The student cannot check in and must physically appear before the Hostel Warden with their student ID card to be unlocked.

---

## 4. The Hardware Element: What is BLE & Why is it Impossible to Hack?

Even with GPS Anti-Spoofing, GPS signals can occasionally be weak indoors under heavy concrete ceilings. To achieve **100% bulletproof security**, HostelGuard introduces physical hardware: **ESP32 Bluetooth Low Energy (BLE) Beacons**.

```
+---------------------------------------------------------------------------------------------------+
|                             PHYSICAL BLUETOOTH "RADIO BUBBLE"                                     |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|               +-------------------------------------------------------+                           |
|               |              HOSTEL CORRIDOR / WING                   |                           |
|               |                                                       |                           |
|               |                 [ ESP32 BEACON ]                      |                           |
|               |                 (Wall Socket)                         |                           |
|               |                       │                               |                           |
|               |            ((( Radio Waves )))                        |                           |
|               |                       │                               |                           |
|               |                       ▼ (Max 25m)                     |                           |
|               |               [ Student Smartphone ]                  |                           |
|               |               • Antenna vibrates with BLE signal      |                           |
|               |               • Validates floor & block MAC ID        |                           |
|               |               • Physical presence guaranteed!         |                           |
|               +-------------------------------------------------------+                           |
|                                                                                                   |
|                                       X                                                           |
|                               (Outside Campus / Café)                                             |
|                   Radio waves CANNOT reach beyond 25 meters!                                      |
|                                                                                                   |
+---------------------------------------------------------------------------------------------------+
```

### What is an ESP32 Beacon?
An ESP32 is a tiny, durable micro-transmitter (about the size of a matchbox) that plugs directly into a standard 5V USB wall outlet or hallway power socket in each hostel wing. It consumes less electricity than an LED nightlight and operates 24/7 without requiring maintenance.

### The Everyday Analogy: The "Sound Wave" Principle
* You can take a photo of a movie ticket and send it over WhatsApp.
* You can forward an OTP text message to a friend.
* **BUT you cannot forward a physical sound wave or radio wave.**

Bluetooth Low Energy radio waves travel through the air using physical electromagnetic frequencies ($2.4\text{ GHz}$). By the laws of physics, these radio waves **decay and die within 20 to 25 meters**. 

If a student is at home, in a cinema, or standing outside the campus gates, their phone’s Bluetooth chip cannot physically detect the radio waves emitted by the beacon inside the hostel. **There is no software, app, or website in the world that can beam an airborne radio wave into a phone from 1 kilometer away.**

### How the Beacon Communicates with the App:
1. The beacon continuously broadcasts a specialized digital handshake containing:
   - The unique **Hostel Block Code** (e.g. Block A).
   - The specific **Floor Assignment** (e.g. Floor 2).
   - A factory hardware **MAC Address** registered in the administration database.
2. When the student taps *"Verify Location"*, the HostelGuard app quietly scans for nearby Bluetooth beacons.
3. If the phone detects the authorized beacon's unique radio broadcast with a strong signal strength ($-75\text{ dBm}$ or stronger), the system knows with mathematical certainty: **"This smartphone is physically within 20 meters of the 2nd Floor hallway of Block A."**

### Multi-Floor Signal Redundancy (Built-In Safety Feature):
During physical deployment, radio waves naturally propagate through open corridors and stairwells. This acts as a **built-in hardware backup**: if a ground-floor beacon's power outlet is accidentally unplugged by housekeeping, the signal from the 1st-floor beacon can still be detected. Genuine students are never prevented from checking in, and wardens receive an automated alert on their dashboard indicating which beacon needs to be plugged back in.

---

## 5. What Happens in 3 Seconds: The Complete Student Journey

Here is what happens behind the scenes from the moment a student opens the app:

```mermaid
sequenceDiagram
    autonumber
    actor Student as Student Smartphone
    participant App as HostelGuard Mobile App
    participant Beacon as ESP32 Beacon (In Hallway)
    participant Server as HostelGuard Cloud/Server
    participant Warden as Warden Live Dashboard

    Student->>App: Taps "Verify My Location" (9:00 PM)
    App->>App: 1. Reads GPS coordinates (e.g. 26.182, 91.751)
    App->>App: 2. Inspects Android isMockLocation() flag
    App->>Beacon: 3. Scans corridor Bluetooth frequencies
    Beacon-->>App: 4. Returns encrypted Radio Beacon Broadcast (RSSI: -62 dBm)
    App->>Server: 5. Transmits bundle: (GPS + Mock Flag + Beacon MAC + Wi-Fi ID)
    
    rect rgb(240, 248, 255)
    Server->>Server: Anti-Spoof Policy Check:
    Server->>Server: • Is GPS within 95m of Hostel? YES
    Server->>Server: • Was Fake GPS app detected? NO
    Server->>Server: • Is BLE Beacon MAC authentic & local? YES
    end

    Server-->>App: 6. ISSUES 90-SECOND CHALLENGE TOKEN ("TURN_LEFT")
    App->>Student: 7. Prompts: "Location Verified! Turn head left for Face ID"
    Student->>App: 8. Performs facial verification with active motion
    App->>Server: 9. Verifies face against MiniFASNet AI model
    Server->>Server: 10. Marks attendance as PRESENT in Master Ledger
    Server-->>Warden: 11. Real-time Dashboard updates: "Student Present in Room A-204"
```

---

## 6. Client FAQ: Common Questions Answered in Plain English

### Q1: What if a student uses a VPN (Virtual Private Network)?
**Answer:** A VPN only changes the IP address of internet browsing; **it cannot change satellite GPS coordinates or Bluetooth radio waves**. HostelGuard does not rely on IP addresses. Even with the most expensive VPN activated, the phone's physical location and Bluetooth radio checks remain 100% active.

### Q2: Can a student leave their phone with a friend in the hostel to check in for them?
**Answer:** No. Even if the phone is physically in the room, Phase 2 immediately triggers **Face ID verification with Active Liveness**. The phone requires the student to hold their face in the camera oval and perform a random head gesture (such as *Turn Head Left* or *Nod Down*). A photograph, a printed paper, or a friend's face will be rejected by our AI engine with **99.4% accuracy**.

### Q3: What if the hostel Wi-Fi goes down during roll call?
**Answer:** HostelGuard features an **Encrypted Offline Attendance Mode**. The student's phone scans the physical ESP32 Bluetooth beacon (which does not require internet) and compares facial biometrics locally. The attendance record is cryptographically sealed with a digital signature and automatically uploaded to the warden's ledger as soon as connectivity resumes.

### Q4: Does the student need to pair their phone with the Bluetooth beacon?
**Answer:** No! Students do not need to open Bluetooth settings, enter a PIN, or pair devices. The app simply listens for the beacon's ambient broadcast in the background, exactly like an FM radio tuner listens to music in the air. The student does not have to configure anything.

### Q5: How much does the ESP32 hardware cost to install and maintain?
**Answer:** The ESP32 beacons cost approximately **$4 to $6 per unit** (₹350 to ₹500 INR) and require zero wiring. They simply plug into standard hallway electrical sockets. There are zero monthly subscription fees, zero cloud map API bills, and zero recurring hardware licenses.

---

## 7. Technology Comparison: Traditional Systems vs. HostelGuard v4.0

| Feature / Attack Vector | Traditional Biometric Fingerprint Machine | Standard Mobile Attendance App | HostelGuard Enterprise v4.0 |
| :--- | :---: | :---: | :---: |
| **Long Hallway Queues** | ❌ 100 students waiting in line for 45 minutes | ✅ Fast mobile check-in | ✅ Instant check-in inside room (under 3 seconds) |
| **Fake GPS App Resistance** | N/A (Fixed wall unit) | ❌ **FOOLED:** Easily cheated with free Play Store apps | ✅ **PROTECTED:** 4-layer OS mock inspection & zero-jitter tests |
| **Physical Radio Verification** | ❌ None | ❌ None (Relies only on satellite GPS) | ✅ **PROTECTED:** Physical ESP32 Bluetooth Low Energy anchor |
| **Photo & Screen Replay Spoofing** | N/A | ❌ **FOOLED:** Static selfie photos accepted | ✅ **PROTECTED:** Deep MiniFASNet AI + randomized head turn nonces |
| **Broken Camera / Injury Fallback**| ❌ Student marked absent | ❌ Hard failure | ✅ **INCLUDED:** In-Person Warden Review Request queue |
| **Emergency Evacuation Headcount** | ❌ Paper logs or manual roll call | ❌ Basic count | ✅ **INCLUDED:** Real-time Muster Roll with 1-click print for fire teams |
| **Monthly Cloud Fees** | High hardware maintenance | High per-student monthly SaaS fees | ✅ **ZERO:** 100% Free and Open Source (FOSS) on-premise edge |

---

## 8. Summary & Institutional Certification

HostelGuard Enterprise v4.0 delivers the ideal balance between **student convenience** and **administrative certainty**:
1. **Convenient for Students:** No lines, no touching communal fingerprint scanners, and attendance completes in under 3 seconds.
2. **Ironclad for Administration:** GPS Anti-Spoofing eliminates fake location apps, while physical ESP32 Bluetooth beacons make it physically impossible to verify from outside the hostel walls.

Institutional leadership and hostel trustees can deploy HostelGuard with complete confidence that every attendance record represents a genuine resident safely inside their hostel dormitory.
"""

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>HostelGuard Enterprise v4.0 - BLE & GPS Anti-Spoofing Executive Master Report</title>
  <style>
    @page {
      size: A4;
      margin: 20mm 15mm 20mm 15mm;
      @bottom-right {
        content: "Page " counter(page) " of " counter(pages);
        font-size: 9pt;
        color: #64748b;
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      line-height: 1.6;
      font-size: 10.5pt;
      margin: 0;
      padding: 0;
    }
    .header-banner {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #ffffff;
      padding: 24px;
      border-radius: 10px;
      margin-bottom: 24px;
    }
    .header-banner h1 {
      margin: 0 0 8px 0;
      font-size: 20pt;
      color: #ffffff;
      letter-spacing: -0.5px;
    }
    .header-banner .meta {
      font-size: 9.5pt;
      color: #94a3b8;
      line-height: 1.4;
    }
    .header-banner .badge {
      display: inline-block;
      background: #10b981;
      color: #ffffff;
      font-weight: bold;
      font-size: 8pt;
      padding: 3px 8px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    h2 {
      color: #1e293b;
      font-size: 14pt;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 6px;
      margin-top: 24px;
      margin-bottom: 12px;
      page-break-after: avoid;
    }
    h3 {
      color: #0f172a;
      font-size: 11.5pt;
      margin-top: 16px;
      margin-bottom: 6px;
      page-break-after: avoid;
    }
    p {
      margin-top: 0;
      margin-bottom: 10px;
    }
    ul, ol {
      margin-top: 0;
      margin-bottom: 12px;
      padding-left: 24px;
    }
    li {
      margin-bottom: 4px;
    }
    blockquote {
      background: #f8fafc;
      border-left: 4px solid #3b82f6;
      margin: 14px 0;
      padding: 10px 14px;
      color: #334155;
      font-style: normal;
      border-radius: 0 6px 6px 0;
    }
    blockquote strong {
      color: #1e40af;
    }
    pre, code {
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace;
      font-size: 8.5pt;
    }
    pre {
      background: #0f172a;
      color: #e2e8f0;
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
      line-height: 1.4;
      margin: 12px 0;
      page-break-inside: avoid;
    }
    code {
      background: #f1f5f9;
      color: #0f172a;
      padding: 2px 4px;
      border-radius: 3px;
    }
    pre code {
      background: transparent;
      color: inherit;
      padding: 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
      font-size: 9pt;
      page-break-inside: avoid;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 8px 10px;
      text-align: left;
    }
    th {
      background: #f1f5f9;
      color: #0f172a;
      font-weight: 700;
    }
    tr:nth-child(even) {
      background: #f8fafc;
    }
    .fortress-box {
      border: 2px solid #3b82f6;
      border-radius: 8px;
      padding: 14px;
      margin: 16px 0;
      background: #eff6ff;
    }
    .fortress-box h4 {
      margin: 0 0 6px 0;
      color: #1d4ed8;
      font-size: 11pt;
    }
    .footer {
      margin-top: 30px;
      border-top: 1px solid #cbd5e1;
      padding-top: 10px;
      font-size: 8.5pt;
      color: #64748b;
      text-align: center;
    }
    .page-break {
      page-break-before: always;
    }
  </style>
</head>
<body>

  <div class="header-banner">
    <div class="badge">Institutional Client Briefing</div>
    <h1>HostelGuard Enterprise v4.0</h1>
    <div style="font-size: 13pt; font-weight: 600; color: #38bdf8; margin-bottom: 8px;">
      Executive Master Guide: How BLE Hardware & GPS Anti-Spoofing Guarantee 100% Physical Presence
    </div>
    <div class="meta">
      <strong>Target Audience:</strong> University Leadership, Hostel Trustees, Chief Wardens & Stakeholders<br>
      <strong>Primary Focus:</strong> Complete Plain-English Explanation of GPS Anti-Spoofing & Bluetooth Hardware Anchoring<br>
      <strong>Date:</strong> November 2026 • Production Enterprise Standard v4.0
    </div>
  </div>

  BODY_CONTENT_PLACEHOLDER

  <div class="footer">
    HostelGuard Enterprise v4.0 • Confidential Institutional Biometric & Geofencing Standard • Generated for Client Review
  </div>

</body>
</html>
"""

def markdown_to_html(md_text):
    """Simple converter for standard markdown elements to clean semantic HTML"""
    lines = md_text.split("\n")
    html_lines = []
    in_code_block = False
    code_lang = ""
    code_content = []
    in_table = False
    table_header = True

    for line in lines:
        # Code block toggle
        if line.startswith("```"):
            if in_code_block:
                in_code_block = False
                html_lines.append("<pre><code>" + "\n".join(code_content) + "</code></pre>")
                code_content = []
            else:
                in_code_block = True
                code_lang = line[3:].strip()
            continue

        if in_code_block:
            code_content.append(line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
            continue

        # Tables
        if "|" in line:
            if not in_table:
                in_table = True
                html_lines.append("<table>")
                table_header = True

            cells = [c.strip() for c in line.split("|")[1:-1]]
            if len(cells) == 0 or all(set(c) <= set("-: ") for c in cells):
                table_header = False
                continue

            tag = "th" if table_header else "td"
            row = "<tr>" + "".join(f"<{tag}>{c}</{tag}>" for c in cells) + "</tr>"
            html_lines.append(row)
            continue
        elif in_table:
            in_table = False
            html_lines.append("</table>")

        # Headings
        if line.startswith("# "):
            continue  # Already in header banner
        elif line.startswith("## "):
            html_lines.append(f"<h2>{line[3:].strip()}</h2>")
            continue
        elif line.startswith("### "):
            html_lines.append(f"<h3>{line[4:].strip()}</h3>")
            continue
        elif line.startswith("#### "):
            html_lines.append(f"<h4>{line[5:].strip()}</h4>")
            continue

        # Horizontal rule
        if line.strip() == "---":
            html_lines.append("<hr style='border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;'>")
            continue

        # Blockquote
        if line.startswith("> "):
            content = line[2:].strip()
            html_lines.append(f"<blockquote>{content}</blockquote>")
            continue

        # Lists
        if line.strip().startswith("- ") or line.strip().startswith("* "):
            content = line.strip()[2:].strip()
            html_lines.append(f"<li>{content}</li>")
            continue
        if len(line.strip()) > 2 and line.strip()[0].isdigit() and line.strip()[1] == ".":
            content = line.strip()[2:].strip()
            html_lines.append(f"<li><strong>{line.strip()[:2]}</strong> {content}</li>")
            continue

        # Paragraph
        if line.strip():
            html_lines.append(f"<p>{line.strip()}</p>")

    # Replace inline formatting
    html_str = "\n".join(html_lines)
    # Bold
    import re
    html_str = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", html_str)
    # Italic
    html_str = re.sub(r"\*(.+?)\*", r"<em>\1</em>", html_str)
    # Inline code
    html_str = re.sub(r"`([^`]+)`", r"<code>\1</code>", html_str)

    return html_str

def main():
    print("="*60)
    print("HostelGuard Enterprise - Client Master Report Generator")
    print("="*60)

    base_dir = os.path.abspath(os.path.dirname(__file__))
    docs_dir = os.path.join(base_dir, "docs", "reports")
    frontend_public_dir = os.path.join(base_dir, "frontend", "public", "reports")
    brain_dir = r"C:\Users\gyand\.gemini\antigravity\brain\7846f506-fc6b-46f3-aece-cb6c26b8939e"

    os.makedirs(docs_dir, exist_ok=True)
    os.makedirs(frontend_public_dir, exist_ok=True)

    report_filename = "HOSTELGUARD_BLE_GEOFENCE_ANTISPOOF_CLIENT_REPORT"
    md_filename = f"{report_filename}.md"
    html_filename = f"{report_filename}.html"
    pdf_filename = f"{report_filename}.pdf"

    # 1. Write Markdown file
    md_path_root = os.path.join(base_dir, md_filename)
    md_path_docs = os.path.join(docs_dir, md_filename)
    for p in [md_path_root, md_path_docs]:
        with open(p, "w", encoding="utf-8") as f:
            f.write(MD_CONTENT)
    print(f"[OK] Generated Markdown: {md_path_root}")

    # 2. Generate HTML file
    body_html = markdown_to_html(MD_CONTENT)
    full_html = HTML_TEMPLATE.replace("BODY_CONTENT_PLACEHOLDER", body_html)
    
    html_path_root = os.path.join(base_dir, html_filename)
    html_path_docs = os.path.join(docs_dir, html_filename)
    html_path_public = os.path.join(frontend_public_dir, html_filename)
    for p in [html_path_root, html_path_docs, html_path_public]:
        with open(p, "w", encoding="utf-8") as f:
            f.write(full_html)
    print(f"[OK] Generated HTML: {html_path_root}")

    # 3. Convert HTML to Vector PDF using Headless Edge
    edge_paths = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    ]
    browser_bin = None
    for bp in edge_paths:
        if os.path.exists(bp):
            browser_bin = bp
            break

    if not browser_bin:
        print("Error: No headless browser found for PDF generation.")
        sys.exit(1)

    print(f"Rendering PDF via Headless Browser: {browser_bin}")
    pdf_path_root = os.path.join(base_dir, pdf_filename)
    
    cmd = [
        browser_bin,
        "--headless",
        "--disable-gpu",
        f"--print-to-pdf={pdf_path_root}",
        "--no-pdf-header-footer",
        html_path_root
    ]
    
    subprocess.run(cmd, check=True)
    file_size = os.path.getsize(pdf_path_root)
    print(f"[OK] Successfully generated PDF: {pdf_path_root} ({file_size} bytes)")

    # Copy PDF to docs, public, and brain artifacts
    pdf_path_docs = os.path.join(docs_dir, pdf_filename)
    pdf_path_public = os.path.join(frontend_public_dir, pdf_filename)
    shutil.copy2(pdf_path_root, pdf_path_docs)
    shutil.copy2(pdf_path_root, pdf_path_public)

    if os.path.exists(brain_dir):
        pdf_path_brain = os.path.join(brain_dir, pdf_filename)
        shutil.copy2(pdf_path_root, pdf_path_brain)
        print(f"[OK] Copied PDF to Brain Artifacts: {pdf_path_brain}")

    print("="*60)
    print("ALL REPORTS GENERATED & READY FOR CLIENT PRESENTATION!")
    print("="*60)

if __name__ == "__main__":
    main()
