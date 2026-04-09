/**
 * Zone Mastery System — Geographic expertise tracking
 *
 * Maps WeMeetWeMet's venue collection to robot spatial knowledge:
 *   Zone = AABB region of space
 *   Mastery = coverage × success_rate × time_factor
 *   Higher mastery = more trusted operations in that zone
 */

import type { Vec3, AABB } from '../types/index.js';
import { vec3Distance } from '../utils/math.js';
import { hmacSign, generateNonce } from '../utils/crypto.js';

export interface Zone {
  readonly id: string;
  readonly name: string;
  readonly bounds: AABB;
  readonly createdAt: number;
}

export interface ZoneMasteryRecord {
  readonly zoneId: string;
  readonly robotId: string;
  readonly visitCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly totalPointsInZone: number;
  readonly uniquePositions: number;   // distinct locations visited (discretized)
  readonly firstVisit: number;
  readonly lastVisit: number;
}

export interface ZoneMasteryScore {
  readonly zoneId: string;
  readonly coverage: number;      // 0-1: how much of zone explored
  readonly successRate: number;    // 0-1: verification success rate
  readonly timeFactor: number;     // 0-1: recency + duration
  readonly composite: number;      // weighted combination
}

function positionKey(pos: Vec3, gridSize: number): string {
  const gx = Math.floor(pos.x / gridSize);
  const gy = Math.floor(pos.y / gridSize);
  const gz = Math.floor(pos.z / gridSize);
  return `${gx}:${gy}:${gz}`;
}

function isInBounds(pos: Vec3, bounds: AABB): boolean {
  return (
    pos.x >= bounds.min.x && pos.x <= bounds.max.x &&
    pos.y >= bounds.min.y && pos.y <= bounds.max.y &&
    pos.z >= bounds.min.z && pos.z <= bounds.max.z
  );
}

function zoneVolume(bounds: AABB): number {
  return (
    (bounds.max.x - bounds.min.x) *
    (bounds.max.y - bounds.min.y) *
    Math.max(1, bounds.max.z - bounds.min.z) // avoid zero for 2D zones
  );
}

export class ZoneMasterySystem {
  private readonly zones = new Map<string, Zone>();
  private readonly mastery = new Map<string, ZoneMasteryRecord>(); // "robotId:zoneId" → record
  private readonly visitedPositions = new Map<string, Set<string>>(); // "robotId:zoneId" → position keys
  private readonly secret: string;
  private readonly gridSize: number; // meters per cell for discretization

  constructor(secret: string, gridSize: number = 2.0) {
    if (!secret || secret.length < 32) {
      throw new Error('ZoneMasterySystem requires a secret of at least 32 chars');
    }
    this.secret = secret;
    this.gridSize = gridSize;
  }

  /**
   * Define a new zone
   */
  defineZone(name: string, bounds: AABB): Zone {
    if (!name) throw new Error('Zone name is required');
    if (bounds.min.x >= bounds.max.x || bounds.min.y >= bounds.max.y) {
      throw new Error('Invalid zone bounds: min must be less than max');
    }
    const zone: Zone = {
      id: generateNonce(8),
      name,
      bounds,
      createdAt: Date.now(),
    };
    this.zones.set(zone.id, zone);
    return zone;
  }

  /**
   * Find which zone a position belongs to (first match)
   */
  findZone(position: Vec3): Zone | undefined {
    for (const zone of this.zones.values()) {
      if (isInBounds(position, zone.bounds)) {
        return zone;
      }
    }
    return undefined;
  }

  /**
   * Find all zones a position belongs to
   */
  findAllZones(position: Vec3): Zone[] {
    const result: Zone[] = [];
    for (const zone of this.zones.values()) {
      if (isInBounds(position, zone.bounds)) {
        result.push(zone);
      }
    }
    return result;
  }

