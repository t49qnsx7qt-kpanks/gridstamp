/**
 * Trust Tier System — Progressive robot trust based on verified operations
 *
 * Maps WeMeetWeMet's 5-level progression to robot fleet management:
 *   Untrusted → Probation → Verified → Trusted → Elite → Autonomous
 *
 * Each tier controls: fee multiplier, tx limits, verification frequency, autonomy level.
 * Tier changes are HMAC-signed to prevent forgery.
 */

import { hmacSign, hmacVerify, generateNonce, sha256 } from '../utils/crypto.js';

export enum TrustTier {
  UNTRUSTED = 0,
  PROBATION = 1,
  VERIFIED = 2,
  TRUSTED = 3,
  ELITE = 4,
  AUTONOMOUS = 5,
}

export interface TierConfig {
  readonly name: string;
  readonly minPoints: number;
  readonly feeMultiplier: number;       // 1.0 = base fee, lower = discount
  readonly maxTransactionAmount: number; // max single tx
  readonly verificationFrequency: number; // every N operations must verify
  readonly autonomyLevel: number;         // 0-100, how much unsupervised action
  readonly minStreakDays: number;          // minimum consecutive days for promotion
  readonly minBadges: number;             // minimum badges required
  readonly minZoneMastery: number;        // minimum zone mastery score [0,1]
}

export const TIER_CONFIGS: Readonly<Record<TrustTier, TierConfig>> = {
  [TrustTier.UNTRUSTED]: {
    name: 'Untrusted',
    minPoints: 0,
    feeMultiplier: 2.5,
    maxTransactionAmount: 10,
    verificationFrequency: 1,   // verify EVERY operation
    autonomyLevel: 0,
    minStreakDays: 0,
    minBadges: 0,
    minZoneMastery: 0,
  },
  [TrustTier.PROBATION]: {
    name: 'Probation',
    minPoints: 100,
    feeMultiplier: 2.0,
    maxTransactionAmount: 50,
    verificationFrequency: 1,
    autonomyLevel: 10,
    minStreakDays: 3,
    minBadges: 1,
    minZoneMastery: 0.1,
  },
  [TrustTier.VERIFIED]: {
    name: 'Verified',
    minPoints: 500,
    feeMultiplier: 1.5,
    maxTransactionAmount: 200,
    verificationFrequency: 3,   // every 3rd operation
    autonomyLevel: 40,
    minStreakDays: 7,
    minBadges: 3,
    minZoneMastery: 0.3,
  },
  [TrustTier.TRUSTED]: {
    name: 'Trusted',
    minPoints: 2000,
    feeMultiplier: 1.2,
    maxTransactionAmount: 1000,
    verificationFrequency: 5,
    autonomyLevel: 70,
    minStreakDays: 14,
    minBadges: 8,
    minZoneMastery: 0.5,
  },
  [TrustTier.ELITE]: {
    name: 'Elite',
    minPoints: 5000,
    feeMultiplier: 1.0,
    maxTransactionAmount: 5000,
    verificationFrequency: 10,
    autonomyLevel: 90,
    minStreakDays: 30,
    minBadges: 15,
    minZoneMastery: 0.7,
  },
  [TrustTier.AUTONOMOUS]: {
    name: 'Autonomous',
    minPoints: 10000,
    feeMultiplier: 0.8,           // discount for top-tier
    maxTransactionAmount: 25000,
    verificationFrequency: 20,    // spot checks only
    autonomyLevel: 100,
    minStreakDays: 60,
    minBadges: 20,
    minZoneMastery: 0.85,
  },
};

export interface TierChangeEvent {
  readonly id: string;
  readonly robotId: string;
  readonly previousTier: TrustTier;
  readonly newTier: TrustTier;
  readonly reason: string;
  readonly points: number;
  readonly timestamp: number;
  readonly signature: string; // HMAC-signed to prevent forgery
}

export interface RobotTrustProfile {
  readonly robotId: string;
  readonly currentTier: TrustTier;
  readonly points: number;
  readonly totalVerifications: number;
  readonly successfulVerifications: number;
  readonly failedVerifications: number;
  readonly spoofingIncidents: number;
  readonly consecutiveSuccesses: number;
  readonly history: readonly TierChangeEvent[];
  readonly createdAt: number;
  readonly lastActivityAt: number;
}

/**
 * Sign a tier change event to prevent forgery
 */
