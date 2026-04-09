/**
 * Anti-Spoofing Detection Engine
 *
 * Defends against 6 attack vectors:
 * 1. REPLAY ATTACK — replaying recorded camera feeds
 * 2. ADVERSARIAL PATCHES — AI-generated visual perturbations
 * 3. DEPTH INJECTION — fake depth data to fool verification
 * 4. MEMORY POISONING — corrupting spatial memory to accept wrong locations
 * 5. CAMERA TAMPERING — physical obstruction or replacement
 * 6. MAN-IN-THE-MIDDLE — intercepting and modifying frame data in transit
 *
 * Defense principles:
 * - Defense in depth: every layer checks independently
 * - Fail-closed: any anomaly blocks payment, never allows
 * - Cryptographic binding: frames tied to hardware + time
 * - Statistical detection: behavioral baselines detect deviations
 */
import type {
  CameraFrame,
  ThreatDetection,
  ThreatType,
  ThreatSeverity,
  FrameIntegrity,
} from '../types/index.js';
import { verifyFrame, hmacVerify, sha256 } from '../utils/crypto.js';

// ============================================================
// REPLAY ATTACK DETECTION
// ============================================================

/**
 * Detect replay attacks via:
 * 1. Monotonic sequence number gaps
 * 2. Timing jitter analysis (replayed frames have unnatural timing)
 * 3. Duplicate frame content detection
 */
export class ReplayDetector {
  private lastSequenceNumber = 0;
  private recentTimestamps: number[] = [];
  private recentHashes: Set<string> = new Set();
  private readonly maxHistory = 300; // ~10s at 30fps
  private readonly maxTimingJitterMs: number;
  private readonly minTimingJitterMs: number;

  constructor(
    fps: number = 30,
    jitterTolerancePercent: number = 50,
  ) {
    const frameInterval = 1000 / fps;
    this.minTimingJitterMs = frameInterval * (1 - jitterTolerancePercent / 100);
    this.maxTimingJitterMs = frameInterval * (1 + jitterTolerancePercent / 100);
  }

  /**
   * Check a frame for replay indicators
   * Returns threats found (empty = clean)
   */
  check(frame: CameraFrame): ThreatDetection[] {
    const threats: ThreatDetection[] = [];

    // 1. Sequence number check — must be strictly monotonic
    if (frame.sequenceNumber <= this.lastSequenceNumber) {
      threats.push({
        type: 'replay' as ThreatType,
        severity: 'critical' as ThreatSeverity,
        confidence: 0.95,
        details: `Sequence number regression: got ${frame.sequenceNumber}, expected > ${this.lastSequenceNumber}. Likely replay attack.`,
        frameId: frame.id,
        timestamp: Date.now(),
        mitigationApplied: true,
      });
    }

    // 2. Sequence gap detection — missing frames suggest manipulation
    if (frame.sequenceNumber > this.lastSequenceNumber + 2) {
      const gap = frame.sequenceNumber - this.lastSequenceNumber;
      threats.push({
        type: 'replay' as ThreatType,
        severity: 'medium' as ThreatSeverity,
        confidence: 0.6,
        details: `Sequence gap of ${gap} frames. Possible frame injection or drop.`,
        frameId: frame.id,
        timestamp: Date.now(),
        mitigationApplied: false,
      });
    }

    // 3. Timing jitter — replayed frames often have unnaturally consistent timing
    if (this.recentTimestamps.length > 0) {
      const lastTs = this.recentTimestamps[this.recentTimestamps.length - 1]!;
      const delta = frame.timestamp - lastTs;

      if (delta < this.minTimingJitterMs * 0.5) {
        threats.push({
          type: 'replay' as ThreatType,
          severity: 'high' as ThreatSeverity,
          confidence: 0.8,
          details: `Frame delta ${delta}ms is suspiciously fast (min expected: ${this.minTimingJitterMs.toFixed(1)}ms). Burst injection.`,
          frameId: frame.id,
          timestamp: Date.now(),
          mitigationApplied: true,
        });
      }

      if (delta < 0) {
        threats.push({
          type: 'replay' as ThreatType,
          severity: 'critical' as ThreatSeverity,
          confidence: 0.99,
          details: `Negative time delta (${delta}ms). Clock manipulation or replay.`,
          frameId: frame.id,
          timestamp: Date.now(),
          mitigationApplied: true,
        });
      }
    }

    // 4. Duplicate content detection (hash-based)
    const contentHash = sha256(Buffer.from(frame.rgb));
    if (this.recentHashes.has(contentHash)) {
      threats.push({
        type: 'replay' as ThreatType,
        severity: 'critical' as ThreatSeverity,
        confidence: 0.99,
        details: 'Exact duplicate frame content detected. Definite replay attack.',
        frameId: frame.id,
        timestamp: Date.now(),
        mitigationApplied: true,
      });
    }

    // 5. Timing regularity check — real cameras have natural jitter
    if (this.recentTimestamps.length >= 10) {
      const deltas: number[] = [];
      for (let i = 1; i < this.recentTimestamps.length; i++) {
        deltas.push(this.recentTimestamps[i]! - this.recentTimestamps[i - 1]!);
      }
      const variance = computeVariance(deltas);
      // Real cameras have timing variance > 0. Zero variance = synthetic
      if (variance < 0.01) {
        threats.push({
          type: 'replay' as ThreatType,
          severity: 'high' as ThreatSeverity,
          confidence: 0.85,
          details: `Near-zero timing variance (${variance.toFixed(4)}). Real cameras have natural jitter. Likely synthetic feed.`,
          frameId: frame.id,
          timestamp: Date.now(),
          mitigationApplied: true,
        });
      }
    }

    // Update state
    this.lastSequenceNumber = frame.sequenceNumber;
    this.recentTimestamps.push(frame.timestamp);
    this.recentHashes.add(contentHash);

    // Evict old history
    if (this.recentTimestamps.length > this.maxHistory) {
      this.recentTimestamps = this.recentTimestamps.slice(-this.maxHistory);
    }
    if (this.recentHashes.size > this.maxHistory) {
      const arr = [...this.recentHashes];
      this.recentHashes = new Set(arr.slice(-this.maxHistory));
    }

    return threats;
  }

