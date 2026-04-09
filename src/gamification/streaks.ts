/**
 * Streak Multiplier System — Reward consistent daily operation
 *
 * Maps WeMeetWeMet's streak system:
 *   Consecutive verified days → multiplier bonus → trust acceleration
 *   Streak freeze available at a point cost (max 2/month)
 *   Break = reset to 0, trust penalty applied
 */

import { hmacSign, hmacVerify } from '../utils/crypto.js';

export interface StreakRecord {
  readonly robotId: string;
  readonly currentStreak: number;        // consecutive days
  readonly longestStreak: number;
  readonly lastActivityDate: string;     // YYYY-MM-DD (UTC)
  readonly freezesUsedThisMonth: number;
  readonly freezeMonth: string;          // YYYY-MM for freeze tracking
  readonly totalPointsFromStreaks: number;
  readonly signature: string;            // HMAC of current state
}

export interface StreakConfig {
  readonly maxMultiplier: number;        // cap (default 2.0)
  readonly multiplierStep: number;       // per day (default 0.1)
  readonly baseMultiplier: number;       // starting (default 1.0)
  readonly maxFreezesPerMonth: number;   // default 2
  readonly freezeCostPoints: number;     // default 500
  readonly breakPenaltyPercent: number;  // % of points lost on break (default 5)
}

const DEFAULT_CONFIG: StreakConfig = {
  maxMultiplier: 2.0,
  multiplierStep: 0.1,
  baseMultiplier: 1.0,
  maxFreezesPerMonth: 2,
  freezeCostPoints: 500,
  breakPenaltyPercent: 5,
};

function getUTCDateString(timestamp?: number): string {
  const d = timestamp ? new Date(timestamp) : new Date();
  return d.toISOString().split('T')[0]!;
}

function getUTCMonthString(timestamp?: number): string {
  const d = timestamp ? new Date(timestamp) : new Date();
  return d.toISOString().slice(0, 7); // YYYY-MM
}

function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA + 'T00:00:00Z').getTime();
  const b = new Date(dateB + 'T00:00:00Z').getTime();
  return Math.abs(Math.round((b - a) / (24 * 60 * 60 * 1000)));
}

function signStreak(record: Omit<StreakRecord, 'signature'>, secret: string): string {
  const payload = `streak:${record.robotId}:${record.currentStreak}:${record.longestStreak}:${record.lastActivityDate}:${record.totalPointsFromStreaks}`;
  return hmacSign(Buffer.from(payload), secret);
}

export class StreakSystem {
  private readonly records = new Map<string, StreakRecord>();
  private readonly secret: string;
  private readonly config: StreakConfig;

