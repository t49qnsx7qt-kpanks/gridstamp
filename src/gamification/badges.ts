/**
 * Capability Badge System — Achievement tracking for robots
 *
 * Maps WeMeetWeMet's 25+ badges to robot operational achievements.
 * Badges are HMAC-signed to prevent forgery.
 * Categories: operational, safety, navigation, endurance, special
 */

import { hmacSign, hmacVerify, generateNonce } from '../utils/crypto.js';

export enum BadgeCategory {
  OPERATIONAL = 'operational',
  SAFETY = 'safety',
  NAVIGATION = 'navigation',
  ENDURANCE = 'endurance',
  SPECIAL = 'special',
}

export enum BadgeRarity {
  COMMON = 'common',       // easy to earn
  UNCOMMON = 'uncommon',   // requires consistent performance
  RARE = 'rare',           // significant achievement
  EPIC = 'epic',           // exceptional performance
  LEGENDARY = 'legendary', // near-impossible feats
}

export interface BadgeDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: BadgeCategory;
  readonly rarity: BadgeRarity;
  readonly criteria: BadgeCriteria;
  readonly pointValue: number; // points awarded when earned
}

export interface BadgeCriteria {
  readonly type: 'count' | 'streak' | 'rate' | 'threshold' | 'compound';
  readonly metric: string;
  readonly target: number;
  readonly secondaryMetric?: string;
  readonly secondaryTarget?: number;
}

export interface EarnedBadge {
  readonly badgeId: string;
  readonly robotId: string;
  readonly earnedAt: number;
  readonly signature: string; // HMAC-signed proof of earning
  readonly metadata?: Record<string, number>; // stats at time of earning
}

// ============================================================
// BADGE CATALOG
// ============================================================