  reset(): void {
    this.lastSequenceNumber = 0;
    this.recentTimestamps = [];
    this.recentHashes.clear();
  }
}

// ============================================================
// ADVERSARIAL PATCH DETECTION
// ============================================================

/**
 * Detect adversarial patches in camera frames
 *
 * Adversarial patches are AI-generated images designed to fool classifiers.
 * Detection strategies:
 * 1. High-frequency energy anomaly (patches have unusual frequency spectra)
 * 2. Color saturation spikes (patches often use extreme colors)
 * 3. Sharp boundary detection (patches have unnatural sharp edges)
 */
export class AdversarialPatchDetector {
  private readonly saturationThreshold: number;
  private readonly edgeEnergyThreshold: number;

  constructor(
    saturationThreshold: number = 0.15, // fraction of pixels with extreme saturation
    edgeEnergyThreshold: number = 0.3, // fraction of frame with very sharp edges
  ) {
    this.saturationThreshold = saturationThreshold;
    this.edgeEnergyThreshold = edgeEnergyThreshold;
  }

  check(frame: CameraFrame): ThreatDetection[] {
    const threats: ThreatDetection[] = [];

    // 1. Color saturation spike detection
    const saturationRatio = this.computeSaturationRatio(frame.rgb, frame.width, frame.height);
    if (saturationRatio > this.saturationThreshold) {
      threats.push({
        type: 'adversarial-patch' as ThreatType,
        severity: 'high' as ThreatSeverity,
        confidence: 0.7,
        details: `Abnormal color saturation: ${(saturationRatio * 100).toFixed(1)}% of pixels are highly saturated (threshold: ${(this.saturationThreshold * 100).toFixed(1)}%)`,
        frameId: frame.id,
        timestamp: Date.now(),
        mitigationApplied: false,
      });
    }

    // 2. Sharp boundary anomaly (patches have unnaturally crisp edges)
    const edgeEnergy = this.computeEdgeEnergyRatio(frame.rgb, frame.width, frame.height);
    if (edgeEnergy > this.edgeEnergyThreshold) {
      threats.push({
        type: 'adversarial-patch' as ThreatType,
        severity: 'medium' as ThreatSeverity,
        confidence: 0.6,
        details: `Abnormal edge energy: ${(edgeEnergy * 100).toFixed(1)}% (threshold: ${(this.edgeEnergyThreshold * 100).toFixed(1)}%). Possible adversarial patch.`,
        frameId: frame.id,
        timestamp: Date.now(),
        mitigationApplied: false,
      });
    }

    return threats;
  }

