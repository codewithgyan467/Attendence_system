@echo off
setlocal enabledelayedexpansion
title ATTENDRA - Universal Enterprise Startup System
color 0B

echo ========================================================================
echo   ATTENDRA - PRESENCE POWERED BY INTELLIGENCE
echo   Universal Enterprise One-Click Launcher
echo ========================================================================
echo.
echo   [1] Production Server (Warden Mode - Offline Vault ^& Multi-Wi-Fi Roaming)
echo   [2] Developer Mode    (Vite Hot-Reload on 3000 + Backend on 5000)
echo   [3] Cloudflare Mode   (Production Server + Public Mobile Tunnel)
echo   [4] Stop All Running ATTENDRA Services
echo.
echo ========================================================================

:: Auto-default to Option 1 after 5 seconds if no key is pressed
choice /c 1234 /t 5 /d 1 /m "Select startup mode (1-4) or wait 5s for default [1]: "
set LAUNCH_MODE=%errorlevel%

if "%LAUNCH_MODE%"=="4" goto stop_services
if "%LAUNCH_MODE%"=="3" goto mode_cloudflare
if "%LAUNCH_MODE%"=="2" goto mode_dev
goto mode_production

:mode_production
cls
title ATTENDRA Production Server - Warden Mode
color 0A
echo ========================================================================
echo   STARTING ATTENDRA IN PRODUCTION MODE
echo   Offline SQLite Vault ^& Multi-Router Wi-Fi Roaming
echo ========================================================================
echo.

set NODE_ENV=production
set UVICORN_WORKERS=1
set PORT=5000
set OMP_NUM_THREADS=2
set MKL_NUM_THREADS=2
set OPENBLAS_NUM_THREADS=2
set NUMEXPR_NUM_THREADS=2
set NODE_OPTIONS=--max-old-space-size=1024
set STRICT_LOCK_LOCAL=true

:: 1. Windows Firewall Setup for Port 5000 (TCP API) and Port 45678 (UDP LAN Auto-Discovery)
echo [1/4] Configuring Windows Firewall for Local LAN Access (Ports 5000 TCP / 45678 UDP)...
set NEED_FW_ADMIN=0
netsh advfirewall firewall show rule name="ATTENDRA Warden Backend (Port 5000)" >nul 2>nul
if %errorlevel% neq 0 set NEED_FW_ADMIN=1
netsh advfirewall firewall show rule name="ATTENDRA LAN Discovery (UDP 45678)" >nul 2>nul
if %errorlevel% neq 0 set NEED_FW_ADMIN=1

if "%NEED_FW_ADMIN%"=="1" (
    net session >nul 2>&1
    if !errorlevel! equ 0 (
        netsh advfirewall firewall add rule name="ATTENDRA Warden Backend (Port 5000)" dir=in action=allow protocol=TCP localport=5000 profile=any >nul 2>nul
        netsh advfirewall firewall add rule name="ATTENDRA LAN Discovery (UDP 45678)" dir=in action=allow protocol=UDP localport=45678 profile=any >nul 2>nul
    ) else (
        echo [!] Requesting one-time Administrator permission to open Windows Firewall for LAN phones...
        powershell -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c netsh advfirewall firewall add rule name=\"ATTENDRA Warden Backend (Port 5000)\" dir=in action=allow protocol=TCP localport=5000 profile=any & netsh advfirewall firewall add rule name=\"ATTENDRA LAN Discovery (UDP 45678)\" dir=in action=allow protocol=UDP localport=45678 profile=any' -Verb RunAs -Wait" >nul 2>nul
    )
)
netsh advfirewall firewall show rule name="ATTENDRA Warden Backend (Port 5000)" >nul 2>nul
if %errorlevel% neq 0 (
    echo [WARNING] Windows Firewall rule for Port 5000 could not be verified. Run start.bat as Administrator once if phones cannot connect.
)

:: Ensure Port 8000 (Internal AI Microservice) is loopback only
netsh advfirewall firewall show rule name="HostelGuard AI Service (Port 8000)" >nul 2>nul
if %errorlevel% equ 0 (
    netsh advfirewall firewall delete rule name="HostelGuard AI Service (Port 8000)" >nul 2>nul
)

:: 2. Auto-Detect LAN IP
for /f "usebackq delims=" %%i in (`node -e "try { console.log(require('./backend/src/utils/wifiRoamingWatcher').getPrimaryLanIp()); } catch(e) { console.log('localhost'); }"`) do (
    set PRIMARY_LAN_IP=%%i
)
if "!PRIMARY_LAN_IP!"=="" set PRIMARY_LAN_IP=localhost

:: 3. Launch AI Liveness Microservice
echo [2/4] Starting AI Liveness Microservice (Port 8000)...
start "ATTENDRA AI Microservice" cmd /k "cd /d ""%~dp0backend\ai_service"" && if exist venv\Scripts\activate (call venv\Scripts\activate) && python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1"