export const BADGE_CATALOG: readonly BadgeDefinition[] = [
  // OPERATIONAL
  {
    id: 'first-delivery',
    name: 'First Delivery',
    description: 'Complete your first verified spatial delivery',
    category: BadgeCategory.OPERATIONAL,
    rarity: BadgeRarity.COMMON,
    criteria: { type: 'count', metric: 'successful_verifications', target: 1 },
    pointValue: 50,
  },
  {
    id: 'century-club',
    name: 'Century Club',
    description: 'Complete 100 verified operations',
    category: BadgeCategory.OPERATIONAL,
    rarity: BadgeRarity.UNCOMMON,
    criteria: { type: 'count', metric: 'successful_verifications', target: 100 },
    pointValue: 200,
  },
  {
    id: 'thousand-strong',
    name: 'Thousand Strong',
    description: 'Complete 1,000 verified operations',
    category: BadgeCategory.OPERATIONAL,
    rarity: BadgeRarity.RARE,
    criteria: { type: 'count', metric: 'successful_verifications', target: 1000 },
    pointValue: 500,
  },
  {
    id: 'ten-thousand-veteran',
    name: 'Ten Thousand Veteran',
    description: 'Complete 10,000 verified operations',
    category: BadgeCategory.OPERATIONAL,
    rarity: BadgeRarity.LEGENDARY,
    criteria: { type: 'count', metric: 'successful_verifications', target: 10000 },
    pointValue: 2000,
  },

  // SAFETY
  {
    id: 'clean-record',
    name: 'Clean Record',
    description: '50 operations with zero spoofing incidents',
    category: BadgeCategory.SAFETY,
    rarity: BadgeRarity.UNCOMMON,
    criteria: {
      type: 'compound',
      metric: 'successful_verifications',
      target: 50,
      secondaryMetric: 'spoofing_incidents',
      secondaryTarget: 0,
    },
    pointValue: 300,
  },
  {
    id: 'impenetrable',
    name: 'Impenetrable',
    description: '500 operations, zero security incidents',
    category: BadgeCategory.SAFETY,
    rarity: BadgeRarity.EPIC,
    criteria: {
      type: 'compound',
      metric: 'successful_verifications',
      target: 500,
      secondaryMetric: 'spoofing_incidents',
      secondaryTarget: 0,
    },
    pointValue: 1000,
  },
  {
    id: 'fraud-detector',
    name: 'Fraud Detector',
    description: 'Detect and report 10 adversarial attacks',
    category: BadgeCategory.SAFETY,
    rarity: BadgeRarity.RARE,
    criteria: { type: 'count', metric: 'threats_detected', target: 10 },
    pointValue: 400,
  },

  // NAVIGATION
  {
    id: 'explorer',
    name: 'Explorer',
    description: 'Map 5 distinct zones',
    category: BadgeCategory.NAVIGATION,
    rarity: BadgeRarity.COMMON,
    criteria: { type: 'count', metric: 'zones_mapped', target: 5 },
    pointValue: 100,
  },
  {
    id: 'cartographer',
    name: 'Cartographer',
    description: 'Map 25 distinct zones',
    category: BadgeCategory.NAVIGATION,
    rarity: BadgeRarity.UNCOMMON,
    criteria: { type: 'count', metric: 'zones_mapped', target: 25 },
    pointValue: 300,
  },
  {
    id: 'globe-trotter',
    name: 'Globe Trotter',
    description: 'Map 100 distinct zones',
    category: BadgeCategory.NAVIGATION,
    rarity: BadgeRarity.RARE,
    criteria: { type: 'count', metric: 'zones_mapped', target: 100 },
    pointValue: 750,
  },
  {
    id: 'zone-master',
    name: 'Zone Master',
    description: 'Achieve 90%+ mastery in any single zone',
    category: BadgeCategory.NAVIGATION,
    rarity: BadgeRarity.RARE,
    criteria: { type: 'threshold', metric: 'max_zone_mastery', target: 0.9 },
    pointValue: 500,
  },
  {
    id: 'pathfinder',
    name: 'Pathfinder',
    description: 'Successfully navigate 50 unique routes',
    category: BadgeCategory.NAVIGATION,
    rarity: BadgeRarity.UNCOMMON,
    criteria: { type: 'count', metric: 'unique_routes', target: 50 },
    pointValue: 200,
  },

  // ENDURANCE
  {
    id: 'on-a-roll',
    name: 'On a Roll',
    description: '7 consecutive days of verified operations',
    category: BadgeCategory.ENDURANCE,
    rarity: BadgeRarity.COMMON,
    criteria: { type: 'streak', metric: 'consecutive_days', target: 7 },
    pointValue: 100,
  },
  {
    id: 'hot-streak',
    name: 'Hot Streak',
    description: '30 consecutive days of verified operations',
    category: BadgeCategory.ENDURANCE,
    rarity: BadgeRarity.UNCOMMON,
    criteria: { type: 'streak', metric: 'consecutive_days', target: 30 },
    pointValue: 300,
  },
  {
    id: 'unstoppable',
    name: 'Unstoppable',
    description: '90 consecutive days of verified operations',
    category: BadgeCategory.ENDURANCE,
    rarity: BadgeRarity.RARE,
    criteria: { type: 'streak', metric: 'consecutive_days', target: 90 },
    pointValue: 750,
  },
  {
    id: 'eternal-flame',
    name: 'Eternal Flame',
    description: '365 consecutive days of verified operations',
    category: BadgeCategory.ENDURANCE,
    rarity: BadgeRarity.LEGENDARY,
    criteria: { type: 'streak', metric: 'consecutive_days', target: 365 },
    pointValue: 3000,
  },
  {
    id: 'night-owl',
    name: 'Night Owl',
    description: 'Complete 50 verified operations between midnight and 6am',
    category: BadgeCategory.ENDURANCE,
    rarity: BadgeRarity.UNCOMMON,
    criteria: { type: 'count', metric: 'night_operations', target: 50 },
    pointValue: 200,
  },
  {
    id: 'all-weather',
    name: 'All Weather',
    description: 'Maintain 95%+ success rate across 200 operations in varying conditions',
    category: BadgeCategory.ENDURANCE,
    rarity: BadgeRarity.EPIC,
    criteria: {
      type: 'compound',
      metric: 'total_verifications',
      target: 200,
      secondaryMetric: 'success_rate',
      secondaryTarget: 95,
    },
    pointValue: 800,
  },

  // SPECIAL
  {
    id: 'perfect-score',
    name: 'Perfect Score',
    description: 'Achieve SSIM > 0.99 on a spatial verification',
    category: BadgeCategory.SPECIAL,
    rarity: BadgeRarity.RARE,
    criteria: { type: 'threshold', metric: 'max_ssim', target: 0.99 },
    pointValue: 500,
  },
  {
    id: 'cross-zone',
    name: 'Cross-Zone Navigator',
    description: 'Complete a delivery spanning 3+ zones in one trip',
    category: BadgeCategory.SPECIAL,
    rarity: BadgeRarity.UNCOMMON,
    criteria: { type: 'threshold', metric: 'max_zones_per_trip', target: 3 },
    pointValue: 300,
  },
  {
    id: 'speed-demon',
    name: 'Speed Demon',
    description: 'Complete 10 operations in under 60 seconds each',
    category: BadgeCategory.SPECIAL,
    rarity: BadgeRarity.RARE,
    criteria: { type: 'count', metric: 'fast_operations', target: 10 },
    pointValue: 400,
  },
];

