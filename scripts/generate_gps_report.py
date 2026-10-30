# -*- coding: utf-8 -*-
"""
HostelGuard Enterprise v3.0 - GPS, Geofence & Anti-Spoofing Report Generator
Generates standalone printable HTML (.html) and vector PDF (.pdf)
"""

import os
import subprocess

def generate_pdf():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    reports_dir = os.path.join(project_root, "docs", "reports")
    os.makedirs(reports_dir, exist_ok=True)

    md_path = os.path.join(reports_dir, "GPS_GEOFENCE_ANTI_SPOOFING_WORKFLOW_REPORT.md")
    html_path = os.path.join(reports_dir, "GPS_GEOFENCE_ANTI_SPOOFING_WORKFLOW_REPORT.html")
    pdf_path = os.path.join(reports_dir, "GPS_GEOFENCE_ANTI_SPOOFING_WORKFLOW_REPORT.pdf")

    if not os.path.exists(md_path):
        print(f"Error: {md_path} not found.")
        return

    with open(md_path, "r", encoding="utf-8") as f:
        md_content = f.read()

    encoded_md = md_content.replace("`", r"\`").replace("${", r"\${")

    html_page = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HostelGuard Enterprise v3.0 - GPS, Geofence & Anti-Spoofing Technical Report</title>
<!-- Marked for Markdown rendering -->
<script src="https://cdn.jsdelivr.net/npm/marked@11.1.1/marked.min.js"></script>
<!-- KaTeX for LaTeX Math -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/contrib/auto-render.min.js"></script>
<!-- Mermaid for Diagrams -->
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<style>
  :root {{
    --primary: #0284c7;
    --primary-dark: #0369a1;
    --primary-light: #f0f9ff;
    --text-main: #0f172a;
    --text-muted: #64748b;
    --border: #e2e8f0;
    --bg-page: #f8fafc;
    --bg-card: #ffffff;
  }}
  * {{ box-sizing: border-box; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: var(--text-main);
    background-color: var(--bg-page);
    line-height: 1.65;
    margin: 0;
    padding: 0;
  }}
  .container {{
    max-width: 1040px;
    margin: 40px auto;
    background: var(--bg-card);
    padding: 48px 60px;
    border-radius: 12px;
    box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.05);
    border: 1px solid var(--border);
  }}
  .header-box {{
    border-bottom: 2px solid var(--border);
    padding-bottom: 24px;
    margin-bottom: 32px;
  }}
  h1 {{
    font-size: 2.1rem;
    color: #0f172a;
    margin-top: 0;
    line-height: 1.25;
  }}
  h2 {{
    font-size: 1.45rem;
    color: #0369a1;
    border-left: 4px solid var(--primary);
    padding-left: 12px;
    margin-top: 40px;
    margin-bottom: 16px;
  }}
  h3 {{
    font-size: 1.15rem;
    color: #334155;
    margin-top: 24px;
    margin-bottom: 12px;
  }}
  p {{ margin: 12px 0; }}
  pre {{
    background: #0f172a;
    color: #e2e8f0;
    padding: 16px 20px;
    border-radius: 8px;
    overflow-x: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.9rem;
    border: 1px solid #334155;
  }}
  code {{
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    background: #f1f5f9;
    color: #0f172a;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.88em;
  }}
  pre code {{
    background: transparent;
    color: inherit;
    padding: 0;
  }}
  table {{
    width: 100%;
    border-collapse: collapse;
    margin: 20px 0;
    font-size: 0.95rem;
  }}
  th, td {{
    padding: 12px 14px;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }}
  th {{
    background: #f8fafc;
    color: #334155;
    font-weight: 600;
  }}
  tr:hover {{ background-color: #f1f5f9; }}
  .mermaid {{
    text-align: center;
    margin: 28px 0;
    background: white;
    padding: 20px;
    border-radius: 8px;
    border: 1px solid var(--border);
  }}
  @media print {{
    .container {{
      box-shadow: none;
      border: none;
      margin: 0;
      padding: 0;
      max-width: 100%;
    }}
    body {{ background: white; }}
    h2 {{ page-break-before: auto; }}
    pre, table {{ page-break-inside: avoid; }}
  }}
</style>
</head>
<body>

<div class="container">
  <div id="report-content"></div>
</div>

<script>
  const rawMarkdown = `{encoded_md}`;
  
  const renderer = new marked.Renderer();
  const origCode = renderer.code.bind(renderer);
  renderer.code = function(code, language) {{
    if (language === 'mermaid') {{
      return '<div class="mermaid">' + code + '</div>';
    }}
    return origCode(code, language);
  }};

  marked.setOptions({{
    renderer: renderer,
    gfm: true,
    breaks: false
  }});

  document.getElementById('report-content').innerHTML = marked.parse(rawMarkdown);

  if (typeof renderMathInElement === 'function') {{
    renderMathInElement(document.getElementById('report-content'), {{
      delimiters: [
        {{left: '$$', right: '$$', display: true}},
        {{left: '$', right: '$', display: false}},
        {{left: '\\\\(', right: '\\\\)', display: false}},
        {{left: '\\\\[', right: '\\\\]', display: true}}
      ]
    }});
  }}

  if (typeof mermaid !== 'undefined') {{
    mermaid.initialize({{ startOnLoad: true, theme: 'neutral' }});
  }}
</script>
</body>
</html>
"""

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_page)
    print(f"Generated HTML: {html_path}")

    # Generate PDF using Edge or Chrome Headless
    browser_exe = None
    edge_paths = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    ]
    chrome_paths = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    ]

    for p in edge_paths + chrome_paths:
        if os.path.exists(p):
            browser_exe = p
            break

    if browser_exe:
        print(f"Rendering PDF via Headless Browser: {browser_exe}")
        try:
            cmd = [
                browser_exe,
                "--headless=new",
                "--disable-gpu",
                "--no-pdf-header-footer",
                f"--print-to-pdf={pdf_path}",
                f"file:///{html_path.replace(os.sep, '/')}"
            ]
            subprocess.run(cmd, check=True, timeout=30)
            if os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 1000:
                print(f"Successfully generated PDF: {pdf_path} ({os.path.getsize(pdf_path)} bytes)")
        except Exception as e:
            print(f"Notice during PDF generation: {e}")

if __name__ == "__main__":
    generate_pdf()

