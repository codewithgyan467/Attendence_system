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
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend; npm.cmd start"

# 3. Start Frontend Client Portal
Write-Host "3. Starting Frontend Client Portal (React 18 + Vite)..." -ForegroundColor White
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend; npm.cmd run dev"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "HostelGuard Services Successfully Launched!" -ForegroundColor Green
Write-Host "Web Application: http://localhost:5173 (or http://localhost:3000)" -ForegroundColor Yellow
Write-Host "Backend API:     http://localhost:5000/health" -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Cyan
