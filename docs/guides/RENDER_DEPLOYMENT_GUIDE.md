# 🚀 1-Click Hosting Guide for Render.com

This guide explains how to deploy **HostelGuard Enterprise** on [Render.com](https://render.com) for 100% free hosting.

---

## 🏗️ What Gets Deployed on Render

| Service | Type | URL Example | What It Does |
|---|---|---|---|
| **`hostelguard-backend`** | Web Service (Docker) | `https://hostel-api.onrender.com` | Express REST API, SQLite WAL Database, Python OpenCV YuNet & SFace Microservice |
| **`hostelguard-frontend`** | Static Site | `https://hostel-portal.onrender.com` | React Web Admin & Warden Portal for Desktop browsers |
| **Android Mobile App** | Native APK | Installed on Phones | Connects to `hostelguard-backend` over HTTPS from any mobile network |

---

## 📋 Step-by-Step Deployment (5 Minutes)

### Step 1: Sign In to Render
1. Go to [**render.com**](https://render.com) and click **Get Started** or **Sign In**.
2. Select **Sign in with GitHub** (use your GitHub account `codewithgyan467`).

---

### Step 2: Deploy Using Blueprint (Automatic)
Render includes a **Blueprint** feature that reads our pre-configured [`render.yaml`](file:///e:/attendence_Hostel_system/render.yaml) file to set up both services at once:

1. On the Render Dashboard, click the blue **New +** button in the top right.
2. Select **Blueprint**.
3. Choose your repository: **`codewithgyan467/Attendence_system`**.
4. Render will show the plan:
   - `hostelguard-backend` (Docker, Free Plan)
   - `hostelguard-frontend` (Static Site, Free Plan)
5. Click **Apply**.
6. Render will start building both services automatically! ☕

---

### Step 3: Get Your Live Backend URL
1. Once `hostelguard-backend` finishes deploying (usually takes 2-3 minutes), copy its live URL from the top of the page:
   ```
   https://hostelguard-backend-xxxx.onrender.com
   ```
2. Test that it is alive by opening `https://hostelguard-backend-xxxx.onrender.com/health` in your browser. You should see:
   ```json
   {
     "status": "healthy",
     "service": "Smart Hostel Attendance Enterprise Core"
   }
   ```

---

### Step 4: Connect the Frontend Web Portal
1. On the Render Dashboard, click your **`hostelguard-frontend`** service.
2. Go to **Environment** tab on the left.
3. Click **Add Environment Variable**:
   - **Key**: `VITE_API_BASE_URL`
   - **Value**: `https://hostelguard-backend-xxxx.onrender.com/api/v1`
4. Click **Save Changes** (Render will automatically re-deploy the frontend in 30 seconds).

---

### Step 5: Connect Your Android Mobile App

You have two easy ways to connect your Android APK to the Render backend:

#### Option A: Direct from the App (Instant - No Recompiling)
1. Open the **HostelGuard** app on your Android phone.
2. On the login screen, tap the **"⚙️ Server"** link at the bottom.
3. Enter your live Render URL:
   ```
   https://hostelguard-backend-xxxx.onrender.com/api/v1
   ```
4. Tap **Save**. You can now log in from any phone anywhere in the world!

#### Option B: Bake It In for All Future APKs
1. In your local project, create `frontend/.env.production`:
   ```env
   VITE_API_BASE_URL=https://hostelguard-backend-xxxx.onrender.com/api/v1
   ```
2. Push to GitHub (`git add . && git commit -m "chore: set production backend url" && git push origin main`).
3. GitHub Actions will automatically compile a new APK where every user connects to your Render backend by default!

---

## 🔒 Security & CORS Notes
- The backend is configured to accept CORS requests from your Render frontend, mobile apps, and local testing environments.
- Rate limiting is active on Render to protect your backend against brute-force attempts.
- Health checks run every 5 minutes to keep services responsive.