function signTierChange(
  robotId: string,
  previousTier: TrustTier,
  newTier: TrustTier,
  points: number,
  timestamp: number,
  secret: string,
): string {
  const payload = `tier-change:${robotId}:${previousTier}:${newTier}:${points}:${timestamp}`;
  return hmacSign(Buffer.from(payload), secret);
}

/**
 * Verify a tier change event signature
 */
export function verifyTierChange(event: TierChangeEvent, secret: string): boolean {
  const payload = `tier-change:${event.robotId}:${event.previousTier}:${event.newTier}:${event.points}:${event.timestamp}`;
  return hmacVerify(Buffer.from(payload), event.signature, secret);
}

export class TrustTierSystem {
  private readonly profiles = new Map<string, RobotTrustProfile>();
  private readonly secret: string;

  constructor(secret: string) {
    if (!secret || secret.length < 32) {
      throw new Error('TrustTierSystem requires a secret of at least 32 chars');
    }
    this.secret = secret;
  }

  /**
   * Register a new robot (starts at Untrusted)
   */
  register(robotId: string): RobotTrustProfile {
    if (!robotId || robotId.trim().length === 0) {
      throw new Error('robotId is required');
    }
    if (this.profiles.has(robotId)) {
      throw new Error(`Robot ${robotId} already registered`);
    }
    const now = Date.now();
    const profile: RobotTrustProfile = {
      robotId,
      currentTier: TrustTier.UNTRUSTED,
      points: 0,
      totalVerifications: 0,
      successfulVerifications: 0,
      failedVerifications: 0,
      spoofingIncidents: 0,
      consecutiveSuccesses: 0,
      history: [],
      createdAt: now,
      lastActivityAt: now,
    };
    this.profiles.set(robotId, profile);
    return profile;
  }

  /**
   * Get a robot's current trust profile
   */
  getProfile(robotId: string): RobotTrustProfile | undefined {
    return this.profiles.get(robotId);
  }

  /**
   * Record a successful spatial verification and award points
   */
  recordSuccess(robotId: string, pointsEarned: number): RobotTrustProfile {
    const profile = this.profiles.get(robotId);
    if (!profile) throw new Error(`Robot ${robotId} not registered`);
    if (pointsEarned < 0) throw new Error('Points earned must be non-negative');

    const updated: RobotTrustProfile = {
      ...profile,
      points: profile.points + pointsEarned,
      totalVerifications: profile.totalVerifications + 1,
      successfulVerifications: profile.successfulVerifications + 1,
      consecutiveSuccesses: profile.consecutiveSuccesses + 1,
      lastActivityAt: Date.now(),
    };
    this.profiles.set(robotId, updated);
    return this.checkPromotion(robotId);
  }

  /**
   * Record a failed verification — penalty + possible demotion
   */
  recordFailure(robotId: string, isSpoofingAttempt: boolean = false): RobotTrustProfile {
    const profile = this.profiles.get(robotId);
    if (!profile) throw new Error(`Robot ${robotId} not registered`);

    // Penalty: lose 10% of points on failure, 25% on spoofing
    const penalty = isSpoofingAttempt
      ? Math.floor(profile.points * 0.25)
      : Math.floor(profile.points * 0.10);

    const updated: RobotTrustProfile = {
      ...profile,
      points: Math.max(0, profile.points - penalty),
      totalVerifications: profile.totalVerifications + 1,
      failedVerifications: profile.failedVerifications + 1,
      spoofingIncidents: profile.spoofingIncidents + (isSpoofingAttempt ? 1 : 0),
      consecutiveSuccesses: 0, // reset streak
      lastActivityAt: Date.now(),
    };
    this.profiles.set(robotId, updated);
    return this.checkDemotion(robotId, isSpoofingAttempt);
  }

  /**
   * Check if robot qualifies for tier promotion
   */
  private checkPromotion(robotId: string): RobotTrustProfile {
    const profile = this.profiles.get(robotId)!;
    const currentTier = profile.currentTier;

    // Can't promote beyond Autonomous
    if (currentTier >= TrustTier.AUTONOMOUS) return profile;

    const nextTier = (currentTier + 1) as TrustTier;
    const nextConfig = TIER_CONFIGS[nextTier];

    // Check all promotion criteria
    if (profile.points < nextConfig.minPoints) return profile;

    // Success rate must be > 90% for promotion
    if (profile.totalVerifications > 0) {
      const successRate = profile.successfulVerifications / profile.totalVerifications;
      if (successRate < 0.9) return profile;
    }

    // No spoofing incidents allowed for Trusted+
    if (nextTier >= TrustTier.TRUSTED && profile.spoofingIncidents > 0) return profile;

    return this.changeTier(robotId, nextTier, 'Promotion: met all tier requirements');
  }