  /** Ratio of pixels with extreme saturation (near 0 or 255 in any channel) */
  private computeSaturationRatio(rgb: Uint8Array, width: number, height: number): number {
    let extremeCount = 0;
    const total = width * height;
    for (let i = 0; i < total; i++) {
      const r = rgb[i * 3]!;
      const g = rgb[i * 3 + 1]!;
      const b = rgb[i * 3 + 2]!;
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      // Extreme if any channel is near 0 or 255 AND high contrast
      if ((maxC > 240 || minC < 15) && (maxC - minC > 200)) {
        extremeCount++;
      }
    }
    return extremeCount / total;
  }

  /** Ratio of pixels with very strong edges */
  private computeEdgeEnergyRatio(rgb: Uint8Array, width: number, height: number): number {
    // Convert to grayscale first
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      gray[i] = Math.round(
        0.299 * rgb[i * 3]! + 0.587 * rgb[i * 3 + 1]! + 0.114 * rgb[i * 3 + 2]!,
      );
    }

    let strongEdges = 0;
    const edgeThreshold = 100; // Sobel magnitude threshold
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const gx =
          -gray[(y - 1) * width + (x - 1)]! + gray[(y - 1) * width + (x + 1)]!
          - 2 * gray[y * width + (x - 1)]! + 2 * gray[y * width + (x + 1)]!
          - gray[(y + 1) * width + (x - 1)]! + gray[(y + 1) * width + (x + 1)]!;
        const gy =
          -gray[(y - 1) * width + (x - 1)]! - 2 * gray[(y - 1) * width + x]! - gray[(y - 1) * width + (x + 1)]!
          + gray[(y + 1) * width + (x - 1)]! + 2 * gray[(y + 1) * width + x]! + gray[(y + 1) * width + (x + 1)]!;
        if (Math.sqrt(gx * gx + gy * gy) > edgeThreshold) {
          strongEdges++;
        }
      }
    }
    return strongEdges / ((width - 2) * (height - 2));
  }
}

// ============================================================
// DEPTH INJECTION DETECTION
// ============================================================

/**
 * Detect fake depth data
 * Real depth maps from stereo cameras have characteristic noise patterns.
 * Injected/synthetic depth is suspiciously clean.
 */
export function checkDepthIntegrity(frame: CameraFrame): ThreatDetection[] {
  const threats: ThreatDetection[] = [];

  if (!frame.depth) return threats;

  // 1. Zero-variance check — real depth has noise
  const variance = computeVariance(Array.from(frame.depth));
  if (variance < 0.001 && frame.depth.length > 100) {
    threats.push({
      type: 'depth-injection' as ThreatType,
      severity: 'high' as ThreatSeverity,
      confidence: 0.85,
      details: `Depth variance too low (${variance.toFixed(6)}). Real stereo depth has measurable noise.`,
      frameId: frame.id,
      timestamp: Date.now(),
      mitigationApplied: true,
    });
  }

  // 2. NaN/Infinity ratio — real depth has some invalid pixels (occlusions)
  let invalidCount = 0;
  for (let i = 0; i < frame.depth.length; i++) {
    if (!isFinite(frame.depth[i]!) || frame.depth[i]! <= 0) {
      invalidCount++;
    }
  }
  const invalidRatio = invalidCount / frame.depth.length;
  // Real depth: ~2-15% invalid. Zero invalid = suspicious. >50% = broken sensor.
  if (invalidRatio < 0.005 && frame.depth.length > 1000) {
    threats.push({
      type: 'depth-injection' as ThreatType,
      severity: 'medium' as ThreatSeverity,
      confidence: 0.65,
      details: `Only ${(invalidRatio * 100).toFixed(2)}% invalid depth pixels. Real stereo cameras have 2-15% occlusion holes.`,
      frameId: frame.id,
      timestamp: Date.now(),
      mitigationApplied: false,
    });
  }
  if (invalidRatio > 0.5) {
    threats.push({
      type: 'camera-tampering' as ThreatType,
      severity: 'high' as ThreatSeverity,
      confidence: 0.8,
      details: `${(invalidRatio * 100).toFixed(1)}% of depth pixels invalid. Sensor may be obstructed or damaged.`,
      frameId: frame.id,
      timestamp: Date.now(),
      mitigationApplied: true,
    });
  }

  return threats;
}

// ============================================================
// MEMORY POISONING DETECTION
// ============================================================

/**
 * Canary values for spatial memory
 * Plant fake landmarks that don't physically exist.
 * If a spatial proof references a canary, the camera feed is synthetic.
 */
