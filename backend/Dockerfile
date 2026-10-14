FROM node:20-bookworm-slim

# Install Python 3 and required packages for OpenCV AI face recognition
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Setup Python virtual environment & install AI microservice dependencies
COPY ai_service/requirements.txt ./ai_service/
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir -r ai_service/requirements.txt

# Copy backend source code
COPY . .

# Pre-download OpenCV YuNet and SFace ONNX models into container image
RUN python3 ai_service/download_models.py

# Ensure SQLite storage and uploads directory exist
RUN mkdir -p data data/ota uploads

EXPOSE 5000

ENV PORT=5000
ENV NODE_ENV=production
ENV AI_SERVICE_URL=http://localhost:8000

CMD ["node", "src/server.js"]