:: 4. Ensure Web Portal is built
echo [3/4] Verifying Web Portal Assets...
if not exist "%~dp0frontend\dist\index.html" (
    echo Building optimized web bundle...
    cd /d "%~dp0frontend" && call npm.cmd run build
)

:: 5. Auto-Launch Browser
echo [4/4] Opening Web Portal in Browser...
start /b "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:5000"

echo.
echo ========================================================================
echo   ATTENDRA PRODUCTION SERVICES ACTIVE
echo ========================================================================
echo.
echo   [ACCESS URLS]
echo    * Warden Laptop Dashboard:  http://localhost:5000
echo    * Student Mobile Attendance: http://!PRIMARY_LAN_IP!:5000
echo.
echo   [ACTIVE NETWORK ADAPTERS]
node -e "try { require('./backend/src/utils/wifiRoamingWatcher').getAllActiveInterfaces().forEach(i => console.log('    * ' + i.name + ': http://' + i.ip + ':5000')); } catch(e) {}"
echo.
echo   [ROAMING WI-FI READY]
echo   The server dynamically adapts to IP changes every 5 seconds when
echo   switching between college Wi-Fi and floor router hotspots.
echo ========================================================================
echo.

cd /d "%~dp0backend"
:server_loop
echo [%date% %time%] Starting ATTENDRA Core Backend...
node src/server.js
echo [%date% %time%] WARNING: Backend process exited. Restarting in 3 seconds...
ping 127.0.0.1 -n 4 >nul 2>nul
goto server_loop

:mode_dev
cls
title ATTENDRA Developer Environment
color 0E
echo ========================================================================
echo   STARTING ATTENDRA IN DEVELOPER MODE (Vite Dev + Backend API + AI)
echo ========================================================================
echo.

echo 1. Launching AI Liveness Microservice (Port 8000)...
start "ATTENDRA AI Microservice" cmd /k "cd /d ""%~dp0backend\ai_service"" && if exist venv\Scripts\activate (call venv\Scripts\activate) && python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"

echo 2. Launching Core Backend API (Port 5000)...
start "ATTENDRA Backend API" cmd /k "cd /d ""%~dp0backend"" && npm.cmd start"

echo 3. Launching React Vite Dev Server (Port 3000)...
start "ATTENDRA Frontend Dev" cmd /k "cd /d ""%~dp0frontend"" && npm.cmd run dev"

echo.
echo Opening Developer Web Portal (https://localhost:3000)...
start /b "" cmd /c "timeout /t 4 /nobreak >nul && start https://localhost:3000"

echo ========================================================================
echo All development services launched in separate windows!
echo  - Frontend Web UI:  https://localhost:3000
echo  - Backend API:      http://localhost:5000/health
echo  - AI Microservice:  http://localhost:8000/health
echo ========================================================================
pause
exit /b 0

:mode_cloudflare
cls
title ATTENDRA Cloudflare Tunnel Mode
color 0D
echo ========================================================================
echo   STARTING ATTENDRA WITH SECURE CLOUDFLARE PUBLIC TUNNEL
echo ========================================================================
echo.

echo 1. Launching AI Microservice (Port 8000)...
start "ATTENDRA AI Microservice" cmd /k "cd /d ""%~dp0backend\ai_service"" && if exist venv\Scripts\activate (call venv\Scripts\activate) && python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1"

echo 2. Launching Backend ^& Production Web Hosting (Port 5000)...
start "ATTENDRA Backend Server" cmd /k "cd /d ""%~dp0backend"" && set NODE_ENV=production && set PORT=5000 && node src/server.js"

echo 3. Launching Cloudflare Tunnel for Remote Mobile ^& Bluefy Access...
start "ATTENDRA Cloudflare Tunnel" cmd /k "cd /d ""%~dp0"" && set TUNNEL_TARGET_URL=http://localhost:5000 && node scripts/auto_tunnel.js"

echo.
echo Opening Web Portal (http://localhost:5000)...
start /b "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:5000"

echo ========================================================================
echo Production server with Cloudflare tunnel launched!
echo Check the 'ATTENDRA Cloudflare Tunnel' window for your public HTTPS URL.
echo ========================================================================
pause
exit /b 0

:stop_services
cls
title Stopping ATTENDRA Services
color 0C
echo ========================================================================
echo   STOPPING ALL RUNNING ATTENDRA SERVICES
echo ========================================================================
echo.
echo Stopping Node.js processes...
taskkill /F /IM node.exe >nul 2>nul
echo Stopping Python / Uvicorn processes...
taskkill /F /IM python.exe >nul 2>nul
taskkill /F /IM cloudflared.exe >nul 2>nul
echo.
echo All ATTENDRA services have been stopped.
echo ========================================================================
ping 127.0.0.1 -n 3 >nul 2>nul
exit /b 0
