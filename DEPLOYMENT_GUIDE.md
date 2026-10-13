# Client Production Deployment Guide: HostelGuard Enterprise

## 1. System Prerequisites

- **Operating System**: Windows 10/11 / Windows Server 2022 or Linux (Ubuntu 22.04 LTS / Debian 12).
- **Node.js**: v18.x or v20.x LTS.
- **Python**: 3.10+ with OpenCV (`opencv-python-headless`) and FastAPI.
- **Port Allocations**:
  - Frontend Web UI: `3000` (or `80`/`443` behind Nginx/Caddy)
  - Core Backend API: `5000`
  - Python AI Vision Microservice: `8000` (Internal only, not exposed to internet)

---

## 2. Windows Local & Server Deployment

### Step 1: Environment Configuration
Create `backend/.env` based on `backend/.env.example`:
```env
PORT=5000
NODE_ENV=production
JWT_SECRET=your_super_strong_cryptographic_secret_key_minimum_32_chars
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
AI_SERVICE_URL=http://localhost:8000
AI_TIMEOUT_MS=5000
SIMULATION_MODE=false
```

### Step 2: Install Dependencies & Build Frontend
```powershell
# 1. Backend Dependencies
cd backend
npm.cmd install

# 2. Frontend Build
cd ../frontend
npm.cmd install
npm.cmd run build
```

### Step 3: Launching Services
Run the launcher:
```powershell
.\start_all.bat
# or in PowerShell:
.\start_all.ps1
```

---

## 3. Production Reverse Proxy Configuration (Nginx Example)

```nginx
server {
    listen 80;
    server_name hostel.yourcollege.edu;

    # Frontend Static Distribution
    location / {
        root /var/www/hostelguard/frontend/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # API Proxy
    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health Check
    location /health {
        proxy_pass http://127.0.0.1:5000/health;
    }
}
```

> [!WARNING]
> Never expose the Python AI Microservice (port 8000) or the raw SQLite database file directly to the public internet. All traffic must pass through the Node.js API with JWT authentication.
