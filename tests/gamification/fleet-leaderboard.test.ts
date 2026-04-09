import { describe, it, expect } from 'vitest';
import {
  FleetLeaderboard,
  LeaderboardMetric,
  verifyLeaderboardEntry,
  type RobotStats,
} from '../../src/gamification/fleet-leaderboard.js';
import { TrustTier } from '../../src/gamification/trust-tiers.js';

const SECRET = 'a'.repeat(32);

function makeStats(overrides: Partial<RobotStats> = {}): RobotStats {
  return {
    robotId: 'robot-1',
    fleetId: 'fleet-A',
    trustTier: TrustTier.VERIFIED,
    points: 500,
    totalVerifications: 100,
    successfulVerifications: 95,
    zonesExplored: 10,
    badgeCount: 5,
    streakDays: 14,
    maxZoneMastery: 0.6,
    spoofingIncidents: 0,
    ...overrides,
  };
}

describe('FleetLeaderboard', () => {
  it('requires 32-char secret', () => {
    expect(() => new FleetLeaderboard('short')).toThrow('32 chars');
  });

  it('updates stats and generates leaderboard', () => {
    const lb = new FleetLeaderboard(SECRET);
    lb.updateStats(makeStats({ robotId: 'r1', points: 1000 }));
    lb.updateStats(makeStats({ robotId: 'r2', points: 500 }));
    lb.updateStats(makeStats({ robotId: 'r3', points: 750 }));

    const board = lb.getFleetLeaderboard('fleet-A', LeaderboardMetric.TRUST_SCORE);
    expect(board).toHaveLength(3);
    expect(board[0]!.robotId).toBe('r1'); // highest trust score
    expect(board[0]!.rank).toBe(1);
    expect(board[1]!.rank).toBe(2);
    expect(board[2]!.rank).toBe(3);
  });

  it('entries are HMAC-signed', () => {
    const lb = new FleetLeaderboard(SECRET);
    lb.updateStats(makeStats({ robotId: 'r1' }));
    const board = lb.getFleetLeaderboard('fleet-A');
    expect(verifyLeaderboardEntry(board[0]!, SECRET)).toBe(true);
    expect(verifyLeaderboardEntry(board[0]!, 'b'.repeat(32))).toBe(false);
  });

  it('filters by fleet', () => {
    const lb = new FleetLeaderboard(SECRET);
    lb.updateStats(makeStats({ robotId: 'r1', fleetId: 'fleet-A' }));
    lb.updateStats(makeStats({ robotId: 'r2', fleetId: 'fleet-B' }));
    const boardA = lb.getFleetLeaderboard('fleet-A');
    expect(boardA).toHaveLength(1);
    expect(boardA[0]!.robotId).toBe('r1');
  });

  it('global leaderboard includes all fleets', () => {
    const lb = new FleetLeaderboard(SECRET);
    lb.updateStats(makeStats({ robotId: 'r1', fleetId: 'fleet-A', points: 1000 }));
    lb.updateStats(makeStats({ robotId: 'r2', fleetId: 'fleet-B', points: 2000 }));
    const board = lb.getGlobalLeaderboard(LeaderboardMetric.TRUST_SCORE);
    expect(board).toHaveLength(2);
    expect(board[0]!.robotId).toBe('r2'); // highest points
  });

  it('respects limit parameter', () => {
    const lb = new FleetLeaderboard(SECRET);
    for (let i = 0; i < 10; i++) {
      lb.updateStats(makeStats({ robotId: `r${i}`, points: i * 100 }));
    }
    const board = lb.getFleetLeaderboard('fleet-A', LeaderboardMetric.COMPOSITE, 3);
    expect(board).toHaveLength(3);
  });

  it('rejects invalid limit', () => {
    const lb = new FleetLeaderboard(SECRET);
    expect(() => lb.getFleetLeaderboard('fleet-A', LeaderboardMetric.COMPOSITE, 0)).toThrow('positive');
  });

  it('composite score weights correctly', () => {
    const lb = new FleetLeaderboard(SECRET);
    // Robot with high trust but low deliveries
    lb.updateStats(makeStats({
      robotId: 'high-trust',
      trustTier: TrustTier.ELITE,
      totalVerifications: 10,
      successfulVerifications: 10,
      points: 5000,
    }));
    // Robot with many deliveries but lower trust
    lb.updateStats(makeStats({
      robotId: 'high-volume',
      trustTier: TrustTier.PROBATION,
      totalVerifications: 200,
      successfulVerifications: 180,
      points: 200,
    }));
    const board = lb.getFleetLeaderboard('fleet-A', LeaderboardMetric.COMPOSITE);
    expect(board).toHaveLength(2);
    // Both should have non-zero scores
    expect(board[0]!.score).toBeGreaterThan(0);
    expect(board[1]!.score).toBeGreaterThan(0);
  });

  it('safety metric penalizes spoofing', () => {
    const lb = new FleetLeaderboard(SECRET);
    lb.updateStats(makeStats({ robotId: 'clean', spoofingIncidents: 0 }));
    lb.updateStats(makeStats({ robotId: 'dirty', spoofingIncidents: 5 }));
    const board = lb.getFleetLeaderboard('fleet-A', LeaderboardMetric.SAFETY_RECORD);
    expect(board[0]!.robotId).toBe('clean');
  });

  it('getFleetSummary aggregates correctly', () => {
    const lb = new FleetLeaderboard(SECRET);
    lb.updateStats(makeStats({ robotId: 'r1', points: 1000, totalVerifications: 100, successfulVerifications: 90, zonesExplored: 5 }));
    lb.updateStats(makeStats({ robotId: 'r2', points: 500, totalVerifications: 50, successfulVerifications: 45, zonesExplored: 3 }));

    const summary = lb.getFleetSummary('fleet-A');
    expect(summary.robotCount).toBe(2);
    expect(summary.averageTrustScore).toBe(750); // (1000+500)/2
    expect(summary.totalDeliveries).toBe(135); // 90+45
    expect(summary.averageSuccessRate).toBe(135 / 150); // 135/150
    expect(summary.topRobotId).toBeTruthy();
  });

  it('getFleetSummary handles empty fleet', () => {
    const lb = new FleetLeaderboard(SECRET);
    const summary = lb.getFleetSummary('empty-fleet');
    expect(summary.robotCount).toBe(0);
    expect(summary.topRobotId).toBeNull();
  });

  it('getRobotRank returns correct rank', () => {
    const lb = new FleetLeaderboard(SECRET);
    lb.updateStats(makeStats({ robotId: 'r1', points: 1000 }));
    lb.updateStats(makeStats({ robotId: 'r2', points: 500 }));
    lb.updateStats(makeStats({ robotId: 'r3', points: 750 }));
    expect(lb.getRobotRank('r1', LeaderboardMetric.TRUST_SCORE)).toBe(1);
    expect(lb.getRobotRank('r3', LeaderboardMetric.TRUST_SCORE)).toBe(2);
    expect(lb.getRobotRank('r2', LeaderboardMetric.TRUST_SCORE)).toBe(3);
  });

  it('getRobotRank returns null for unknown robot', () => {
    const lb = new FleetLeaderboard(SECRET);
    expect(lb.getRobotRank('unknown')).toBeNull();
  });

  it('tracks total robots', () => {
    const lb = new FleetLeaderboard(SECRET);
    expect(lb.totalRobots).toBe(0);
    lb.updateStats(makeStats({ robotId: 'r1' }));
    lb.updateStats(makeStats({ robotId: 'r2' }));
    expect(lb.totalRobots).toBe(2);
  });

  it('rejects empty fleetId', () => {
    const lb = new FleetLeaderboard(SECRET);
    expect(() => lb.getFleetLeaderboard('')).toThrow('fleetId is required');
  });

  it('rejects empty robotId in stats', () => {
    const lb = new FleetLeaderboard(SECRET);
    expect(() => lb.updateStats(makeStats({ robotId: '' }))).toThrow('robotId is required');
  });

  it('zone coverage metric sorts by exploration', () => {
    const lb = new FleetLeaderboard(SECRET);
    lb.updateStats(makeStats({ robotId: 'explorer', zonesExplored: 50, maxZoneMastery: 0.9 }));
    lb.updateStats(makeStats({ robotId: 'homebody', zonesExplored: 2, maxZoneMastery: 0.1 }));
    const board = lb.getFleetLeaderboard('fleet-A', LeaderboardMetric.ZONE_COVERAGE);
    expect(board[0]!.robotId).toBe('explorer');
  });
});