  /**
   * Check if robot should be demoted
   */
  private checkDemotion(robotId: string, wasSpoofing: boolean): RobotTrustProfile {
    const profile = this.profiles.get(robotId)!;
    const currentTier = profile.currentTier;

    // Can't demote below Untrusted
    if (currentTier <= TrustTier.UNTRUSTED) return profile;

    // Immediate demotion on spoofing if Trusted or above
    if (wasSpoofing && currentTier >= TrustTier.TRUSTED) {
      // Drop TWO tiers for spoofing at high trust
      const newTier = Math.max(TrustTier.UNTRUSTED, currentTier - 2) as TrustTier;
      return this.changeTier(robotId, newTier, 'Demotion: spoofing detected at high trust level');
    }

    // Demote if points dropped below current tier minimum
    const currentConfig = TIER_CONFIGS[currentTier];
    if (profile.points < currentConfig.minPoints) {
      const newTier = (currentTier - 1) as TrustTier;
      return this.changeTier(robotId, newTier, 'Demotion: points below tier minimum');
    }

    // Demote if success rate drops below 80%
    if (profile.totalVerifications >= 10) {
      const successRate = profile.successfulVerifications / profile.totalVerifications;
      if (successRate < 0.8) {
        const newTier = (currentTier - 1) as TrustTier;
        return this.changeTier(robotId, newTier, 'Demotion: success rate below 80%');
      }
    }

    return profile;
  }

  /**
   * Execute tier change with HMAC-signed event
   */
  private changeTier(robotId: string, newTier: TrustTier, reason: string): RobotTrustProfile {
    const profile = this.profiles.get(robotId)!;
    if (profile.currentTier === newTier) return profile;

    const now = Date.now();
    const signature = signTierChange(
      robotId,
      profile.currentTier,
      newTier,
      profile.points,
      now,
      this.secret,
    );

    const event: TierChangeEvent = {
      id: generateNonce(16),
      robotId,
      previousTier: profile.currentTier,
      newTier,
      reason,
      points: profile.points,
      timestamp: now,
      signature,
    };

    const updated: RobotTrustProfile = {
      ...profile,
      currentTier: newTier,
      history: [...profile.history, event],
    };
    this.profiles.set(robotId, updated);
    return updated;
  }

  /**
   * Get the fee multiplier for a robot
   */
  getFeeMultiplier(robotId: string): number {
    const profile = this.profiles.get(robotId);
    if (!profile) return TIER_CONFIGS[TrustTier.UNTRUSTED].feeMultiplier;
    return TIER_CONFIGS[profile.currentTier].feeMultiplier;
  }

  /**
   * Check if a transaction amount is within tier limits
   */
  isWithinLimits(robotId: string, amount: number): boolean {
    const profile = this.profiles.get(robotId);
    if (!profile) return amount <= TIER_CONFIGS[TrustTier.UNTRUSTED].maxTransactionAmount;
    return amount <= TIER_CONFIGS[profile.currentTier].maxTransactionAmount;
  }

  /**
   * Check if verification is required for this operation
   */
  requiresVerification(robotId: string, operationIndex: number): boolean {
    const profile = this.profiles.get(robotId);
    if (!profile) return true; // unknown robots always verify
    const freq = TIER_CONFIGS[profile.currentTier].verificationFrequency;
    return operationIndex % freq === 0;
  }

  /**
   * Get all registered robots count
   */
  get robotCount(): number {
    return this.profiles.size;
  }

  /**
   * Verify integrity of a robot's entire tier history
   */
  verifyHistory(robotId: string): { valid: boolean; invalidEvents: number[] } {
    const profile = this.profiles.get(robotId);
    if (!profile) return { valid: false, invalidEvents: [] };

    const invalidEvents: number[] = [];
    for (let i = 0; i < profile.history.length; i++) {
      if (!verifyTierChange(profile.history[i]!, this.secret)) {
        invalidEvents.push(i);
      }
    }
    return { valid: invalidEvents.length === 0, invalidEvents };
  }
}
