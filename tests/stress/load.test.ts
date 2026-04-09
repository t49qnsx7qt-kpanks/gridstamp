/**
 * Production Stress Tests — Load, concurrency, edge cases, overflow
 *
 * These simulate real fleet operations:
 * - 1000 robots registering and operating simultaneously
 * - Rapid-fire verification cycles
 * - Memory pressure under sustained load
 * - Boundary conditions that break naive implementations
 */

import { describe, it, expect } from 'vitest';
import {
  TrustTierSystem,
  TrustTier,
  TIER_CONFIGS,
  BadgeSystem,
  StreakSystem,
  ZoneMasterySystem,
  FleetLeaderboard,
  LeaderboardMetric,
  type RobotMetrics,
  type RobotStats,
} from '../../src/gamification/index.js';
import {
  computeSSIM,
  rgbToGrayscale,
  approximateLPIPS,
  generateSpatialProof,
  verifySpatialProofIntegrity,
  createSettlement,
} from '../../src/verification/spatial-proof.js';
import {
  ReplayDetector,
  FrameIntegrityChecker,
  CanarySystem,
} from '../../src/antispoofing/detector.js';
import { signFrame, generateNonce, hmacSign, deriveKey } from '../../src/utils/crypto.js';
import { PlaceCellPopulation, GridCellSystem, computeSpatialCode } from '../../src/memory/place-cells.js';
import { ShortTermMemory } from '../../src/memory/spatial-memory.js';
import type { CameraFrame, Pose, RenderedView } from '../../src/types/index.js';

const SECRET = 'a]9#kL2$mP7xQ4vB8nR1wF5yH3jT6dG0'.slice(0, 32);

function makeTestPose(x: number, y: number): Pose {
  return {
    position: { x, y, z: 0 },
    orientation: { w: 1, x: 0, y: 0, z: 0 },
    timestamp: Date.now(),
  };
}

function makeTestFrame(w: number, h: number, seed: number, seq: number): CameraFrame {
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 17 + seed * 31) % 256;
  const depth = new Float32Array(w * h);
  for (let i = 0; i < depth.length; i++) depth[i] = 1 + (seed % 5);
  const ts = Date.now();
  return {
    id: generateNonce(8),
    timestamp: ts,
    rgb, width: w, height: h, depth,
    pose: makeTestPose(seed, seed),
    hmac: signFrame(rgb, ts, seq, SECRET),
    sequenceNumber: seq,
  };
}

function makeRender(w: number, h: number, seed: number): RenderedView {
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 17 + seed * 31) % 256;
  const depth = new Float32Array(w * h);
  for (let i = 0; i < depth.length; i++) depth[i] = 1 + (seed % 5);
  return { rgb, depth, width: w, height: h, pose: makeTestPose(seed, seed), renderTimeMs: 1 };
}

// ============================================================
// LOAD TESTS
// ============================================================

describe('Load: Trust Tier System', () => {
  it('handles 1000 robot registrations', () => {
    const system = new TrustTierSystem(SECRET);
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      system.register(`robot-${i}`);
    }
    const elapsed = performance.now() - start;
    expect(system.robotCount).toBe(1000);
    expect(elapsed).toBeLessThan(1000); // under 1 second
  });

  it('handles 10,000 success recordings across 100 robots', () => {
    const system = new TrustTierSystem(SECRET);
    for (let i = 0; i < 100; i++) system.register(`r-${i}`);
    const start = performance.now();
    for (let round = 0; round < 100; round++) {
      for (let i = 0; i < 100; i++) {
        system.recordSuccess(`r-${i}`, 10);
      }
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5000); // under 5 seconds for 10K ops
    // All robots should have progressed past Untrusted
    for (let i = 0; i < 100; i++) {
      const profile = system.getProfile(`r-${i}`)!;
      expect(profile.points).toBe(1000);
      expect(profile.currentTier).toBeGreaterThan(TrustTier.UNTRUSTED);
    }
  });

  it('history chain integrity holds under volume', () => {
    const system = new TrustTierSystem(SECRET);
    system.register('heavy-robot');
    // Generate enough activity to trigger multiple promotions
    for (let i = 0; i < 500; i++) system.recordSuccess('heavy-robot', 20);
    const result = system.verifyHistory('heavy-robot');
    expect(result.valid).toBe(true);
    const profile = system.getProfile('heavy-robot')!;
    expect(profile.history.length).toBeGreaterThan(0);
    // Every single event in history must be signed
    for (const event of profile.history) {
      expect(event.signature).toHaveLength(64);
    }
  });

  it('tier progression is monotonically correct under load', () => {
    const system = new TrustTierSystem(SECRET);
    system.register('climber');
    let lastTier = TrustTier.UNTRUSTED;
    for (let i = 0; i < 1000; i++) {
      system.recordSuccess('climber', 10);
      const profile = system.getProfile('climber')!;
      // Tier should never decrease during pure success run
      expect(profile.currentTier).toBeGreaterThanOrEqual(lastTier);
      lastTier = profile.currentTier;
    }
    expect(lastTier).toBeGreaterThanOrEqual(TrustTier.ELITE);
  });
});

