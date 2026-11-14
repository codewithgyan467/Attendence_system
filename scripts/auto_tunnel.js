/**
 * HostelGuard Enterprise - Automated Cloudflare Mobile & Bluefy Pipeline
 * Automatically launches cloudflared tunnel, extracts the live URL,
 * displays a scannable terminal QR code, and copies the URL to the clipboard.
 * Also surfaces the permanent Local Hostel Wi-Fi LAN address for zero-burden attendance.
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const rootDir = path.resolve(__dirname, '..');
const cloudflaredBin = path.join(rootDir, 'cloudflared.exe');
const tunnelUrlFile = path.join(rootDir, 'tunnel_url.txt');

// Load environment variables if available
const envFile = path.join(rootDir, 'backend', '.env');
if (fs.existsSync(envFile)) {
  const content = fs.readFileSync(envFile, 'utf-8');
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      const val = (match[2] || '').trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  });
}

// Load qrcode module from frontend dependencies if available
let QRCode = null;
try {
  QRCode = require(path.join(rootDir, 'frontend', 'node_modules', 'qrcode'));
} catch (_) {}

function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    if (/virtual|vethernet|docker|hyper-v|wsl|loopback/i.test(name)) continue;
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

function printBanner(cloudUrl) {
  const lanIp = getLanIp();
  const lanUrl = `https://${lanIp}:3000`;
  const bluefyLanUrl = `bluefy://open?url=${encodeURIComponent(lanUrl)}`;

  console.log('\n' + '='.repeat(76));
  console.log('🚀 HOSTELGUARD ENTERPRISE — PERMANENT ZERO-BURDEN ATTENDANCE PIPELINE');
  console.log('='.repeat(76));
  console.log(`\n📌 [RECOMMENDED FOR 400-500 STUDENTS] PERMANENT HOSTEL WI-FI URL:`);
  console.log(`   👉 Browser URL:  \x1b[32m\x1b[1m${lanUrl}\x1b[0m`);
  console.log(`   👉 iOS Bluefy:   \x1b[33m${bluefyLanUrl}\x1b[0m`);
  console.log(`   * Bookmark or print this ONE QR code! URL never changes.`);
  console.log(`   * Students pair Bluetooth ONCE on Day 1; subsequent check-ins auto-connect silently.\n`);

  if (cloudUrl) {
    const bluefyCloudUrl = `bluefy://open?url=${encodeURIComponent(cloudUrl)}`;
    console.log(`🌐 CLOUDFLARE MOBILE & BLUEFY TUNNEL URL:`);
    console.log(`   👉 Browser URL:  \x1b[36m\x1b[1m${cloudUrl}\x1b[0m`);
    console.log(`   👉 iOS Bluefy:   \x1b[33m${bluefyCloudUrl}\x1b[0m\n`);

    try {
      fs.writeFileSync(tunnelUrlFile, cloudUrl.trim(), 'utf-8');
      fs.writeFileSync(path.join(rootDir, 'bluefy_url.txt'), bluefyCloudUrl.trim(), 'utf-8');
    } catch (_) {}

    try {
      const proc = spawn('clip.exe', { stdio: ['pipe', 'ignore', 'ignore'] });
      proc.stdin.write(cloudUrl.trim());
      proc.stdin.end();
      console.log('📋 Copied live URL to clipboard! (Ctrl+V)');
    } catch (_) {}

    if (QRCode && typeof QRCode.toString === 'function') {
      QRCode.toString(cloudUrl, { type: 'terminal', small: true }, (err, qr) => {
        if (!err && qr) {
          console.log('\n📲 Scan with Phone Camera to open (or auto-redirect to Bluefy on iOS):');
          console.log(qr);
        }
        console.log('='.repeat(76) + '\n');
      });
    } else {
      console.log('='.repeat(76) + '\n');
    }
  } else {
    console.log('='.repeat(76) + '\n');
  }
}

async function ensureCloudflared() {
  if (fs.existsSync(cloudflaredBin)) return true;

  console.log('⏳ cloudflared.exe not found. Auto-downloading official Cloudflare binary...');
  try {
    const downloadCmd = `powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '${cloudflaredBin}'"`;
    execSync(downloadCmd, { stdio: 'inherit' });
    console.log('✅ cloudflared.exe downloaded successfully.');
    return true;
  } catch (err) {
    console.error('❌ Failed to download cloudflared.exe:', err.message);
    return false;
  }
}

async function startTunnel() {
  const customToken = process.env.CLOUDFLARE_TUNNEL_TOKEN || process.env.TUNNEL_TOKEN;

  if (customToken) {
    console.log('💎 Starting Permanent Cloudflare Named Tunnel with custom token...');
    const ready = await ensureCloudflared();
    if (!ready) process.exit(1);

    const child = spawn(cloudflaredBin, ['tunnel', 'run', '--token', customToken], { stdio: 'inherit' });
    child.on('close', (code) => {
      console.log(`\n⚠️ Permanent Tunnel exited with code ${code}. Reconnecting in 3s...`);
      setTimeout(startTunnel, 3000);
    });
    return;
  }

  const ready = await ensureCloudflared();
  if (!ready) {
    console.error('Cannot start tunnel without cloudflared.exe.');
    process.exit(1);
  }

  console.log('📡 Starting automated Cloudflare secure tunnel to https://localhost:3000...');

  const args = ['tunnel', '--url', 'https://localhost:3000', '--no-tls-verify'];
  const child = spawn(cloudflaredBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  let urlCaptured = false;

  const handleData = (chunk) => {
    const text = chunk.toString();
    if (!urlCaptured) {
      const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match) {
        urlCaptured = true;
        const liveUrl = match[0];
        printBanner(liveUrl);
      }
    }
  };

  child.stdout.on('data', handleData);
  child.stderr.on('data', handleData);

  child.on('close', (code) => {
    console.log(`\n⚠️ Tunnel process exited with code ${code}. Reconnecting in 3 seconds...`);
    setTimeout(startTunnel, 3000);
  });

  child.on('error', (err) => {
    console.error('❌ Tunnel error:', err.message);
  });
}

startTunnel();