  /**
   * Record a robot visit to a position (auto-discovers zone)
   */
  recordVisit(
    robotId: string,
    position: Vec3,
    success: boolean,
    pointsEarned: number = 0,
  ): { zoneId: string | null; mastery: ZoneMasteryScore | null } {
    if (!robotId) throw new Error('robotId is required');

    const zone = this.findZone(position);
    if (!zone) return { zoneId: null, mastery: null };

    const key = `${robotId}:${zone.id}`;
    const existing = this.mastery.get(key);
    const posKey = positionKey(position, this.gridSize);

    // Track unique positions
    if (!this.visitedPositions.has(key)) {
      this.visitedPositions.set(key, new Set());
    }
    this.visitedPositions.get(key)!.add(posKey);
    const uniquePositions = this.visitedPositions.get(key)!.size;

    const now = Date.now();
    const record: ZoneMasteryRecord = {
      zoneId: zone.id,
      robotId,
      visitCount: (existing?.visitCount ?? 0) + 1,
      successCount: (existing?.successCount ?? 0) + (success ? 1 : 0),
      failureCount: (existing?.failureCount ?? 0) + (success ? 0 : 1),
      totalPointsInZone: (existing?.totalPointsInZone ?? 0) + pointsEarned,
      uniquePositions,
      firstVisit: existing?.firstVisit ?? now,
      lastVisit: now,
    };
    this.mastery.set(key, record);

    return { zoneId: zone.id, mastery: this.computeMastery(record, zone) };
  }

  /**
   * Compute mastery score for a robot in a zone
   */
  private computeMastery(record: ZoneMasteryRecord, zone: Zone): ZoneMasteryScore {
    // Coverage: unique cells / estimated total cells in zone
    const vol = zoneVolume(zone.bounds);
    const cellVol = this.gridSize * this.gridSize * Math.max(this.gridSize, 1);
    const estimatedCells = Math.max(1, Math.ceil(vol / cellVol));
    const coverage = Math.min(1, record.uniquePositions / estimatedCells);

    // Success rate
    const total = record.visitCount;
    const successRate = total > 0 ? record.successCount / total : 0;

    // Time factor: recency (exponential decay) + duration bonus
    const now = Date.now();
    const hoursSinceLastVisit = (now - record.lastVisit) / (1000 * 60 * 60);
    const recency = Math.exp(-hoursSinceLastVisit / 168); // half-life ~1 week
    const durationDays = (record.lastVisit - record.firstVisit) / (1000 * 60 * 60 * 24);
    const durationBonus = Math.min(0.5, durationDays / 60); // max 0.5 after 60 days
    const timeFactor = Math.min(1, recency * 0.6 + durationBonus + 0.1); // 0.1 base

    // Composite: coverage 40%, success rate 35%, time 25%
    const composite = coverage * 0.4 + successRate * 0.35 + timeFactor * 0.25;

    return {
      zoneId: record.zoneId,
      coverage,
      successRate,
      timeFactor,
      composite,
    };
  }

  /**
   * Get mastery score for a specific robot+zone
   */
  getMastery(robotId: string, zoneId: string): ZoneMasteryScore | undefined {
    const key = `${robotId}:${zoneId}`;
    const record = this.mastery.get(key);
    if (!record) return undefined;
    const zone = this.zones.get(zoneId);
    if (!zone) return undefined;
    return this.computeMastery(record, zone);
  }

  /**
   * Get all mastery scores for a robot
   */
  getAllMastery(robotId: string): ZoneMasteryScore[] {
    const scores: ZoneMasteryScore[] = [];
    for (const [key, record] of this.mastery.entries()) {
      if (!key.startsWith(`${robotId}:`)) continue;
      const zone = this.zones.get(record.zoneId);
      if (!zone) continue;
      scores.push(this.computeMastery(record, zone));
    }
    return scores;
  }

  /**
   * Get max mastery score across all zones for a robot
   */
  getMaxMastery(robotId: string): number {
    const scores = this.getAllMastery(robotId);
    if (scores.length === 0) return 0;
    return Math.max(...scores.map(s => s.composite));
  }

  /**
   * Get number of zones a robot has visited
   */
  getZoneCount(robotId: string): number {
    let count = 0;
    for (const key of this.mastery.keys()) {
      if (key.startsWith(`${robotId}:`)) count++;
    }
    return count;
  }

  /**
   * Sign a mastery snapshot for external verification
   */
  signMasterySnapshot(robotId: string): { scores: ZoneMasteryScore[]; signature: string } {
    const scores = this.getAllMastery(robotId);
    const payload = `mastery:${robotId}:${JSON.stringify(scores)}`;
    const signature = hmacSign(Buffer.from(payload), this.secret);
    return { scores, signature };
  }

  get totalZones(): number {
    return this.zones.size;
  }
}
