/**
 * Integration Simulation — Full robot lifecycle from registration to elite status
 *
 * Simulates a realistic fleet scenario:
 * - Fleet of 20 delivery robots
 * - 90-day operation period
 * - Varying success rates, zone visits, incidents
 * - One attacker bot attempting spoofing
 * - Tracks all metrics for competitive analysis output
 */

import { describe, it, expect } from 'vitest';
import {
  TrustTierSystem,
  TrustTier,
  BadgeSystem,
  StreakSystem,
  ZoneMasterySystem,
  FleetLeaderboard,
  LeaderboardMetric,
  type RobotMetrics,
} from '../../src/gamification/index.js';
import {
  generateSpatialProof,
  verifySpatialProofIntegrity,
  createSettlement,
} from '../../src/verification/spatial-proof.js';
import { signFrame, generateNonce } from '../../src/utils/crypto.js';
import { PlaceCellPopulation, GridCellSystem, computeSpatialCode } from '../../src/memory/place-cells.js';
import type { CameraFrame, Pose, RenderedView } from '../../src/types/index.js';

const SECRET = 'z'.repeat(32);
const FLEET_ID = 'dallas-delivery-fleet';
const NUM_ROBOTS = 20;
const SIMULATION_DAYS = 90;
const OPS_PER_DAY = 8; // 8 deliveries per robot per day

function makePose(x: number, y: number): Pose {
  return { position: { x, y, z: 0 }, orientation: { w: 1, x: 0, y: 0, z: 0 }, timestamp: Date.now() };
}

function makeFrame(seed: number, seq: number): CameraFrame {
  const rgb = new Uint8Array(32 * 32 * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 17 + seed * 31) % 256;
  const ts = Date.now();
  return {
    id: generateNonce(8), timestamp: ts, rgb, width: 32, height: 32,
    depth: new Float32Array(32 * 32).fill(2.5),
    pose: makePose(seed, seed),
    hmac: signFrame(rgb, ts, seq, SECRET),
    sequenceNumber: seq,
  };
}

