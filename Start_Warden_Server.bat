@echo off
setlocal enabledelayedexpansion
title HostelGuard Enterprise - Multi-Router Roaming Warden Server
color 0A

echo ===================================================
echo   STARTING HOSTELGUARD PRODUCTION SERVICES
echo   Multi-Floor Wi-Fi Roaming ^& LAN Auto-Discovery
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

:: 1. Permanent Windows Firewall Inbound Rules across ALL Network Profiles (Public, Private, Domain)
echo [i] Configuring Windows Firewall for Ports 5000 (Backend) and 8000 (AI Microservice)...
netsh advfirewall firewall show rule name="HostelGuard Warden Backend (Port 5000)" >nul 2>nul
if %errorlevel% neq 0 (
    netsh advfirewall firewall add rule name="HostelGuard Warden Backend (Port 5000)" dir=in action=allow protocol=TCP localport=5000 profile=any >nul 2>nul
) else (
    netsh advfirewall firewall set rule name="HostelGuard Warden Backend (Port 5000)" new profile=any >nul 2>nul
)

netsh advfirewall firewall show rule name="HostelGuard AI Service (Port 8000)" >nul 2>nul
if %errorlevel% neq 0 (
    netsh advfirewall firewall add rule name="HostelGuard AI Service (Port 8000)" dir=in action=allow protocol=TCP localport=8000 profile=any >nul 2>nul
) else (
    netsh advfirewall firewall set rule name="HostelGuard AI Service (Port 8000)" new profile=any >nul 2>nul
)

:: 2. Auto-Detect Primary Wi-Fi / Hotspot LAN IPv4 Address
for /f "usebackq delims=" %%i in (`node -e "console.log(require('./backend/src/utils/wifiRoamingWatcher').getPrimaryLanIp());"`) do (
    set PRIMARY_LAN_IP=%%i
)
if "!PRIMARY_LAN_IP!"=="" set PRIMARY_LAN_IP=localhost

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

echo.
echo ================================================================================
echo   HOSTELGUARD ENTERPRISE - MULTI-ROUTER ROAMING WARDEN SERVER
echo   Institutional Physical Presence Architecture ^& Offline Vault
echo ================================================================================
echo.
echo   [ACTIVE NETWORK ADAPTERS]
node -e "require('./backend/src/utils/wifiRoamingWatcher').getAllActiveInterfaces().forEach(i => console.log('    * ' + i.name + ': http://' + i.ip + ':5000'));"
echo.
echo   [PRIMARY ACCESS URLS]
echo    - Warden Laptop Admin:    http://localhost:5000
echo    - Student Wi-Fi Check-In: http://!PRIMARY_LAN_IP!:5000
echo.
echo   [DYNAMIC WI-FI ROAMING]
echo    Warden can move between the 4 floor Wi-Fi routers or phone hotspots anytime.
echo    The server continuously detects IP changes every 5 seconds without restarting.
echo ================================================================================
echo.

echo [2/2] Starting Main Warden Server...
cd /d "%~dp0backend"

:server_loop
echo [%date% %time%] Starting Node.js Backend...
node src/server.js
echo [%date% %time%] WARNING: Server process exited. Restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto server_loop