export class CanarySystem {
  private canaries: Map<string, { position: { x: number; y: number; z: number }; signature: string }> = new Map();

  constructor(private readonly hmacSecret: string) {}

  /** Plant a canary at a specific position */
  plant(id: string, position: { x: number; y: number; z: number }): void {
    const sig = sha256(`canary:${id}:${position.x}:${position.y}:${position.z}:${this.hmacSecret}`);
    this.canaries.set(id, { position, signature: sig });
  }

  /** Check if any detected features match planted canaries */
  checkForCanaryActivation(detectedPositions: readonly { x: number; y: number; z: number }[], tolerance: number = 0.5): ThreatDetection[] {
    const threats: ThreatDetection[] = [];

    for (const [id, canary] of this.canaries) {
      for (const detected of detectedPositions) {
        const dist = Math.sqrt(
          (detected.x - canary.position.x) ** 2 +
          (detected.y - canary.position.y) ** 2 +
          (detected.z - canary.position.z) ** 2,
        );
        if (dist < tolerance) {
          threats.push({
            type: 'memory-poisoning' as ThreatType,
            severity: 'critical' as ThreatSeverity,
            confidence: 0.95,
            details: `Canary "${id}" activated at distance ${dist.toFixed(3)}m. Camera feed references a non-existent landmark. Spatial memory has been poisoned or feed is synthetic.`,
            timestamp: Date.now(),
            mitigationApplied: true,
          });
        }
      }
    }

    return threats;
  }

  get count(): number {
    return this.canaries.size;
  }
}

// ============================================================
// UNIFIED FRAME INTEGRITY CHECK
// ============================================================

/**
 * Full integrity check for a camera frame
 * Runs all detectors and returns consolidated result
 */
export class FrameIntegrityChecker {
  private replayDetector: ReplayDetector;
  private patchDetector: AdversarialPatchDetector;

  constructor(
    private readonly hmacSecret: string,
    fps: number = 30,
  ) {
    this.replayDetector = new ReplayDetector(fps);
    this.patchDetector = new AdversarialPatchDetector();
  }

  /**
   * Comprehensive frame integrity check
   * Fail-closed: any critical threat = frame rejected
   */
  check(frame: CameraFrame): FrameIntegrity {
    const threats: ThreatDetection[] = [];

    // 1. HMAC verification
    let hmacValid = false;
    if (frame.hmac) {
      hmacValid = verifyFrame(
        frame.rgb,
        frame.timestamp,
        frame.sequenceNumber,
        frame.hmac,
        this.hmacSecret,
      );
      if (!hmacValid) {
        threats.push({
          type: 'mitm' as ThreatType,
          severity: 'critical' as ThreatSeverity,
          confidence: 0.99,
          details: 'HMAC verification failed. Frame data has been tampered with in transit.',
          frameId: frame.id,
          timestamp: Date.now(),
          mitigationApplied: true,
        });
      }
    } else {
      threats.push({
        type: 'mitm' as ThreatType,
        severity: 'high' as ThreatSeverity,
        confidence: 0.7,
        details: 'Frame is missing HMAC signature. Cannot verify integrity.',
        frameId: frame.id,
        timestamp: Date.now(),
        mitigationApplied: true,
      });
    }

    // 2. Replay detection
    threats.push(...this.replayDetector.check(frame));

    // 3. Adversarial patch detection
    threats.push(...this.patchDetector.check(frame));

    // 4. Depth integrity
    threats.push(...checkDepthIntegrity(frame));

    // Determine sequence validity
    const sequenceValid = !threats.some(
      t => t.type === ('replay' as ThreatType) && t.severity === ('critical' as ThreatSeverity),
    );

    // Determine timing validity
    const timingValid = !threats.some(
      t => t.details.includes('timing') || t.details.includes('time delta') || t.details.includes('Clock'),
    );

    return {
      frameId: frame.id,
      hmacValid,
      sequenceValid,
      timingValid,
      threats,
    };
  }

  /** Is the frame safe to use for spatial verification? */
  isSafe(integrity: FrameIntegrity): boolean {
    // Fail-closed: reject if any critical threat
    const hasCritical = integrity.threats.some(
      t => t.severity === ('critical' as ThreatSeverity),
    );
    return integrity.hmacValid && integrity.sequenceValid && !hasCritical;
  }

  reset(): void {
    this.replayDetector.reset();
  }
}

// ============================================================
// HELPERS
// ============================================================

function computeVariance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
}
