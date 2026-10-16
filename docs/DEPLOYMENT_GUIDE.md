# HostelGuard Enterprise: Production Deployment Guide

This guide details deployment options for production environments, including Docker Compose, cloud container platforms (Render, Railway, Fly.io), and self-hosted Linux VPS instances (Ubuntu/Debian).

---

## 1. System Requirements

* **Node.js**: `v20.x` or higher (LTS recommended)
* **Python**: `3.10` or higher (for OpenCV YuNet & SFace microservice)
* **Memory**: Minimum 1 GB RAM (2 GB recommended for concurrent OpenCV facial feature extraction)
* **Disk**: 500 MB for application code + models, plus storage for SQLite database and backups
* **Ports**:
  * Core Backend: `5000` (configurable via `PORT`)
  * AI Microservice: `8000` (internal loopback communication)
  * Frontend: Built into static assets served via backend or CDN (e.g. Nginx, Cloudflare)

---

## 2. Environment Configuration

Create a `.env` file in the `backend/` directory:

```env
# Server Configuration
PORT=5000
NODE_ENV=production
ALLOWED_ORIGINS=https://yourhostelportal.edu,capacitor://localhost

# JWT Cryptographic Secrets
JWT_SECRET=replace_with_a_secure_random_64_character_hex_string
JWT_REFRESH_SECRET=replace_with_another_secure_64_character_hex_string

# Biometric & AI Microservice Bridge
AI_SERVICE_URL=http://localhost:8000

# Turso Cloud SQLite (Optional - omit to use local SQLite WAL)
# TURSO_DATABASE_URL=libsql://your-database-name.turso.io
# TURSO_AUTH_TOKEN=your-turso-auth-token

# Email & SMS Notification Service (Optional - logs to console if omitted)
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_USER=hostel.admin@yourcollege.edu
# SMTP_PASS=your-app-password
```

---

## 3. Deployment Option A: Self-Hosted Linux VPS (Ubuntu)

### 3.1. Install System Dependencies
```bash
sudo apt update && sudo apt install -y nodejs npm python3 python3-pip python3-venv git nginx
```

### 3.2. Clone & Build
```bash
git clone https://github.com/codewithgyan467/Attendence_system.git /var/www/hostelguard
cd /var/www/hostelguard

# 1. Setup Backend & AI Microservice
cd backend
npm ci --production
cd ai_service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python download_models.py
deactivate

# 2. Build Frontend Production Assets
cd ../../frontend
npm ci
npm run build
```

### 3.3. Process Management (PM2)
```bash
npm install -g pm2

# Start Python AI Microservice
cd /var/www/hostelguard/backend/ai_service
pm2 start "venv/bin/python run.py" --name "hostelguard-ai"

# Start Node.js Express Core
cd /var/www/hostelguard/backend
pm2 start src/server.js --name "hostelguard-backend"

pm2 save
pm2 startup
```

---

## 4. Deployment Option B: Docker Compose

The repository includes a ready-to-run multi-stage `docker-compose.yml`:

```bash
# Build and start all services in detached mode
docker-compose up -d --build

# View real-time logs
docker-compose logs -f
```

---

## 5. Deployment Option C: Render Cloud Platform

1. Fork or push the repository to your GitHub account.
2. Link your repository to Render using the included `render.yaml` blueprint.
3. Configure environment variables in the Render dashboard.
4. Render will automatically build the frontend assets, start the Python AI microservice, and launch the Node.js Express server.
