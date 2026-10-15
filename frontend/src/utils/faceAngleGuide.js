/**
 * faceAngleGuide.js
 * Hands-Free Facial Angle Tracking, Head Pose Guidance & Web Audio Chimes
 * Designed for HostelGuard Enterprise Mobile Biometrics
 */

// -------------------------------------------------------------
// 1. Crystal-Clear Web Audio Chimes (No external audio files needed)
// -------------------------------------------------------------
export function playBiometricChime(type = 'captured') {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    if (type === 'captured') {
      // Crisp 2-tone success ding (D5 -> A5)
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.1); // A5

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.32);
    } else if (type === 'completed') {
      // Upbeat 3-tone celebration chord (C5 -> E5 -> G5)
      const notes = [523.25, 659.25, 783.99];
      notes.forEach((freq, i) => {
        const start = ctx.currentTime + i * 0.09;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.2, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.38);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + 0.38);
      });
    }
  } catch (err) {
    console.warn('WebAudio chime notice:', err);
  }
}

// -------------------------------------------------------------
// 2. High-Performance Client-Side Face & Head Pose Angle Tracker
// -------------------------------------------------------------
let cachedDetector = null;
let detectorChecked = false;

function getNativeDetector() {
  if (!detectorChecked) {
    detectorChecked = true;
    if (typeof window !== 'undefined' && 'FaceDetector' in window) {
      try {
        cachedDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      } catch (e) {
        cachedDetector = null;
      }
    }
  }
  return cachedDetector;
}

// Shared offscreen canvas for zero-allocation analysis
let offscreenCanvas = null;
let offscreenCtx = null;

function getOffscreenContext(w = 120, h = 90) {
  if (!offscreenCanvas && typeof document !== 'undefined') {
    offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = w;
    offscreenCanvas.height = h;
    offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
  }
  return { canvas: offscreenCanvas, ctx: offscreenCtx };
}

/**
 * Estimates current face angle from live HTML5 <video> element
 * Returns: { detected, angle: 'FRONT' | 'LEFT' | 'RIGHT' | 'CENTERING', confidence, label }
 */
