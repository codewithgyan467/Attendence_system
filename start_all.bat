@echo off
echo ========================================================
echo   HostelGuard - Enterprise Production Startup System
echo ========================================================

echo 1. Launching Backend Services (Node.js API + SQLite WAL + Python AI)...
start "HostelGuard Backend" cmd /k "cd backend && npm.cmd start"

echo 2. Launching Frontend Portal (React 18 + Vite PWA)...
start "HostelGuard Frontend" cmd /k "cd frontend && npm.cmd run dev"

echo.
echo All services launched!
echo Access the web portal at: http://localhost:5173 (or http://localhost:3000)
echo Backend API health:       http://localhost:5000/health
echo ========================================================