function signBadgeAward(badgeId: string, robotId: string, earnedAt: number, secret: string): string {
  const payload = `badge:${badgeId}:${robotId}:${earnedAt}`;
  return hmacSign(Buffer.from(payload), secret);
}

export function verifyBadgeAward(badge: EarnedBadge, secret: string): boolean {
  const payload = `badge:${badge.badgeId}:${badge.robotId}:${badge.earnedAt}`;
  return hmacVerify(Buffer.from(payload), badge.signature, secret);
}

export interface RobotMetrics {
  successful_verifications: number;
  spoofing_incidents: number;
  threats_detected: number;
  zones_mapped: number;
  max_zone_mastery: number;
  unique_routes: number;
  consecutive_days: number;
  night_operations: number;
  total_verifications: number;
  success_rate: number; // percentage 0-100
  max_ssim: number;
  max_zones_per_trip: number;
  fast_operations: number;
}

export class BadgeSystem {
  private readonly earned = new Map<string, EarnedBadge[]>(); // robotId → badges
  private readonly secret: string;
  private readonly catalog: readonly BadgeDefinition[];

  constructor(secret: string, catalog?: readonly BadgeDefinition[]) {
    if (!secret || secret.length < 32) {
      throw new Error('BadgeSystem requires a secret of at least 32 chars');
    }
    this.secret = secret;
    this.catalog = catalog ?? BADGE_CATALOG;
  }

  /**
   * Check and award any newly qualified badges
   */
  evaluate(robotId: string, metrics: RobotMetrics): EarnedBadge[] {
    if (!robotId) throw new Error('robotId is required');

    const existing = this.earned.get(robotId) ?? [];
    const existingIds = new Set(existing.map(b => b.badgeId));
    const newBadges: EarnedBadge[] = [];

    for (const badge of this.catalog) {
      if (existingIds.has(badge.id)) continue;
      if (this.checkCriteria(badge.criteria, metrics)) {
        const now = Date.now();
        const earned: EarnedBadge = {
          badgeId: badge.id,
          robotId,
          earnedAt: now,
          signature: signBadgeAward(badge.id, robotId, now, this.secret),
          metadata: { ...metrics },
        };
        newBadges.push(earned);
      }
    }

    if (newBadges.length > 0) {
      this.earned.set(robotId, [...existing, ...newBadges]);
    }
    return newBadges;
  }

  private checkCriteria(criteria: BadgeCriteria, metrics: RobotMetrics): boolean {
    const value = metrics[criteria.metric as keyof RobotMetrics] ?? 0;

    switch (criteria.type) {
      case 'count':
      case 'streak':
      case 'threshold':
        return value >= criteria.target;
      case 'rate':
        return value >= criteria.target;
      case 'compound': {
        const primary = value >= criteria.target;
        if (!primary) return false;
        if (criteria.secondaryMetric && criteria.secondaryTarget !== undefined) {
          const secondary = metrics[criteria.secondaryMetric as keyof RobotMetrics] ?? 0;
          // For "zero incidents" badges, target is 0 and we want value <= target
          // For rate badges, we want value >= target
          if (criteria.secondaryTarget === 0) {
            return secondary <= criteria.secondaryTarget;
          }
          return secondary >= criteria.secondaryTarget;
        }
        return true;
      }
      default:
        return false;
    }
  }

  /**
   * Get all badges earned by a robot
   */
  getBadges(robotId: string): readonly EarnedBadge[] {
    return this.earned.get(robotId) ?? [];
  }

  /**
   * Get badge count for a robot
   */
  getBadgeCount(robotId: string): number {
    return (this.earned.get(robotId) ?? []).length;
  }

  /**
   * Get total point value of all earned badges
   */
  getTotalBadgePoints(robotId: string): number {
    const badges = this.earned.get(robotId) ?? [];
    let total = 0;
    for (const earned of badges) {
      const def = this.catalog.find(b => b.id === earned.badgeId);
      if (def) total += def.pointValue;
    }
    return total;
  }

  /**
   * Verify all badges for a robot are authentic
   */
  verifyAllBadges(robotId: string): { valid: boolean; forged: string[] } {
    const badges = this.earned.get(robotId) ?? [];
    const forged: string[] = [];
    for (const badge of badges) {
      if (!verifyBadgeAward(badge, this.secret)) {
        forged.push(badge.badgeId);
      }
    }
    return { valid: forged.length === 0, forged };
  }

  /**
   * Get catalog size
   */
  get catalogSize(): number {
    return this.catalog.length;
  }

  /**
   * Get badge definition by ID
   */
  getDefinition(badgeId: string): BadgeDefinition | undefined {
    return this.catalog.find(b => b.id === badgeId);
  }
}