export async function detectFaceAngle(videoEl, activeTargetAngle = 'FRONT') {
  if (!videoEl || videoEl.readyState < 2 || !videoEl.videoWidth || !videoEl.videoHeight) {
    return { detected: false, angle: 'NONE', confidence: 0, label: 'Waiting for camera...' };
  }

  // METHOD A: Hardware-Accelerated Native FaceDetector (Chrome Android, Edge, Samsung Internet)
  const nativeDetector = getNativeDetector();
  if (nativeDetector) {
    try {
      const faces = await nativeDetector.detect(videoEl);
      if (faces && faces.length > 0) {
        const face = faces[0];
        const bb = face.boundingBox;
        const vW = videoEl.videoWidth;
        const vH = videoEl.videoHeight;

        // Check if face is reasonably sized and centered in oval
        const faceRelWidth = bb.width / vW;
        const faceCenterX = (bb.x + bb.width / 2) / vW;

        if (faceRelWidth < 0.22) {
          return { detected: true, angle: 'TOO_FAR', confidence: 0.4, label: 'Move closer to camera' };
        }
        if (faceRelWidth > 0.85) {
          return { detected: true, angle: 'TOO_CLOSE', confidence: 0.4, label: 'Step back slightly' };
        }

        // Check landmarks if available (eyes, nose, mouth)
        const landmarks = face.landmarks || [];
        const leftEye = landmarks.find((l) => l.type === 'eye' && l.location.x < bb.x + bb.width / 2);
        const rightEye = landmarks.find((l) => l.type === 'eye' && l.location.x >= bb.x + bb.width / 2);
        const nose = landmarks.find((l) => l.type === 'nose');

        if (leftEye && rightEye && nose) {
          const eyeDist = Math.abs(rightEye.location.x - leftEye.location.x) || 1;
          const eyeMid = (leftEye.location.x + rightEye.location.x) / 2;
          // In mirrored front camera view:
          // nose shifts left when user turns their head to their left
          const yaw = (nose.location.x - eyeMid) / eyeDist;

          let angle = 'FRONT';
          if (yaw < -0.16) angle = 'LEFT';
          else if (yaw > 0.16) angle = 'RIGHT';

          return {
            detected: true,
            angle,
            yaw,
            confidence: 0.95,
            label: angle === 'FRONT' ? 'Face Centered' : angle === 'LEFT' ? 'Left Angle Detected' : 'Right Angle Detected'
          };
        }

        // If landmarks not returned, use horizontal bounding box shift & aspect
        const relShift = (faceCenterX - 0.5);
        let angle = 'FRONT';
        if (relShift < -0.1) angle = 'LEFT';
        else if (relShift > 0.1) angle = 'RIGHT';

        return {
          detected: true,
          angle,
          confidence: 0.8,
          label: angle === 'FRONT' ? 'Front Pose' : `${angle} Profile`
        };
      }
    } catch (err) {
      // Fallback to Canvas
    }
  }

  // METHOD B: Universal High-Speed Canvas Contrast & Skin-Tone Asymmetry Analysis
  // Works on Safari (iOS / iPadOS), Firefox, and all web platforms without external models
  const W = 120;
  const H = 90;
  const { canvas, ctx } = getOffscreenContext(W, H);
  if (!ctx) return { detected: false, angle: 'NONE', confidence: 0, label: 'Camera analyzing...' };

  ctx.drawImage(videoEl, 0, 0, W, H);
  const frame = ctx.getImageData(0, 0, W, H);
  const data = frame.data;

  // Central oval bounds: X: 25% to 75%, Y: 15% to 85%
  const xMin = Math.floor(W * 0.22);
  const xMax = Math.floor(W * 0.78);
  const yMin = Math.floor(H * 0.15);
  const yMax = Math.floor(H * 0.85);
  const xMid = Math.floor((xMin + xMax) / 2);

  let skinCount = 0;
  let leftSkinMass = 0;
  let rightSkinMass = 0;
  let leftDarkCount = 0;
  let rightDarkCount = 0;
  let sumX = 0;

  for (let y = yMin; y < yMax; y += 2) {
    for (let x = xMin; x < xMax; x += 2) {
      const idx = (y * W + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      // Universal skin-tone cluster rule across all human skin tones (Fitzpatrick I-VI)
      const isSkin = r > 65 && g > 38 && b > 20 && r > g && r > b && Math.abs(r - g) > 12;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      if (isSkin) {
        skinCount++;
        sumX += x;
        if (x < xMid) leftSkinMass++;
        else rightSkinMass++;
      }

      // Track facial features (dark pixels like eyes, eyebrows, nose shadows in upper 65% of face)
      if (y < yMin + (yMax - yMin) * 0.65 && lum < 70) {
        if (x < xMid) leftDarkCount++;
        else rightDarkCount++;
      }
    }
  }

  const totalSampled = ((yMax - yMin) / 2) * ((xMax - xMin) / 2);
  const skinRatio = skinCount / (totalSampled || 1);

  // If insufficient skin tone in the center oval, no face is centered
  if (skinRatio < 0.16) {
    return {
      detected: false,
      angle: 'NONE',
      confidence: 0,
      label: 'Position your face inside the green oval'
    };
  }

  // Horizontal center of mass
  const avgX = sumX / (skinCount || 1);
  const normCenterX = (avgX - xMin) / (xMax - xMin); // 0.0 (left) to 1.0 (right)

  // Asymmetry between left and right feature density
  const totalDark = leftDarkCount + rightDarkCount + 1;
  const darkAsymmetry = (rightDarkCount - leftDarkCount) / totalDark;
  const massAsymmetry = (rightSkinMass - leftSkinMass) / (skinCount || 1);

  // In mirrored video:
  // Turning head to the user's LEFT shifts profile mass and feature shadow
  const combinedYaw = normCenterX - 0.5 + darkAsymmetry * 0.45;

  let angle = 'FRONT';
  if (combinedYaw < -0.09) {
    angle = 'LEFT';
  } else if (combinedYaw > 0.09) {
    angle = 'RIGHT';
  }

  return {
    detected: true,
    angle,
    confidence: Math.min(0.92, 0.6 + skinRatio * 0.5),
    yaw: combinedYaw,
    label:
      angle === 'FRONT'
        ? '✓ Front Face Aligned'
        : angle === 'LEFT'
        ? '✓ Left Angle Detected'
        : '✓ Right Angle Detected'
  };
}