describe('Load: Badge System', () => {
  it('evaluates badges for 500 robots efficiently', () => {
    const system = new BadgeSystem(SECRET);
    const start = performance.now();
    for (let i = 0; i < 500; i++) {
      const metrics: RobotMetrics = {
        successful_verifications: 100 + i,
        spoofing_incidents: 0,
        threats_detected: i % 20,
        zones_mapped: 5 + (i % 30),
        max_zone_mastery: 0.3 + (i % 70) / 100,
        unique_routes: 10 + i,
        consecutive_days: 7 + (i % 60),
        night_operations: i % 80,
        total_verifications: 110 + i,
        success_rate: 90 + (i % 10),
        max_ssim: 0.85 + (i % 15) / 100,
        max_zones_per_trip: 1 + (i % 5),
        fast_operations: i % 20,
      };
      system.evaluate(`robot-${i}`, metrics);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(3000);
    // Spot check: first robot should have multiple badges
    expect(system.getBadgeCount('robot-0')).toBeGreaterThan(3);
    // All badges should be signed
    const badges = system.getBadges('robot-0');
    for (const badge of badges) {
      expect(badge.signature).toHaveLength(64);
    }
  });
});

describe('Load: Streak System', () => {
  it('simulates 365-day streak for 100 robots', () => {
    const system = new StreakSystem(SECRET);
    for (let i = 0; i < 100; i++) system.register(`r-${i}`);
    const baseDate = new Date('2025-01-01T12:00:00Z').getTime();
    const start = performance.now();
    for (let day = 0; day < 365; day++) {
      const ts = baseDate + day * 86400000;
      for (let i = 0; i < 100; i++) {
        system.recordActivity(`r-${i}`, 100, ts);
      }
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5000); // 36,500 operations under 5s
    // Every robot should have 365-day streak
    for (let i = 0; i < 100; i++) {
      const record = system.getRecord(`r-${i}`)!;
      expect(record.currentStreak).toBe(365);
      expect(record.longestStreak).toBe(365);
    }
  });

  it('multiplier stays bounded even at extreme streaks', () => {
    const system = new StreakSystem(SECRET);
    expect(system.calculateMultiplier(0)).toBe(1.0);
    expect(system.calculateMultiplier(10)).toBe(2.0); // capped
    expect(system.calculateMultiplier(100)).toBe(2.0);
    expect(system.calculateMultiplier(10000)).toBe(2.0);
    expect(system.calculateMultiplier(Number.MAX_SAFE_INTEGER)).toBe(2.0);
  });
});

describe('Load: Zone Mastery', () => {
  it('handles 50 zones with 200 robots visiting', () => {
    const system = new ZoneMasterySystem(SECRET, 2.0);
    // Create 50 zones
    const zoneIds: string[] = [];
    for (let z = 0; z < 50; z++) {
      const zone = system.defineZone(`Zone-${z}`, {
        min: { x: z * 100, y: 0, z: 0 },
        max: { x: z * 100 + 50, y: 50, z: 5 },
      });
      zoneIds.push(zone.id);
    }
    expect(system.totalZones).toBe(50);

    // 200 robots each visit 5 random zones
    const start = performance.now();
    for (let r = 0; r < 200; r++) {
      for (let v = 0; v < 5; v++) {
        const z = (r + v) % 50;
        system.recordVisit(
          `robot-${r}`,
          { x: z * 100 + 25, y: 25, z: 2 },
          Math.random() > 0.1, // 90% success
          50,
        );
      }
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(3000); // 1000 visits under 3s

    // Spot check mastery
    const scores = system.getAllMastery('robot-0');
    expect(scores.length).toBeGreaterThan(0);
    for (const score of scores) {
      expect(score.composite).toBeGreaterThanOrEqual(0);
      expect(score.composite).toBeLessThanOrEqual(1);
      expect(score.coverage).toBeGreaterThanOrEqual(0);
      expect(score.successRate).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('Load: Fleet Leaderboard', () => {
  it('ranks 500 robots across 10 fleets', () => {
    const lb = new FleetLeaderboard(SECRET);
    for (let i = 0; i < 500; i++) {
      lb.updateStats({
        robotId: `robot-${i}`,
        fleetId: `fleet-${i % 10}`,
        trustTier: (i % 6) as TrustTier,
        points: Math.floor(Math.random() * 10000),
        totalVerifications: 50 + Math.floor(Math.random() * 500),
        successfulVerifications: 45 + Math.floor(Math.random() * 450),
        zonesExplored: Math.floor(Math.random() * 50),
        badgeCount: Math.floor(Math.random() * 20),
        streakDays: Math.floor(Math.random() * 100),
        maxZoneMastery: Math.random(),
        spoofingIncidents: Math.floor(Math.random() * 3),
      });
    }
    expect(lb.totalRobots).toBe(500);

    const start = performance.now();
    // Generate leaderboards for all 10 fleets
    for (let f = 0; f < 10; f++) {
      const board = lb.getFleetLeaderboard(`fleet-${f}`, LeaderboardMetric.COMPOSITE, 50);
      expect(board.length).toBeLessThanOrEqual(50);
      // Verify descending order
      for (let j = 1; j < board.length; j++) {
        expect(board[j]!.score).toBeLessThanOrEqual(board[j - 1]!.score);
      }
      // Verify ranks are sequential
      for (let j = 0; j < board.length; j++) {
        expect(board[j]!.rank).toBe(j + 1);
      }
    }
    // Global leaderboard
    const global = lb.getGlobalLeaderboard(LeaderboardMetric.COMPOSITE, 100);
    expect(global.length).toBe(100);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });

  it('fleet summary aggregates correctly under load', () => {
    const lb = new FleetLeaderboard(SECRET);
    let totalSuccess = 0;
    let totalVerify = 0;
    for (let i = 0; i < 100; i++) {
      const sv = 80 + (i % 20);
      const tv = 100;
      totalSuccess += sv;
      totalVerify += tv;
      lb.updateStats({
        robotId: `r-${i}`,
        fleetId: 'mega-fleet',
        trustTier: TrustTier.VERIFIED,
        points: 500,
        totalVerifications: tv,
        successfulVerifications: sv,
        zonesExplored: 5,
        badgeCount: 3,
        streakDays: 10,
        maxZoneMastery: 0.5,
        spoofingIncidents: 0,
      });
    }
    const summary = lb.getFleetSummary('mega-fleet');
    expect(summary.robotCount).toBe(100);
    expect(summary.totalDeliveries).toBe(totalSuccess);
    expect(summary.averageSuccessRate).toBeCloseTo(totalSuccess / totalVerify, 2);
  });
});

// ============================================================
// VERIFICATION STRESS
// ============================================================

describe('Load: Spatial Verification', () => {
  it('100 rapid spatial proofs maintain integrity', () => {
    const proofs = [];
    for (let i = 0; i < 100; i++) {
      const frame = makeTestFrame(32, 32, i, i + 1);
      const render = makeRender(32, 32, i);
      const proof = generateSpatialProof(
        `robot-${i}`, makeTestPose(i, i), frame, render,
        `merkle-${i}`, [], SECRET,
      );
      proofs.push(proof);
    }
    // Every proof should have valid signature
    for (const proof of proofs) {
      const result = verifySpatialProofIntegrity(proof, SECRET);
      expect(result.valid).toBe(true);
    }
    // Every proof with wrong secret should fail
    for (const proof of proofs) {
      const result = verifySpatialProofIntegrity(proof, 'b'.repeat(32));
      expect(result.valid).toBe(false);
    }
  });

  it('SSIM computation handles large images', () => {
    const size = 256;
    const img = new Uint8Array(size * size);
    for (let i = 0; i < img.length; i++) img[i] = (i * 7) % 256;
    const start = performance.now();
    const ssim = computeSSIM(img, img, size, size);
    const elapsed = performance.now() - start;
    expect(ssim).toBeCloseTo(1.0, 2);
    expect(elapsed).toBeLessThan(1000); // 256x256 SSIM under 1s
  });

  it('settlement atomic verify-then-pay under rapid fire', () => {
    const settlements = [];
    for (let i = 0; i < 50; i++) {
      const frame = makeTestFrame(32, 32, 42, i + 1);
      const identicalRender: RenderedView = {
        rgb: frame.rgb, depth: frame.depth!, width: 32, height: 32,
        pose: makeTestPose(42, 42), renderTimeMs: 1,
      };
      const proof = generateSpatialProof(
        'robot-1', makeTestPose(42, 42), frame, identicalRender,
        'merkle-root', [], SECRET,
      );
      if (proof.passed) {
        const settlement = createSettlement(proof, 10.00, 'USD', `merchant-${i}`, SECRET);
        settlements.push(settlement);
      }
    }
    expect(settlements.length).toBeGreaterThan(0);
    for (const s of settlements) {
      expect(s.status).toBe('verified');
      expect(s.amount).toBe(10.00);
    }
  });
});

// ============================================================
// ANTI-SPOOFING STRESS
// ============================================================

describe('Load: Anti-Spoofing', () => {
  it('replay detector handles 1000 sequential frames', () => {
    const detector = new ReplayDetector(30);
    const now = Date.now();
    let criticalCount = 0;
    for (let i = 0; i < 1000; i++) {
      // Embed frame index as raw bytes to guarantee unique content hashes
      const rgb = new Uint8Array(32 * 32 * 3);
      rgb[0] = (i >> 24) & 0xFF;
      rgb[1] = (i >> 16) & 0xFF;
      rgb[2] = (i >> 8) & 0xFF;
      rgb[3] = i & 0xFF;
      for (let j = 4; j < rgb.length; j++) rgb[j] = (j + i) & 0xFF;
      const ts = now + i * 33;
      const frame: CameraFrame = {
        id: `frame-${i}`,
        timestamp: ts,
        rgb, width: 32, height: 32,
        sequenceNumber: i + 1,
        hmac: signFrame(rgb, ts, i + 1, SECRET),
      };
      const threats = detector.check(frame);
      const critical = threats.filter(t => t.severity === 'critical');
      criticalCount += critical.length;
    }
    // Across 1000 sequential frames, no critical replay threats
    expect(criticalCount).toBe(0);
  });

  it('canary system scales to 100 canaries', () => {
    const canaries = new CanarySystem(SECRET);
    for (let i = 0; i < 100; i++) {
      canaries.plant(`canary-${i}`, { x: i * 100, y: i * 100, z: 0 });
    }
    expect(canaries.count).toBe(100);

    // Check activation at a canary position (within 0.5m tolerance)
    const threats = canaries.checkForCanaryActivation([
      { x: 0.3, y: 0.3, z: 0 }, // within 0.5m of canary-0 at (0,0,0)
    ]);
    expect(threats.length).toBe(1);

    // Check at a position far from all canaries (canaries are at i*100, i*100)
    // Use a position that doesn't match any canary: x=50.5 * 100 = midpoint
    const safe = canaries.checkForCanaryActivation([
      { x: 99999, y: 99999, z: 0 },
    ]);
    expect(safe).toHaveLength(0);
  });
});

// ============================================================
// SPATIAL MEMORY STRESS
// ============================================================

describe('Load: Place Cell Population', () => {
  it('covers large region with place cells', () => {
    const pop = new PlaceCellPopulation(2.0);
    const count = pop.coverRegion(
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 100, z: 0 },
      3.0,
    );
    expect(count).toBeGreaterThan(100);

    // Activations should work at any point
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      const activations = pop.getActivations({
        x: Math.random() * 100,
        y: Math.random() * 100,
        z: 0,
      });
      expect(activations.size).toBeGreaterThan(0);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5000); // 1000 queries under 5s
  });

  it('grid cell system handles multi-scale queries', () => {
    const system = new GridCellSystem(0.5, Math.SQRT2, 6, 32);
    expect(system.totalCells).toBe(192); // 6 * 32
    const start = performance.now();
    for (let i = 0; i < 500; i++) {
      const activations = system.getActivations({
        x: Math.random() * 50,
        y: Math.random() * 50,
        z: 0,
      });
      expect(activations.size).toBe(192);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(3000);
  });
});

describe('Load: Short-Term Memory', () => {
  it('handles rapid frame insertion at 30fps', () => {
    const stm = new ShortTermMemory(900, 30000); // 30s buffer
    const start = performance.now();
    for (let i = 0; i < 900; i++) {
      const frame = makeTestFrame(32, 32, i, i + 1);
      stm.add(frame, []);
    }
    const elapsed = performance.now() - start;
    expect(stm.count).toBe(900);
    expect(elapsed).toBeLessThan(2000);
    // Verify FIFO eviction
    stm.add(makeTestFrame(32, 32, 901, 901), []);
    expect(stm.count).toBe(900); // oldest evicted
  });
});
