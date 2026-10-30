/**
 * In-Memory Biometric Embedding Cache with Automatic Invalidation
 * Dramatically accelerates hot Phase 2 attendance verification by eliminating
 * SQLite disk queries and JSON vector deserialization overhead.
 */
class EmbeddingCache {
  constructor() {
    this.cache = new Map(); // studentId -> Array of 128-D float arrays
  }

  get(studentId) {
    if (!studentId) return null;
    return this.cache.get(studentId) || null;
  }

  set(studentId, embeddings) {
    if (!studentId || !Array.isArray(embeddings)) return;
    this.cache.set(studentId, embeddings);
  }

  invalidate(studentId = null) {
    if (studentId) {
      this.cache.delete(studentId);
    } else {
      this.cache.clear();
    }
  }

  size() {
    return this.cache.size;
  }
}

module.exports = new EmbeddingCache();

