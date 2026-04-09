/**
 * Fleet Leaderboard — Competitive ranking across robot fleets
 *
 * Maps WeMeetWeMet's city/state/national leaderboard to fleet management.
 * Fleet operators compare robots by: trust, deliveries, zones, safety.
 * Time periods: daily, weekly, monthly, all-time.
 * Entries are HMAC-signed to prevent tampering.
 */

import { hmacSign, hmacVerify, generateNonce } from '../utils/crypto.js';
import { TrustTier } from './trust-tiers.js';

export enum LeaderboardPeriod {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  ALL_TIME = 'all-time',
}

export enum LeaderboardMetric {
  TRUST_SCORE = 'trust_score',
  DELIVERIES = 'deliveries',
  ZONE_COVERAGE = 'zone_coverage',
  SAFETY_RECORD = 'safety_record',
  COMPOSITE = 'composite',
}

export interface LeaderboardEntry {
  readonly robotId: string;
  readonly fleetId: string;
  readonly rank: number;
  readonly score: number;
  readonly trustTier: TrustTier;
  readonly totalVerifications: number;
  readonly successRate: number;
  readonly zonesExplored: number;
  readonly badgeCount: number;
  readonly streakDays: number;
  readonly maxZoneMastery: number;
  readonly spoofingIncidents: number;
  readonly timestamp: number;
  readonly signature: string;
}

export interface RobotStats {
  readonly robotId: string;
  readonly fleetId: string;
  readonly trustTier: TrustTier;
  readonly points: number;
  readonly totalVerifications: number;
  readonly successfulVerifications: number;
  readonly zonesExplored: number;
  readonly badgeCount: number;
  readonly streakDays: number;
  readonly maxZoneMastery: number;
  readonly spoofingIncidents: number;
}

export interface FleetSummary {
  readonly fleetId: string;
  readonly robotCount: number;
  readonly averageTrustScore: number;
  readonly totalDeliveries: number;
  readonly averageSuccessRate: number;
  readonly totalZonesExplored: number;
  readonly topRobotId: string | null;
}

function signEntry(entry: Omit<LeaderboardEntry, 'signature'>, secret: string): string {
  const payload = `lb:${entry.robotId}:${entry.fleetId}:${entry.rank}:${entry.score}:${entry.timestamp}`;
  return hmacSign(Buffer.from(payload), secret);
}

export function verifyLeaderboardEntry(entry: LeaderboardEntry, secret: string): boolean {
  const payload = `lb:${entry.robotId}:${entry.fleetId}:${entry.rank}:${entry.score}:${entry.timestamp}`;
  return hmacVerify(Buffer.from(payload), entry.signature, secret);
}

function computeCompositeScore(stats: RobotStats): number {
  const successRate = stats.totalVerifications > 0
    ? stats.successfulVerifications / stats.totalVerifications
    : 0;

  // Weighted composite:
  // Trust tier contribution: 25%
  const trustScore = (stats.trustTier / TrustTier.AUTONOMOUS) * 100;
  // Delivery volume: 25%
  const deliveryScore = Math.min(100, stats.totalVerifications / 100 * 100);
  // Success rate: 25%
  const rateScore = successRate * 100;
  // Safety: 15% (penalize spoofing)
  const safetyScore = Math.max(0, 100 - stats.spoofingIncidents * 20);
  // Zone mastery: 10%
  const zoneScore = stats.maxZoneMastery * 100;

  return trustScore * 0.25 + deliveryScore * 0.25 + rateScore * 0.25 + safetyScore * 0.15 + zoneScore * 0.10;
}

function computeMetricScore(stats: RobotStats, metric: LeaderboardMetric): number {
  switch (metric) {
    case LeaderboardMetric.TRUST_SCORE:
      return stats.points;
    case LeaderboardMetric.DELIVERIES:
      return stats.successfulVerifications;
    case LeaderboardMetric.ZONE_COVERAGE:
      return stats.zonesExplored + stats.maxZoneMastery * 100;
    case LeaderboardMetric.SAFETY_RECORD: {
      const successRate = stats.totalVerifications > 0
        ? stats.successfulVerifications / stats.totalVerifications
        : 0;
      return successRate * 100 - stats.spoofingIncidents * 10;
    }
    case LeaderboardMetric.COMPOSITE:
      return computeCompositeScore(stats);
  }
}

export class FleetLeaderboard {
  private readonly robotStats = new Map<string, RobotStats>();
  private readonly secret: string;

  constructor(secret: string) {
    if (!secret || secret.length < 32) {
      throw new Error('FleetLeaderboard requires a secret of at least 32 chars');
    }
    this.secret = secret;
  }

  /**
   * Update stats for a robot
   */
  updateStats(stats: RobotStats): void {
    if (!stats.robotId) throw new Error('robotId is required');
    if (!stats.fleetId) throw new Error('fleetId is required');
    this.robotStats.set(stats.robotId, stats);
  }

