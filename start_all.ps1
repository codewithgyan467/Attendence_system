Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  Launching Smart Hostel Attendance System (100% FOSS)  " -ForegroundColor Green
Write-Host "  [Folder 1: backend]  +  [Folder 2: frontend]          " -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Cyan

# 1. Backend (Starts Express + SQLite + Python OpenCV AI service)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend; npm.cmd start"

# 2. Frontend (React Vite UI)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend; npm.cmd run dev"

Write-Host "Both Backend and Frontend successfully launched!" -ForegroundColor Green
Write-Host "Open your browser at: http://localhost:3000" -ForegroundColor Yellow
