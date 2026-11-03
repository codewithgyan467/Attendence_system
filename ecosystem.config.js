module.exports = {
  apps: [
    {
      name: 'hostelguard-backend',
      script: './src/server.js',
      cwd: './backend',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
        AI_SERVICE_URL: 'http://127.0.0.1:8000',
        AI_SERVICE_SECRET: 'hg-internal-mesh-secret-2026'
      }
    },
    {
      name: 'hostelguard-ai-service',
      script: 'python',
      args: '-m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2',
      cwd: './backend/ai_service',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '800M',
      env: {
        PYTHONUNBUFFERED: '1',
        AI_SERVICE_SECRET: 'hg-internal-mesh-secret-2026',
        NODE_ENV: 'production'
      }
    }
  ]
};

