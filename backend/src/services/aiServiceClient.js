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
   */
  async extractEmbeddings(photos, allowSimulation = true) {
    try {
      const payload = {
        photos: photos.map((p, idx) => ({
          angle: p.angle || (idx === 0 ? 'FRONT' : idx === 1 ? 'LEFT' : 'RIGHT'),
          image_base64: p.imageBase64 || p
        })),
        allow_simulation_fallback: allowSimulation
      };

      const resp = await this.client.post('/api/v1/faces/extract-embeddings', payload);
      return resp.data;
    } catch (err) {
      const errorMsg = err.response?.data?.detail || err.message;
      throw new Error(`AI Microservice Extraction Error: ${errorMsg}`);
    }
  }

  /**
   * Verifies live face photo against stored embeddings.
   * Performs liveness anti-spoof check + Cosine similarity comparison.
   */
  async verifyLiveFace(liveImageBase64, storedEmbeddings, threshold = 0.65, allowSimulation = true) {
    try {
      const payload = {
        live_image_base64: liveImageBase64,
        stored_embeddings: storedEmbeddings,
        similarity_threshold: threshold,
        allow_simulation_fallback: allowSimulation
      };

      const resp = await this.client.post('/api/v1/faces/verify-live', payload);
      return resp.data;
    } catch (err) {
      const errorMsg = err.response?.data?.detail || err.message;
      throw new Error(`AI Microservice Verification Error: ${errorMsg}`);
    }
  }
}

module.exports = new AiServiceClient();
