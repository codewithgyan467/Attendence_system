Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  HostelGuard - Enterprise Production Startup System    " -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Cyan

# 1. Prerequisite Validation
Write-Host "1. Validating runtime prerequisites..." -ForegroundColor White
try {
    $nodeVer = node -v
    Write-Host "   Node.js runtime: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "   ERROR: Node.js is not installed or not in PATH." -ForegroundColor Red
    exit 1
}

# 2. Start Backend API & AI Microservice
Write-Host "2. Starting Backend Services (Node.js API + SQLite WAL + Python AI)..." -ForegroundColor White
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm.cmd start" -WorkingDirectory "$PSScriptRoot\backend"

# 3. Start Frontend Client Portal
Write-Host "3. Starting Frontend Client Portal (React 18 + Vite)..." -ForegroundColor White
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm.cmd run dev" -WorkingDirectory "$PSScriptRoot\frontend"

# 4. Start Automated Cloudflare Tunnel for Bluefy & Mobile
Write-Host "4. Starting Automated Cloudflare Tunnel for Bluefy & Mobile..." -ForegroundColor White
Start-Process powershell -ArgumentList "-NoExit", "-Command", "node scripts/auto_tunnel.js" -WorkingDirectory "$PSScriptRoot"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "HostelGuard Services Successfully Launched!" -ForegroundColor Green
Write-Host "Web Application: https://localhost:3000" -ForegroundColor Yellow
Write-Host "Backend API:     http://localhost:5000/health" -ForegroundColor Yellow
Write-Host "Mobile / Bluefy: Check the Automated Tunnel terminal window" -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Cyan
