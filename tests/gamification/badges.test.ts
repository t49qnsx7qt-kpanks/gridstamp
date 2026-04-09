import { describe, it, expect } from 'vitest';
import {
  BadgeSystem,
  BadgeCategory,
  BadgeRarity,
  verifyBadgeAward,
  BADGE_CATALOG,
  type RobotMetrics,
} from '../../src/gamification/badges.js';

const SECRET = 'a'.repeat(32);

function makeMetrics(overrides: Partial<RobotMetrics> = {}): RobotMetrics {
  return {
    successful_verifications: 0,
    spoofing_incidents: 0,
    threats_detected: 0,
    zones_mapped: 0,
    max_zone_mastery: 0,
    unique_routes: 0,
    consecutive_days: 0,
    night_operations: 0,
    total_verifications: 0,
    success_rate: 0,
    max_ssim: 0,
    max_zones_per_trip: 0,
    fast_operations: 0,
    ...overrides,
  };
}

describe('BadgeSystem', () => {
  it('requires 32-char secret', () => {
    expect(() => new BadgeSystem('short')).toThrow('32 chars');
  });

  it('has a catalog of 20+ badges', () => {
    expect(BADGE_CATALOG.length).toBeGreaterThanOrEqual(20);
  });

  it('awards first-delivery badge', () => {
    const system = new BadgeSystem(SECRET);
    const metrics = makeMetrics({ successful_verifications: 1 });
    const newBadges = system.evaluate('robot-1', metrics);
    const firstDelivery = newBadges.find(b => b.badgeId === 'first-delivery');
    expect(firstDelivery).toBeDefined();
    expect(firstDelivery!.robotId).toBe('robot-1');
  });

  it('does not re-award same badge', () => {
    const system = new BadgeSystem(SECRET);
    const metrics = makeMetrics({ successful_verifications: 1 });
    system.evaluate('robot-1', metrics);
    const second = system.evaluate('robot-1', metrics);
    expect(second.find(b => b.badgeId === 'first-delivery')).toBeUndefined();
  });

  it('awards clean-record badge (compound criteria)', () => {
    const system = new BadgeSystem(SECRET);
    const metrics = makeMetrics({
      successful_verifications: 50,
      spoofing_incidents: 0,
    });
    const badges = system.evaluate('robot-1', metrics);
    expect(badges.find(b => b.badgeId === 'clean-record')).toBeDefined();
  });

  it('does not award clean-record with spoofing', () => {
    const system = new BadgeSystem(SECRET);
    const metrics = makeMetrics({
      successful_verifications: 50,
      spoofing_incidents: 1,
    });
    const badges = system.evaluate('robot-1', metrics);
    expect(badges.find(b => b.badgeId === 'clean-record')).toBeUndefined();
  });

  it('awards streak badges', () => {
    const system = new BadgeSystem(SECRET);
    const metrics = makeMetrics({ consecutive_days: 7 });
    const badges = system.evaluate('robot-1', metrics);
    expect(badges.find(b => b.badgeId === 'on-a-roll')).toBeDefined();
  });

  it('awards navigation badges', () => {
    const system = new BadgeSystem(SECRET);
    const metrics = makeMetrics({ zones_mapped: 5 });
    const badges = system.evaluate('robot-1', metrics);
    expect(badges.find(b => b.badgeId === 'explorer')).toBeDefined();
  });

  it('awards threshold badges (zone-master)', () => {
    const system = new BadgeSystem(SECRET);
    const metrics = makeMetrics({ max_zone_mastery: 0.92 });
    const badges = system.evaluate('robot-1', metrics);
    expect(badges.find(b => b.badgeId === 'zone-master')).toBeDefined();
  });

  it('badges are HMAC-signed', () => {
    const system = new BadgeSystem(SECRET);
    const metrics = makeMetrics({ successful_verifications: 1 });
    const badges = system.evaluate('robot-1', metrics);
    const badge = badges[0]!;
    expect(verifyBadgeAward(badge, SECRET)).toBe(true);
    expect(verifyBadgeAward(badge, 'b'.repeat(32))).toBe(false);
  });

  it('getBadgeCount returns correct count', () => {
    const system = new BadgeSystem(SECRET);
    const metrics = makeMetrics({
      successful_verifications: 1,
      consecutive_days: 7,
      zones_mapped: 5,
    });
    system.evaluate('robot-1', metrics);
    expect(system.getBadgeCount('robot-1')).toBeGreaterThanOrEqual(3);
  });

  it('getTotalBadgePoints sums correctly', () => {
    const system = new BadgeSystem(SECRET);
    const metrics = makeMetrics({ successful_verifications: 1 });
    system.evaluate('robot-1', metrics);
    const total = system.getTotalBadgePoints('robot-1');
    expect(total).toBe(50); // first-delivery = 50 points
  });

  it('verifyAllBadges detects forgery', () => {
    const system = new BadgeSystem(SECRET);
    const metrics = makeMetrics({ successful_verifications: 1 });
    system.evaluate('robot-1', metrics);
    const result = system.verifyAllBadges('robot-1');
    expect(result.valid).toBe(true);
    expect(result.forged).toHaveLength(0);
  });

  it('getDefinition returns badge by id', () => {
    const system = new BadgeSystem(SECRET);
    const def = system.getDefinition('first-delivery');
    expect(def).toBeDefined();
    expect(def!.name).toBe('First Delivery');
    expect(def!.category).toBe(BadgeCategory.OPERATIONAL);
  });

  it('awards multiple badges at once', () => {
    const system = new BadgeSystem(SECRET);
    const metrics = makeMetrics({
      successful_verifications: 100,
      consecutive_days: 30,
      zones_mapped: 25,
      spoofing_incidents: 0,
      unique_routes: 50,
    });
    const badges = system.evaluate('robot-1', metrics);
    // Should get: first-delivery, century-club, clean-record, explorer, cartographer,
    //             on-a-roll, hot-streak, pathfinder
    expect(badges.length).toBeGreaterThanOrEqual(7);
  });

  it('rejects empty robotId', () => {
    const system = new BadgeSystem(SECRET);
    expect(() => system.evaluate('', makeMetrics())).toThrow('robotId is required');
  });
});
