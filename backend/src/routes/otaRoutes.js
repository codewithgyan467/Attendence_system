const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { requireAuth, requireRole } = require('../middleware/auth');

// Path to locally stored OTA release manifest and zip bundle
const OTA_DIR = path.join(__dirname, '../../data/ota');
const MANIFEST_PATH = path.join(OTA_DIR, 'manifest.json');
const BUNDLE_PATH = path.join(OTA_DIR, 'bundle.zip');

// Ensure storage directory exists
if (!fs.existsSync(OTA_DIR)) {
  fs.mkdirSync(OTA_DIR, { recursive: true });
}

// Initial default manifest if not present
if (!fs.existsSync(MANIFEST_PATH)) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify({
    version: '1.0.0',
    mandatory: false,
    releaseDate: new Date().toISOString(),
    releaseNotes: 'Initial production build with native biometric and GPS support.'
  }, null, 2));
}

/**
 * GET /api/v1/ota/latest
 * Public endpoint queried by mobile apps on startup to check for OTA web updates.
 */
router.get('/latest', (req, res) => {
  try {
    if (!fs.existsSync(MANIFEST_PATH)) {
      return res.json({
        available: false,
        version: '1.0.0'
      });
    }

    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const host = req.get('host');
    const protocol = req.protocol;
    const hasBundle = fs.existsSync(BUNDLE_PATH);

    res.json({
      success: true,
      available: hasBundle,
      version: manifest.version,
      mandatory: manifest.mandatory || false,
      releaseDate: manifest.releaseDate,
      releaseNotes: manifest.releaseNotes,
      downloadUrl: hasBundle ? `${protocol}://${host}/api/v1/ota/bundle.zip` : null
    });
  } catch (err) {
    console.error('OTA latest check error:', err);
    res.status(500).json({ error: 'Failed to retrieve OTA manifest' });
  }
});

/**
 * GET /api/v1/ota/bundle.zip
 * Public download of the active OTA zip bundle for Capgo updater.
 */
router.get('/bundle.zip', (req, res) => {
  if (!fs.existsSync(BUNDLE_PATH)) {
    return res.status(404).json({ error: 'No OTA bundle currently deployed.' });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="bundle.zip"');
  fs.createReadStream(BUNDLE_PATH).pipe(res);
});

/**
 * POST /api/v1/ota/publish
 * Admin-only endpoint to register a new OTA version
 */
router.post('/publish', requireAuth, requireRole('ADMIN'), (req, res) => {
  try {
    const { version, releaseNotes, mandatory } = req.body;
    if (!version) {
      return res.status(400).json({ error: 'Version string is required (e.g. "1.0.1")' });
    }

    const newManifest = {
      version,
      mandatory: Boolean(mandatory),
      releaseDate: new Date().toISOString(),
      releaseNotes: releaseNotes || 'Live web bundle update'
    };

    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(newManifest, null, 2));
    res.json({ success: true, message: 'OTA manifest updated', manifest: newManifest });
  } catch (err) {
    console.error('OTA publish error:', err);
    res.status(500).json({ error: 'Failed to publish OTA update' });
  }
});

module.exports = router;
