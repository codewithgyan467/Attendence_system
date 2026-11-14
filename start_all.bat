@echo off
echo ========================================================
echo   HostelGuard - Enterprise Production Startup System
echo ========================================================

echo 1. Launching AI Liveness Microservice (OpenCV + MiniFASNet + SFace)...
start "HostelGuard AI Service" cmd /k "cd /d ""%~dp0backend\ai_service"" && if exist venv\Scripts\activate (call venv\Scripts\activate) && python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"

echo 2. Launching Backend Services (Node.js API + Turso Cloud SQLite)...
start "HostelGuard Backend" cmd /k "cd /d ""%~dp0backend"" && npm start"

echo 3. Launching Frontend Portal (React 18 + Vite PWA)...
start "HostelGuard Frontend" cmd /k "cd /d ""%~dp0frontend"" && npm run dev"

echo 4. Launching Automated Cloudflare Mobile and Bluefy Tunnel...
start "HostelGuard Mobile and Bluefy Tunnel" cmd /k "cd /d ""%~dp0"" && node scripts/auto_tunnel.js"

echo.
echo ========================================================
echo All services launched!
echo - Web Portal (Local):  https://localhost:3000
echo - Backend API Health:  http://localhost:5000/health
echo - Mobile / Bluefy URL: Check the 'HostelGuard Mobile' terminal window
echo ========================================================
