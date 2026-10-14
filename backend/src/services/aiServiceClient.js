const axios = require('axios');

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';

class AiServiceClient {
  constructor(baseUrl = AI_SERVICE_URL) {
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  async checkHealth() {
    try {
      const resp = await this.client.get('/health');
      return { ok: true, data: resp.data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Sends multi-angle onboarding photos to Python AI service to generate 128D vectors.
   * Fail-Closed Security: Simulation fallback is strictly disabled in production.
   */
  async extractEmbeddings(photos, allowSimulation = null) {
    const isProduction = process.env.NODE_ENV === 'production';
    const effectiveSimulation = allowSimulation !== null ? allowSimulation : (!isProduction && process.env.AI_ALLOW_SIMULATION !== 'false');

    try {
      const payload = {
        photos: photos.map((p, idx) => ({
          angle: p.angle || (idx === 0 ? 'FRONT' : idx === 1 ? 'LEFT' : 'RIGHT'),
          image_base64: p.imageBase64 || p
        })),
        allow_simulation_fallback: effectiveSimulation
      };

      const resp = await this.client.post('/api/v1/faces/extract-embeddings', payload);
      return resp.data;
    } catch (err) {
      if (effectiveSimulation && (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED') || !err.response)) {
        return {
          success: true,
          embeddings: photos.map((p, idx) => ({
            angle: p.angle || (idx === 0 ? 'FRONT' : idx === 1 ? 'LEFT' : 'RIGHT'),
            embedding: Array(128).fill(0.088),
            confidence: 0.98,
            liveness_score: 0.99
          })),
          simulated: true
        };
      }
      const errorMsg = err.response?.data?.detail || err.message;
      throw new Error(`AI Microservice Extraction Error: ${errorMsg}`);
    }
  }

  /**
   * Verifies live face photo against stored embeddings.
   * Performs liveness anti-spoof check + Cosine similarity comparison.
   * Fail-Closed Security: Simulation fallback is strictly disabled in production.
   */
  async verifyLiveFace(liveImageBase64, storedEmbeddings, threshold = 0.65, allowSimulation = null) {
    const isProduction = process.env.NODE_ENV === 'production';
    const effectiveSimulation = allowSimulation !== null ? allowSimulation : (!isProduction && process.env.AI_ALLOW_SIMULATION !== 'false');

    try {
      const payload = {
        live_image_base64: liveImageBase64,
        stored_embeddings: storedEmbeddings,
        similarity_threshold: threshold,
        allow_simulation_fallback: effectiveSimulation
      };

      const resp = await this.client.post('/api/v1/faces/verify-live', payload);
      return resp.data;
    } catch (err) {
      if (effectiveSimulation && (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED') || !err.response)) {
        return {
          is_live: true,
          is_match: true,
          similarity_score: 0.92,
          liveness_score: 0.95,
          simulated: true,
          details: { message: 'Test-mode fallback simulation' }
        };
      }
      const errorMsg = err.response?.data?.detail || err.message;
      throw new Error(`AI Microservice Verification Error: ${errorMsg}`);
    }
  }
}

module.exports = new AiServiceClient();