  /**
   * Generate ranked leaderboard for a fleet
   */
  getFleetLeaderboard(
    fleetId: string,
    metric: LeaderboardMetric = LeaderboardMetric.COMPOSITE,
    limit: number = 50,
  ): readonly LeaderboardEntry[] {
    if (!fleetId) throw new Error('fleetId is required');
    if (limit <= 0) throw new Error('limit must be positive');

    const fleetRobots: RobotStats[] = [];
    for (const stats of this.robotStats.values()) {
      if (stats.fleetId === fleetId) {
        fleetRobots.push(stats);
      }
    }

    // Sort by metric score descending
    const scored = fleetRobots
      .map(stats => ({ stats, score: computeMetricScore(stats, metric) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const now = Date.now();
    return scored.map(({ stats, score }, index) => {
      const successRate = stats.totalVerifications > 0
        ? stats.successfulVerifications / stats.totalVerifications
        : 0;

      const entry: Omit<LeaderboardEntry, 'signature'> = {
        robotId: stats.robotId,
        fleetId: stats.fleetId,
        rank: index + 1,
        score,
        trustTier: stats.trustTier,
        totalVerifications: stats.totalVerifications,
        successRate,
        zonesExplored: stats.zonesExplored,
        badgeCount: stats.badgeCount,
        streakDays: stats.streakDays,
        maxZoneMastery: stats.maxZoneMastery,
        spoofingIncidents: stats.spoofingIncidents,
        timestamp: now,
      };
      return { ...entry, signature: signEntry(entry, this.secret) };
    });
  }

  /**
   * Generate global leaderboard across all fleets
   */
  getGlobalLeaderboard(
    metric: LeaderboardMetric = LeaderboardMetric.COMPOSITE,
    limit: number = 100,
  ): readonly LeaderboardEntry[] {
    if (limit <= 0) throw new Error('limit must be positive');

    const all = Array.from(this.robotStats.values());
    const scored = all
      .map(stats => ({ stats, score: computeMetricScore(stats, metric) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const now = Date.now();
    return scored.map(({ stats, score }, index) => {
      const successRate = stats.totalVerifications > 0
        ? stats.successfulVerifications / stats.totalVerifications
        : 0;

      const entry: Omit<LeaderboardEntry, 'signature'> = {
        robotId: stats.robotId,
        fleetId: stats.fleetId,
        rank: index + 1,
        score,
        trustTier: stats.trustTier,
        totalVerifications: stats.totalVerifications,
        successRate,
        zonesExplored: stats.zonesExplored,
        badgeCount: stats.badgeCount,
        streakDays: stats.streakDays,
        maxZoneMastery: stats.maxZoneMastery,
        spoofingIncidents: stats.spoofingIncidents,
        timestamp: now,
      };
      return { ...entry, signature: signEntry(entry, this.secret) };
    });
  }

  /**
   * Get fleet summary
   */
  getFleetSummary(fleetId: string): FleetSummary {
    if (!fleetId) throw new Error('fleetId is required');

    const fleetRobots: RobotStats[] = [];
    for (const stats of this.robotStats.values()) {
      if (stats.fleetId === fleetId) fleetRobots.push(stats);
    }

    if (fleetRobots.length === 0) {
      return {
        fleetId,
        robotCount: 0,
        averageTrustScore: 0,
        totalDeliveries: 0,
        averageSuccessRate: 0,
        totalZonesExplored: 0,
        topRobotId: null,
      };
    }

    const totalPoints = fleetRobots.reduce((s, r) => s + r.points, 0);
    const totalVerifications = fleetRobots.reduce((s, r) => s + r.totalVerifications, 0);
    const totalSuccesses = fleetRobots.reduce((s, r) => s + r.successfulVerifications, 0);
    const allZones = new Set<number>();
    fleetRobots.forEach(r => { for (let i = 0; i < r.zonesExplored; i++) allZones.add(i); });

    // Find top robot by composite score
    let topRobot = fleetRobots[0]!;
    let topScore = computeCompositeScore(topRobot);
    for (const robot of fleetRobots) {
      const score = computeCompositeScore(robot);
      if (score > topScore) {
        topRobot = robot;
        topScore = score;
      }
    }

    return {
      fleetId,
      robotCount: fleetRobots.length,
      averageTrustScore: totalPoints / fleetRobots.length,
      totalDeliveries: totalSuccesses,
      averageSuccessRate: totalVerifications > 0 ? totalSuccesses / totalVerifications : 0,
      totalZonesExplored: fleetRobots.reduce((s, r) => s + r.zonesExplored, 0),
      topRobotId: topRobot.robotId,
    };
  }

  /**
   * Get rank of a specific robot
   */
  getRobotRank(robotId: string, metric: LeaderboardMetric = LeaderboardMetric.COMPOSITE): number | null {
    const stats = this.robotStats.get(robotId);
    if (!stats) return null;

    const leaderboard = this.getFleetLeaderboard(stats.fleetId, metric, 1000);
    const entry = leaderboard.find(e => e.robotId === robotId);
    return entry?.rank ?? null;
  }

  get totalRobots(): number {
    return this.robotStats.size;
  }
}
