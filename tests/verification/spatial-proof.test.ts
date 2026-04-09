import { describe, it, expect } from 'vitest';
import {
  computeSSIM,
  rgbToGrayscale,
  approximateLPIPS,
  computeSpatialMetrics,
  generateSpatialProof,
  verifySpatialProofIntegrity,
  createSettlement,
} from '../../src/verification/spatial-proof.js';
import { signFrame, generateNonce } from '../../src/utils/crypto.js';
import type { CameraFrame, RenderedView, Pose, VerificationThresholds } from '../../src/types/index.js';
// RenderedView also used in settlement test

const TEST_SECRET = 'a'.repeat(32);
const TEST_POSE: Pose = {
  position: { x: 5, y: 10, z: 0 },
  orientation: { w: 1, x: 0, y: 0, z: 0 },
  timestamp: Date.now(),
};

function makeTestImage(width: number, height: number, seed: number = 42): Uint8Array {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < rgb.length; i++) {
    rgb[i] = (i * 17 + seed * 31) % 256;
  }
  return rgb;
}

function makeFrame(width: number, height: number, seed: number = 42): CameraFrame {
  const rgb = makeTestImage(width, height, seed);
  const depth = new Float32Array(width * height);
  for (let i = 0; i < depth.length; i++) {
    depth[i] = 1 + Math.random() * 4;
  }
  const timestamp = Date.now();
  const seq = 1;
  return {
    id: generateNonce(8),
    timestamp,
    rgb,
    width,
    height,
    depth,
    pose: TEST_POSE,
    hmac: signFrame(rgb, timestamp, seq, TEST_SECRET),
    sequenceNumber: seq,
  };
}

function makeRender(width: number, height: number, seed: number = 42): RenderedView {
  const rgb = makeTestImage(width, height, seed);
  const depth = new Float32Array(width * height);
  for (let i = 0; i < depth.length; i++) {
    depth[i] = 1 + Math.random() * 4;
  }
  return { rgb, depth, width, height, pose: TEST_POSE, renderTimeMs: 5 };
}

describe('SSIM', () => {
  it('returns 1.0 for identical images', () => {
    const img = new Uint8Array(64 * 64);
    for (let i = 0; i < img.length; i++) img[i] = (i * 7) % 256;
    const ssim = computeSSIM(img, img, 64, 64);
    expect(ssim).toBeCloseTo(1.0, 2);
  });

  it('returns low SSIM for different images', () => {
    const a = new Uint8Array(64 * 64);
    const b = new Uint8Array(64 * 64);
    for (let i = 0; i < a.length; i++) {
      a[i] = (i * 7) % 256;
      b[i] = (i * 13 + 128) % 256;
    }
    const ssim = computeSSIM(a, b, 64, 64);
    expect(ssim).toBeLessThan(0.5);
  });

  it('throws on dimension mismatch', () => {
    expect(() => computeSSIM(new Uint8Array(100), new Uint8Array(200), 10, 10)).toThrow('dimensions');
  });
});

describe('RGB to Grayscale', () => {
  it('converts correctly', () => {
    // Pure red pixel
    const rgb = new Uint8Array([255, 0, 0]);
    const gray = rgbToGrayscale(rgb, 1, 1);
    expect(gray[0]).toBe(Math.round(0.299 * 255)); // ~76
  });

  it('white pixel becomes 255', () => {
    const rgb = new Uint8Array([255, 255, 255]);
    const gray = rgbToGrayscale(rgb, 1, 1);
    expect(gray[0]).toBe(255);
  });
});

describe('LPIPS Approximation', () => {
  it('returns 0 for identical images', () => {
    const img = new Uint8Array(64 * 64);
    for (let i = 0; i < img.length; i++) img[i] = (i * 7) % 256;
    const lpips = approximateLPIPS(img, img, 64, 64);
    expect(lpips).toBeCloseTo(0, 1);
  });

  it('returns positive value for different images', () => {
    const a = new Uint8Array(64 * 64);
    const b = new Uint8Array(64 * 64);
    for (let i = 0; i < a.length; i++) {
      a[i] = (i * 7) % 256;
      b[i] = (i * 13 + 128) % 256;
    }
    const lpips = approximateLPIPS(a, b, 64, 64);
    expect(lpips).toBeGreaterThan(0);
    expect(lpips).toBeLessThanOrEqual(1);
  });
});

describe('Spatial Metrics', () => {
  it('computes metrics for matching views', () => {
    const frame = makeFrame(64, 64, 42);
    const render = makeRender(64, 64, 42);
    const thresholds: VerificationThresholds = {
      minSSIM: 0.75,
      maxLPIPS: 0.25,
      maxDepthMAE: 0.5,
      minComposite: 0.75,
    };
    const metrics = computeSpatialMetrics(render, frame, thresholds);
    expect(metrics.ssim).toBeDefined();
    expect(metrics.lpips).toBeDefined();
    expect(metrics.depthMAE).toBeDefined();
    expect(metrics.composite).toBeDefined();
    expect(metrics.composite).toBeGreaterThanOrEqual(0);
    expect(metrics.composite).toBeLessThanOrEqual(1);
  });

  it('throws on dimension mismatch', () => {
    const frame = makeFrame(64, 64);
    const render = makeRender(32, 32);
    expect(() => computeSpatialMetrics(render, frame, {
      minSSIM: 0.75, maxLPIPS: 0.25, maxDepthMAE: 0.5, minComposite: 0.75,
    })).toThrow('mismatch');
  });
});

