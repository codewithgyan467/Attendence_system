@echo off
setlocal enabledelayedexpansion
title HostelGuard Enterprise - Warden Production Server
color 0A

echo ===================================================
echo   STARTING HOSTELGUARD PRODUCTION SERVICES
echo ===================================================

set NODE_ENV=production
set UVICORN_WORKERS=2
set PORT=5000
set OMP_NUM_THREADS=2
set MKL_NUM_THREADS=2
set OPENBLAS_NUM_THREADS=2
set NUMEXPR_NUM_THREADS=2
set NODE_OPTIONS=--max-old-space-size=1024
set STRICT_LOCK_LOCAL=true

:: 1. Auto-Detect Local Wi-Fi / Ethernet LAN IP Address
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
    set LAN_IP=%%a
    set LAN_IP=!LAN_IP: =!
    goto :ip_found
)
:ip_found
if "%LAN_IP%"=="" set LAN_IP=localhost

:: 2. Try Opening Windows Firewall for Port 5000 (if run as Admin)
netsh advfirewall firewall show rule name="HostelGuard Warden Server" >nul 2>nul
if %errorlevel% neq 0 (
    netsh advfirewall firewall add rule name="HostelGuard Warden Server" dir=in action=allow protocol=TCP localport=5000 >nul 2>nul
)

:: 3. Launch AI Liveness Microservice (FastAPI + OpenCV + MiniFASNet)
echo [1/2] Starting AI Liveness Microservice...
start "HostelGuard-AI-Engine" cmd /k "cd /d %~dp0backend\ai_service && if exist venv\Scripts\activate (call venv\Scripts\activate) && python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2"

timeout /t 5 /nobreak >nul

:: 4. Ensure production frontend bundle is compiled
if not exist "%~dp0frontend\dist\index.html" (
    echo [i] Building optimized web portal for local hosting...
    cd /d "%~dp0frontend" && call npm.cmd run build
)

:: 5. Launch Browser after 3 seconds in background
start /b "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:5000"

echo ================================================================================
echo   HOSTELGUARD ENTERPRISE - MULTI-FLOOR PRODUCTION SERVER
echo   Institutional Physical Presence Architecture ^& Offline Vault
echo ================================================================================
echo.
echo   [ACCESS URLS]
echo    - Warden Laptop Admin:    http://localhost:5000
echo    - Student Wi-Fi Check-In: http://!LAN_IP!:5000
echo.
echo ================================================================================

echo [2/2] Starting Main Warden Server...
cd /d "%~dp0backend"

:server_loop
echo [%date% %time%] Starting Node.js Backend...
node src/server.js
echo [%date% %time%] WARNING: Server process exited. Restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto server_loop