describe('Fleet Simulation: 20 robots × 90 days', () => {
  // Shared state across the simulation
  const trustSystem = new TrustTierSystem(SECRET);
  const badgeSystem = new BadgeSystem(SECRET);
  const streakSystem = new StreakSystem(SECRET);
  const zoneMastery = new ZoneMasterySystem(SECRET, 5.0);
  const leaderboard = new FleetLeaderboard(SECRET);

  // Define realistic delivery zones
  const zones = [
    { name: 'Downtown Dallas', min: { x: 0, y: 0, z: 0 }, max: { x: 50, y: 50, z: 3 } },
    { name: 'Deep Ellum', min: { x: 50, y: 0, z: 0 }, max: { x: 100, y: 30, z: 3 } },
    { name: 'Uptown', min: { x: 0, y: 50, z: 0 }, max: { x: 40, y: 100, z: 3 } },
    { name: 'Bishop Arts', min: { x: -30, y: -30, z: 0 }, max: { x: 0, y: 0, z: 3 } },
    { name: 'Oak Lawn', min: { x: -30, y: 50, z: 0 }, max: { x: 0, y: 100, z: 3 } },
    { name: 'Fair Park', min: { x: 60, y: 30, z: 0 }, max: { x: 100, y: 60, z: 3 } },
    { name: 'Greenville Ave', min: { x: 30, y: 70, z: 0 }, max: { x: 60, y: 100, z: 3 } },
    { name: 'Design District', min: { x: -50, y: 20, z: 0 }, max: { x: -20, y: 50, z: 3 } },
  ];

  // Robot personality profiles (different success rates simulate real fleet variance)
  const robotProfiles = Array.from({ length: NUM_ROBOTS }, (_, i) => ({
    id: `DLV-${String(i + 1).padStart(3, '0')}`,
    successRate: i === 19 ? 0.3 : 0.85 + Math.random() * 0.14, // Robot 20 is an attacker (30%)
    isAttacker: i === 19,
    preferredZones: [i % zones.length, (i + 3) % zones.length, (i + 5) % zones.length],
    nightOperations: Math.floor(Math.random() * 40),
    fastOps: Math.floor(Math.random() * 15),
  }));

  it('Phase 1: Registration', () => {
    for (const robot of robotProfiles) {
      trustSystem.register(robot.id);
      streakSystem.register(robot.id);
    }
    for (const zone of zones) {
      zoneMastery.defineZone(zone.name, { min: zone.min, max: zone.max });
    }
    expect(trustSystem.robotCount).toBe(NUM_ROBOTS);
    expect(streakSystem.robotCount).toBe(NUM_ROBOTS);
    expect(zoneMastery.totalZones).toBe(8);
  });

  it('Phase 2: 90-day operation simulation', () => {
    const baseDate = new Date('2025-06-01T08:00:00Z').getTime();
    const simStats: Record<string, {
      totalOps: number;
      successes: number;
      failures: number;
      spoofAttempts: number;
      pointsEarned: number;
    }> = {};

    for (const robot of robotProfiles) {
      simStats[robot.id] = { totalOps: 0, successes: 0, failures: 0, spoofAttempts: 0, pointsEarned: 0 };
    }

    for (let day = 0; day < SIMULATION_DAYS; day++) {
      const dayTimestamp = baseDate + day * 86400000;

      for (const robot of robotProfiles) {
        const stats = simStats[robot.id]!;
        let daySuccess = true;

        for (let op = 0; op < OPS_PER_DAY; op++) {
          stats.totalOps++;
          const isSuccess = Math.random() < robot.successRate;
          const isSpoofAttempt = robot.isAttacker && Math.random() < 0.2;

          if (isSpoofAttempt) {
            stats.spoofAttempts++;
            trustSystem.recordFailure(robot.id, true);
            streakSystem.breakStreak(robot.id);
            daySuccess = false;
          } else if (isSuccess) {
            stats.successes++;
            const basePoints = 50;
            const streakResult = streakSystem.recordActivity(robot.id, basePoints, dayTimestamp);
            const totalEarned = streakResult.totalPoints;
            stats.pointsEarned += totalEarned;
            trustSystem.recordSuccess(robot.id, totalEarned);

            // Visit a zone
            const zoneIdx = robot.preferredZones[op % robot.preferredZones.length]!;
            const zone = zones[zoneIdx]!;
            const pos = {
              x: zone.min.x + Math.random() * (zone.max.x - zone.min.x),
              y: zone.min.y + Math.random() * (zone.max.y - zone.min.y),
              z: 1,
            };
            zoneMastery.recordVisit(robot.id, pos, true, totalEarned);
          } else {
            stats.failures++;
            trustSystem.recordFailure(robot.id, false);
            daySuccess = false;
          }
        }
      }
    }

    // Verify simulation completed
    const totalOps = Object.values(simStats).reduce((s, v) => s + v.totalOps, 0);
    expect(totalOps).toBe(NUM_ROBOTS * SIMULATION_DAYS * OPS_PER_DAY); // 14,400 operations
  });

  it('Phase 3: Badge evaluation', () => {
    for (const robot of robotProfiles) {
      const profile = trustSystem.getProfile(robot.id)!;
      const streakRecord = streakSystem.getRecord(robot.id)!;
      const metrics: RobotMetrics = {
        successful_verifications: profile.successfulVerifications,
        spoofing_incidents: profile.spoofingIncidents,
        threats_detected: 0,
        zones_mapped: zoneMastery.getZoneCount(robot.id),
        max_zone_mastery: zoneMastery.getMaxMastery(robot.id),
        unique_routes: Math.floor(profile.successfulVerifications * 0.3),
        consecutive_days: streakRecord.longestStreak,
        night_operations: robot.nightOperations,
        total_verifications: profile.totalVerifications,
        success_rate: profile.totalVerifications > 0
          ? (profile.successfulVerifications / profile.totalVerifications) * 100
          : 0,
        max_ssim: 0.85 + Math.random() * 0.14,
        max_zones_per_trip: robot.preferredZones.length,
        fast_operations: robot.fastOps,
      };
      badgeSystem.evaluate(robot.id, metrics);
    }

    // Top performers should have many badges
    const topRobot = robotProfiles[0]!;
    const topBadges = badgeSystem.getBadgeCount(topRobot.id);
    expect(topBadges).toBeGreaterThan(5);

    // Attacker should have fewer badges
    const attacker = robotProfiles.find(r => r.isAttacker)!;
    const attackerBadges = badgeSystem.getBadgeCount(attacker.id);
    expect(attackerBadges).toBeLessThan(topBadges);
  });

  it('Phase 4: Leaderboard generation', () => {
    for (const robot of robotProfiles) {
      const profile = trustSystem.getProfile(robot.id)!;
      const streakRecord = streakSystem.getRecord(robot.id)!;
      leaderboard.updateStats({
        robotId: robot.id,
        fleetId: FLEET_ID,
        trustTier: profile.currentTier,
        points: profile.points,
        totalVerifications: profile.totalVerifications,
        successfulVerifications: profile.successfulVerifications,
        zonesExplored: zoneMastery.getZoneCount(robot.id),
        badgeCount: badgeSystem.getBadgeCount(robot.id),
        streakDays: streakRecord.currentStreak,
        maxZoneMastery: zoneMastery.getMaxMastery(robot.id),
        spoofingIncidents: profile.spoofingIncidents,
      });
    }

    const board = leaderboard.getFleetLeaderboard(FLEET_ID, LeaderboardMetric.COMPOSITE);
    expect(board).toHaveLength(NUM_ROBOTS);

    // Attacker should be near bottom
    const attacker = robotProfiles.find(r => r.isAttacker)!;
    const attackerEntry = board.find(e => e.robotId === attacker.id)!;
    expect(attackerEntry.rank).toBeGreaterThan(NUM_ROBOTS / 2);

    // Top robot should be a high-performer
    const topEntry = board[0]!;
    expect(topEntry.score).toBeGreaterThan(0);
    expect(topEntry.spoofingIncidents).toBe(0);
  });

  it('Phase 5: Trust tier distribution analysis', () => {
    const tierCounts: Record<TrustTier, number> = {
      [TrustTier.UNTRUSTED]: 0,
      [TrustTier.PROBATION]: 0,
      [TrustTier.VERIFIED]: 0,
      [TrustTier.TRUSTED]: 0,
      [TrustTier.ELITE]: 0,
      [TrustTier.AUTONOMOUS]: 0,
    };

    for (const robot of robotProfiles) {
      const profile = trustSystem.getProfile(robot.id)!;
      tierCounts[profile.currentTier]++;
    }

    // After 90 days of mostly-successful operations:
    // Most robots should be at Verified or above
    const advancedCount = tierCounts[TrustTier.VERIFIED]
      + tierCounts[TrustTier.TRUSTED]
      + tierCounts[TrustTier.ELITE]
      + tierCounts[TrustTier.AUTONOMOUS];
    expect(advancedCount).toBeGreaterThan(NUM_ROBOTS / 2);

    // Attacker should be at low tier
    const attacker = robotProfiles.find(r => r.isAttacker)!;
    const attackerProfile = trustSystem.getProfile(attacker.id)!;
    expect(attackerProfile.currentTier).toBeLessThanOrEqual(TrustTier.PROBATION);
  });

  it('Phase 6: Fleet summary health check', () => {
    const summary = leaderboard.getFleetSummary(FLEET_ID);
    expect(summary.robotCount).toBe(NUM_ROBOTS);
    expect(summary.totalDeliveries).toBeGreaterThan(0);
    // Average success rate should reflect mostly-good fleet
    expect(summary.averageSuccessRate).toBeGreaterThan(0.7);
    expect(summary.topRobotId).toBeTruthy();
    expect(summary.totalZonesExplored).toBeGreaterThan(0);
  });

  it('Phase 7: Integrity verification', () => {
    // All tier histories should be valid
    for (const robot of robotProfiles) {
      const result = trustSystem.verifyHistory(robot.id);
      expect(result.valid).toBe(true);
    }

    // All badges should be authentic
    for (const robot of robotProfiles) {
      const result = badgeSystem.verifyAllBadges(robot.id);
      expect(result.valid).toBe(true);
      expect(result.forged).toHaveLength(0);
    }

    // All streak records should verify
    for (const robot of robotProfiles) {
      expect(streakSystem.verifyRecord(robot.id)).toBe(true);
    }

    // Leaderboard entries should be signed
    const board = leaderboard.getFleetLeaderboard(FLEET_ID);
    for (const entry of board) {
      expect(entry.signature).toHaveLength(64);
    }
  });

  it('Phase 8: Spatial verification integration', () => {
    // Run 10 real spatial verifications to ensure the pipeline works
    let passed = 0;
    let failed = 0;

    for (let i = 0; i < 10; i++) {
      const frame = makeFrame(i, i + 1);
      const identicalRender: RenderedView = {
        rgb: frame.rgb, depth: frame.depth!, width: 32, height: 32,
        pose: makePose(i, i), renderTimeMs: 1,
      };
      const proof = generateSpatialProof(
        'DLV-001', makePose(i, i), frame, identicalRender,
        'merkle-root', [], SECRET,
      );
      const integrity = verifySpatialProofIntegrity(proof, SECRET);
      expect(integrity.valid).toBe(true);

      if (proof.passed) {
        const settlement = createSettlement(proof, 15.00, 'USD', 'merchant-1', SECRET);
        expect(settlement.status).toBe('verified');
        passed++;
      } else {
        failed++;
      }
    }
    // With identical render/frame, all should pass
    expect(passed).toBe(10);
  });

  it('Phase 9: Performance benchmarks', () => {
    // Benchmark: badge evaluation for 20 robots
    const start1 = performance.now();
    for (let round = 0; round < 100; round++) {
      for (const robot of robotProfiles) {
        const profile = trustSystem.getProfile(robot.id)!;
        badgeSystem.evaluate(robot.id, {
          successful_verifications: profile.successfulVerifications,
          spoofing_incidents: profile.spoofingIncidents,
          threats_detected: 0, zones_mapped: 3, max_zone_mastery: 0.5,
          unique_routes: 10, consecutive_days: 30, night_operations: 5,
          total_verifications: profile.totalVerifications, success_rate: 90,
          max_ssim: 0.9, max_zones_per_trip: 2, fast_operations: 3,
        });
      }
    }
    const badgeEvalMs = performance.now() - start1;
    expect(badgeEvalMs).toBeLessThan(3000); // 2000 evaluations under 3s

    // Benchmark: leaderboard generation
    const start2 = performance.now();
    for (let round = 0; round < 100; round++) {
      leaderboard.getFleetLeaderboard(FLEET_ID, LeaderboardMetric.COMPOSITE);
    }
    const leaderboardMs = performance.now() - start2;
    expect(leaderboardMs).toBeLessThan(2000); // 100 leaderboard generations under 2s

    // Benchmark: spatial code computation
    const placeCells = new PlaceCellPopulation(2.0);
    placeCells.coverRegion({ x: 0, y: 0, z: 0 }, { x: 50, y: 50, z: 0 }, 3.0);
    const gridCells = new GridCellSystem(0.5, Math.SQRT2, 4, 16);
    const start3 = performance.now();
    for (let i = 0; i < 1000; i++) {
      computeSpatialCode({ x: Math.random() * 50, y: Math.random() * 50, z: 0 }, placeCells, gridCells);
    }
    const spatialCodeMs = performance.now() - start3;
    expect(spatialCodeMs).toBeLessThan(5000); // 1000 spatial codes under 5s
  });
});
