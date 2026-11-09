@echo off
setlocal enabledelayedexpansion
title HostelGuard - Warden Strict Lock Local Server

:: 0. Check Node.js Prerequisite
where node >nul 2>nul
if %errorlevel% equ 0 goto :node_ok
echo ================================================================================
echo  [ERROR] Node.js is not installed on this computer!
echo ================================================================================
echo  HostelGuard Warden Server requires Node.js v18 or higher.
echo  Please download and install Node.js from https://nodejs.org
echo  After installing, double-click Start_Warden_Server.bat again.
echo ================================================================================
echo.
pause
exit /b 1
:node_ok

:: 1. Force Low-Spec CPU Thread Limits (Prevent Dual-Core CPU Freezes)
set OMP_NUM_THREADS=2
set MKL_NUM_THREADS=2
set OPENBLAS_NUM_THREADS=2
set NUMEXPR_NUM_THREADS=2
set NODE_OPTIONS=--max-old-space-size=1024
set STRICT_LOCK_LOCAL=true
set PORT=5000

:: 2. Auto-Initialize Environment Configuration if Missing
if not exist "backend\.env" (
    if exist "backend\.env.example" (
        echo [i] Generating backend configuration from template...
        copy "backend\.env.example" "backend\.env" >nul
    )
)

:: 3. Auto-Install Dependencies if node_modules is Missing
if not exist "backend\node_modules\" (
    echo [i] First-time setup: Installing backend server dependencies...
    cd backend && call npm.cmd install --omit=dev && cd ..
    echo [i] Dependencies successfully installed!
)

:: 4. Try Opening Windows Firewall for Port 5000 (Succeeds if Run as Admin)
netsh advfirewall firewall show rule name="HostelGuard Warden Server" >nul 2>nul
if %errorlevel% neq 0 (
    netsh advfirewall firewall add rule name="HostelGuard Warden Server" dir=in action=allow protocol=TCP localport=5000 >nul 2>nul
)

:: 5. Auto-Detect Local Wi-Fi / Ethernet LAN IP Address
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
    set LAN_IP=%%a
    set LAN_IP=!LAN_IP: =!
    goto :ip_found
)
:ip_found
if "%LAN_IP%"=="" set LAN_IP=localhost

:: 6. Display Warden Operational Console Banner
cls
echo ================================================================================
echo    HOSTELGUARD v4.2 - WARDEN STRICT LOCK LOCALHOST SERVER
echo    Institutional Physical Presence Architecture ^& Offline Vault
echo ================================================================================
echo.
echo  [SYSTEM PROFILE]
echo   - Mode:              STRICT LOCK (Offline Hostel Wi-Fi LAN-Only)
echo   - Target Hardware:   Dual-Core Intel i3 / Celeron, 4GB-8GB RAM
echo   - CPU Thread Limit:  2 Cores (Zero-Freeze / Zero-Lag Guarantee)
echo   - Memory Cap:        1024 MB RAM
echo   - Local Vault:       backend\data\strict_local.db (SQLite WAL + RAM Vector Cache)
echo.
echo  [ACCESS URLS]
echo   - Warden Laptop Admin:  http://localhost:5000
echo   - Student Wi-Fi Check-In: http://!LAN_IP!:5000
echo   - Tip: If using Mobile Hotspot, connect phone to laptop hotspot (http://192.168.137.1:5000)
echo.
echo ================================================================================
echo  OPERATIONAL CHECKLIST FOR WARDEN:
echo   [1] Connect this laptop to the floor Hostel Wi-Fi router.
echo   [2] Ensure floor ESP32 BLE anchor (HG-BEACON) is powered ON.
echo   [3] Students must be connected to the Hostel Wi-Fi router.
echo   [4] Students open http://!LAN_IP!:5000 in Chrome (Android) or Bluefy (iOS).
echo   [5] When roll-call ends, click 'Push and Sync Local Vault to Cloud DB' in Admin.
echo ================================================================================
echo.

:: 7. Ensure optimized production web portal is compiled
if not exist "frontend\dist\index.html" (
    echo [i] First-time setup: Building optimized web portal for local hosting...
    cd frontend && call npm.cmd run build && cd ..
    echo [i] Production build ready!
)

:: 8. Launch Browser after 2.5 seconds in background
start /b "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:5000"

:: 9. Launch Backend Server (Auto-spawns Python AI microservice)
cd backend
echo [i] Starting HostelGuard Core Server on http://0.0.0.0:5000 ...
node src/server.js

pause