  constructor(secret: string, config?: Partial<StreakConfig>) {
    if (!secret || secret.length < 32) {
      throw new Error('StreakSystem requires a secret of at least 32 chars');
    }
    this.secret = secret;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register a robot for streak tracking
   */
  register(robotId: string): StreakRecord {
    if (!robotId) throw new Error('robotId is required');
    if (this.records.has(robotId)) throw new Error(`Robot ${robotId} already registered`);

    const record: Omit<StreakRecord, 'signature'> = {
      robotId,
      currentStreak: 0,
      longestStreak: 0,
      lastActivityDate: '',
      freezesUsedThisMonth: 0,
      freezeMonth: getUTCMonthString(),
      totalPointsFromStreaks: 0,
    };
    const signed: StreakRecord = { ...record, signature: signStreak(record, this.secret) };
    this.records.set(robotId, signed);
    return signed;
  }

  /**
   * Record daily activity — extends or starts streak
   * Returns: { streakDays, multiplier, bonusPoints }
   */
  recordActivity(
    robotId: string,
    basePoints: number,
    now?: number,
  ): { streakDays: number; multiplier: number; bonusPoints: number; totalPoints: number } {
    const record = this.records.get(robotId);
    if (!record) throw new Error(`Robot ${robotId} not registered`);
    if (basePoints < 0) throw new Error('basePoints must be non-negative');

    const today = getUTCDateString(now);
    const currentMonth = getUTCMonthString(now);

    // Reset freeze counter if new month
    let freezesUsed = record.freezesUsedThisMonth;
    let freezeMonth = record.freezeMonth;
    if (currentMonth !== record.freezeMonth) {
      freezesUsed = 0;
      freezeMonth = currentMonth;
    }

    let newStreak: number;

    if (record.lastActivityDate === '') {
      // First activity ever
      newStreak = 1;
    } else if (record.lastActivityDate === today) {
      // Already recorded today — no streak change, just return current
      newStreak = record.currentStreak;
    } else {
      const gap = daysBetween(record.lastActivityDate, today);
      if (gap === 1) {
        // Consecutive day — extend streak
        newStreak = record.currentStreak + 1;
      } else if (gap === 0) {
        // Same day
        newStreak = record.currentStreak;
      } else {
        // Gap detected — streak broken
        newStreak = 1; // restart
      }
    }

    const multiplier = this.calculateMultiplier(newStreak);
    const bonusPoints = Math.round(basePoints * (multiplier - 1));
    const totalPoints = basePoints + bonusPoints;

    const updated: Omit<StreakRecord, 'signature'> = {
      robotId,
      currentStreak: newStreak,
      longestStreak: Math.max(record.longestStreak, newStreak),
      lastActivityDate: today,
      freezesUsedThisMonth: freezesUsed,
      freezeMonth,
      totalPointsFromStreaks: record.totalPointsFromStreaks + bonusPoints,
    };
    this.records.set(robotId, { ...updated, signature: signStreak(updated, this.secret) });

    return { streakDays: newStreak, multiplier, bonusPoints, totalPoints };
  }

  /**
   * Use a streak freeze to preserve streak during a missed day
   * Returns true if freeze applied, false if not available
   */
  useFreeze(robotId: string, currentPoints: number, now?: number): { applied: boolean; pointsDeducted: number } {
    const record = this.records.get(robotId);
    if (!record) throw new Error(`Robot ${robotId} not registered`);

    const currentMonth = getUTCMonthString(now);
    let freezesUsed = record.freezesUsedThisMonth;
    let freezeMonth = record.freezeMonth;

    // Reset if new month
    if (currentMonth !== record.freezeMonth) {
      freezesUsed = 0;
      freezeMonth = currentMonth;
    }

    // Check if freeze is available
    if (freezesUsed >= this.config.maxFreezesPerMonth) {
      return { applied: false, pointsDeducted: 0 };
    }

    // Check if robot can afford the freeze
    if (currentPoints < this.config.freezeCostPoints) {
      return { applied: false, pointsDeducted: 0 };
    }

    // Apply freeze — streak is preserved, points deducted
    const updated: Omit<StreakRecord, 'signature'> = {
      ...record,
      freezesUsedThisMonth: freezesUsed + 1,
      freezeMonth,
    };
    this.records.set(robotId, { ...updated, signature: signStreak(updated, this.secret) });

    return { applied: true, pointsDeducted: this.config.freezeCostPoints };
  }

  /**
   * Force break a streak (called on verification failure or spoofing)
   */
  breakStreak(robotId: string): { penaltyPercent: number } {
    const record = this.records.get(robotId);
    if (!record) throw new Error(`Robot ${robotId} not registered`);

    const updated: Omit<StreakRecord, 'signature'> = {
      ...record,
      currentStreak: 0,
    };
    this.records.set(robotId, { ...updated, signature: signStreak(updated, this.secret) });

    return { penaltyPercent: this.config.breakPenaltyPercent };
  }

  /**
   * Calculate multiplier for a given streak length
   */
  calculateMultiplier(streakDays: number): number {
    const raw = this.config.baseMultiplier + (streakDays * this.config.multiplierStep);
    return Math.min(raw, this.config.maxMultiplier);
  }

  /**
   * Get current streak record
   */
  getRecord(robotId: string): StreakRecord | undefined {
    return this.records.get(robotId);
  }

  /**
   * Verify integrity of a streak record
   */
  verifyRecord(robotId: string): boolean {
    const record = this.records.get(robotId);
    if (!record) return false;
    const { signature, ...rest } = record;
    return signStreak(rest, this.secret) === signature;
  }

  get robotCount(): number {
    return this.records.size;
  }
}