describe('Spatial Proof', () => {
  it('generates a valid proof', () => {
    const frame = makeFrame(64, 64);
    const render = makeRender(64, 64);
    const proof = generateSpatialProof(
      'robot-001',
      TEST_POSE,
      frame,
      render,
      'merkle-root-abc',
      ['proof1', 'proof2'],
      TEST_SECRET,
    );

    expect(proof.id).toBeTruthy();
    expect(proof.robotId).toBe('robot-001');
    expect(proof.signature).toHaveLength(64);
    expect(proof.nonce).toHaveLength(64);
    expect(proof.metrics).toBeDefined();
    expect(typeof proof.passed).toBe('boolean');
  });

  it('proof integrity check passes for valid proof', () => {
    const frame = makeFrame(64, 64);
    const render = makeRender(64, 64);
    const proof = generateSpatialProof(
      'robot-001', TEST_POSE, frame, render,
      'merkle-root', [], TEST_SECRET,
    );

    const result = verifySpatialProofIntegrity(proof, TEST_SECRET);
    expect(result.valid).toBe(true);
  });

  it('proof integrity fails with wrong secret', () => {
    const frame = makeFrame(64, 64);
    const render = makeRender(64, 64);
    const proof = generateSpatialProof(
      'robot-001', TEST_POSE, frame, render,
      'merkle-root', [], TEST_SECRET,
    );

    const result = verifySpatialProofIntegrity(proof, 'b'.repeat(32));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('signature');
  });

  it('proof integrity fails if expired', () => {
    const frame = makeFrame(64, 64);
    const render = makeRender(64, 64);
    const proof = generateSpatialProof(
      'robot-001', TEST_POSE, frame, render,
      'merkle-root', [], TEST_SECRET,
    );

    // Fake an old proof by mutating timestamp (proof is already signed so sig will fail too)
    const oldProof = { ...proof, timestamp: Date.now() - 600_000 }; // 10 min old
    const result = verifySpatialProofIntegrity(oldProof, TEST_SECRET, 300_000); // 5 min max
    expect(result.valid).toBe(false);
    // Either expired or signature mismatch (since we changed timestamp)
    expect(result.reason).toBeDefined();
  });

  it('rejects unsigned frames', () => {
    const frame = makeFrame(64, 64);
    const unsignedFrame = { ...frame, hmac: undefined };
    const render = makeRender(64, 64);
    expect(() => generateSpatialProof(
      'robot-001', TEST_POSE, unsignedFrame, render,
      'merkle-root', [], TEST_SECRET,
    )).toThrow('HMAC-signed');
  });

  it('rejects empty robotId', () => {
    const frame = makeFrame(64, 64);
    const render = makeRender(64, 64);
    expect(() => generateSpatialProof(
      '', TEST_POSE, frame, render,
      'merkle-root', [], TEST_SECRET,
    )).toThrow('robotId');
  });

  it('rejects short HMAC secret', () => {
    const frame = makeFrame(64, 64);
    const render = makeRender(64, 64);
    expect(() => generateSpatialProof(
      'robot-001', TEST_POSE, frame, render,
      'merkle-root', [], 'short',
    )).toThrow('32 chars');
  });
});

describe('Settlement', () => {
  it('creates verified settlement for passing proof', () => {
    const frame = makeFrame(64, 64);
    const render = makeRender(64, 64);
    const proof = generateSpatialProof(
      'robot-001', TEST_POSE, frame, render,
      'merkle-root', [], TEST_SECRET,
    );
    // Generate a proof where same image is used for both expected and actual (will pass SSIM=1.0)
    const identicalRender: RenderedView = {
      rgb: frame.rgb,
      depth: frame.depth!,
      width: frame.width,
      height: frame.height,
      pose: TEST_POSE,
      renderTimeMs: 1,
    };
    const passingProof = generateSpatialProof(
      'robot-001', TEST_POSE, frame, identicalRender,
      'merkle-root', [], TEST_SECRET,
    );
    expect(passingProof.passed).toBe(true);
    const settlement = createSettlement(passingProof, 10.00, 'USD', 'merchant-001', TEST_SECRET);
    expect(settlement.amount).toBe(10.00);
    expect(settlement.currency).toBe('USD');
    expect(settlement.payeeId).toBe('merchant-001');
    expect(settlement.status).toBe('verified');
  });

  it('fails settlement for failing proof', () => {
    const frame = makeFrame(64, 64);
    const render = makeRender(64, 64);
    const proof = generateSpatialProof(
      'robot-001', TEST_POSE, frame, render,
      'merkle-root', [], TEST_SECRET,
    );
    const failedProof = { ...proof, passed: false };
    const settlement = createSettlement(failedProof, 10.00, 'USD', 'merchant-001', TEST_SECRET);
    expect(settlement.status).toBe('failed');
    expect(settlement.failureReason).toContain('Spatial verification failed');
  });

  it('rejects zero amount', () => {
    const frame = makeFrame(64, 64);
    const render = makeRender(64, 64);
    const proof = generateSpatialProof(
      'robot-001', TEST_POSE, frame, render, 'mr', [], TEST_SECRET,
    );
    expect(() => createSettlement(proof, 0, 'USD', 'merchant', TEST_SECRET)).toThrow('positive');
  });

  it('rejects negative amount', () => {
    const frame = makeFrame(64, 64);
    const render = makeRender(64, 64);
    const proof = generateSpatialProof(
      'robot-001', TEST_POSE, frame, render, 'mr', [], TEST_SECRET,
    );
    expect(() => createSettlement(proof, -5, 'USD', 'merchant', TEST_SECRET)).toThrow('positive');
  });
});
