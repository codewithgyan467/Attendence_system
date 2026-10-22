const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { runQuery, getQuery, allQuery } = require('../db/database');

/**
 * Generate cryptographically secure Master Recovery Key
 * Format: HG-MASTER-XXXX-XXXX-XXXX-XXXX (16 hex chars grouped in 4)
 */
function generateMasterKeyString() {
  const hex = crypto.randomBytes(8).toString('hex').toUpperCase();
  const chunks = hex.match(/.{1,4}/g);
  return `HG-MASTER-${chunks.join('-')}`;
}

/**
 * Create and register a new Master Recovery Key in the database
 * Automatically deactivates any existing keys.
 */
async function createMasterRecoveryKey() {
  const plainKey = generateMasterKeyString();
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(plainKey, salt);
  const hint = `...${plainKey.slice(-9)}`;

  // Deactivate prior active keys
  await runQuery(`UPDATE system_recovery_keys SET is_active = 0 WHERE is_active = 1`);

  const id = uuidv4();
  await runQuery(`
    INSERT INTO system_recovery_keys (id, key_hash, key_hint, is_active)
    VALUES (?, ?, ?, 1)
  `, [id, hash, hint]);

  return plainKey;
}

/**
 * Verify a candidate master recovery key against the active database keys
 * or the process.env.MASTER_RECOVERY_KEY environment variable.
 */
async function verifyMasterRecoveryKey(candidateKey) {
  if (!candidateKey || typeof candidateKey !== 'string') return false;
  const cleanKey = candidateKey.trim().toUpperCase();

  // 1. Check environment variable override if defined
  if (process.env.MASTER_RECOVERY_KEY && process.env.MASTER_RECOVERY_KEY.trim().toUpperCase() === cleanKey) {
    return { type: 'ENV_OVERRIDE', key_hint: 'ENV_KEY' };
  }

  // 2. Check active database keys
  const activeKeys = await allQuery(`
    SELECT * FROM system_recovery_keys
    WHERE is_active = 1
    ORDER BY created_at DESC
  `);

  for (const k of activeKeys) {
    const isMatch = await bcrypt.compare(cleanKey, k.key_hash);
    if (isMatch) {
      return k;
    }
  }

  return false;
}

/**
 * Retrieve current active key metadata (safe for UI, never returns full key)
 */
async function getActiveRecoveryKeyMetadata() {
  const activeKey = await getQuery(`
    SELECT id, key_hint, created_at, is_active
    FROM system_recovery_keys
    WHERE is_active = 1
    LIMIT 1
  `);

  return activeKey || null;
}

module.exports = {
  generateMasterKeyString,
  createMasterRecoveryKey,
  verifyMasterRecoveryKey,
  getActiveRecoveryKeyMetadata
};
