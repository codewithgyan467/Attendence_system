@echo off
echo ========================================================
echo   Launching Smart Hostel Attendance System (100%% FOSS)
echo   [Folder 1: backend]  +  [Folder 2: frontend]
echo ========================================================

echo 1. Starting Backend (Node.js API + SQLite + Python AI)...
start "Hostel Attendance Backend" cmd /k "cd backend && npm.cmd start"

echo 2. Starting Frontend (React Vite PWA)...
start "Hostel Attendance Frontend" cmd /k "cd frontend && npm.cmd run dev"

echo.
echo All services launched!
echo Access the web portal at: http://localhost:3000
