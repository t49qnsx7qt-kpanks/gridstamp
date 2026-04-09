import { describe, it, expect } from 'vitest';
import { StreakSystem } from '../../src/gamification/streaks.js';

const SECRET = 'a'.repeat(32);

// Helper to create timestamps for specific days
function dayTimestamp(daysFromNow: number): number {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0); // noon UTC
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.getTime();
}

describe('StreakSystem', () => {
  it('requires 32-char secret', () => {
    expect(() => new StreakSystem('short')).toThrow('32 chars');
  });

  it('registers a robot', () => {
    const system = new StreakSystem(SECRET);
    const record = system.register('robot-1');
    expect(record.currentStreak).toBe(0);
    expect(record.robotId).toBe('robot-1');
  });

  it('rejects duplicate registration', () => {
    const system = new StreakSystem(SECRET);
    system.register('robot-1');
    expect(() => system.register('robot-1')).toThrow('already registered');
  });

  it('starts streak on first activity', () => {
    const system = new StreakSystem(SECRET);
    system.register('robot-1');
    const result = system.recordActivity('robot-1', 100, dayTimestamp(0));
    expect(result.streakDays).toBe(1);
    expect(result.multiplier).toBeCloseTo(1.1); // base 1.0 + 1 * 0.1
    expect(result.bonusPoints).toBe(10); // 100 * 0.1
    expect(result.totalPoints).toBe(110);
  });

  it('extends streak on consecutive days', () => {
    const system = new StreakSystem(SECRET);
    system.register('robot-1');
    system.recordActivity('robot-1', 100, dayTimestamp(0));
    const day2 = system.recordActivity('robot-1', 100, dayTimestamp(1));
    expect(day2.streakDays).toBe(2);
    expect(day2.multiplier).toBeCloseTo(1.2);
    const day3 = system.recordActivity('robot-1', 100, dayTimestamp(2));
    expect(day3.streakDays).toBe(3);
    expect(day3.multiplier).toBeCloseTo(1.3);
  });

  it('caps multiplier at max', () => {
    const system = new StreakSystem(SECRET, { maxMultiplier: 1.5 });
    system.register('robot-1');
    for (let i = 0; i < 20; i++) {
      system.recordActivity('robot-1', 100, dayTimestamp(i));
    }
    const record = system.getRecord('robot-1')!;
    const multiplier = system.calculateMultiplier(record.currentStreak);
    expect(multiplier).toBeLessThanOrEqual(1.5);
  });

  it('default cap is 2.0x', () => {
    const system = new StreakSystem(SECRET);
    expect(system.calculateMultiplier(100)).toBe(2.0);
    expect(system.calculateMultiplier(0)).toBe(1.0);
  });

  it('breaks streak on gap day', () => {
    const system = new StreakSystem(SECRET);
    system.register('robot-1');
    system.recordActivity('robot-1', 100, dayTimestamp(0));
    system.recordActivity('robot-1', 100, dayTimestamp(1));
    // Skip day 2, record on day 3
    const result = system.recordActivity('robot-1', 100, dayTimestamp(3));
    expect(result.streakDays).toBe(1); // reset
    expect(result.multiplier).toBeCloseTo(1.1);
  });

  it('same-day activity does not change streak', () => {
    const system = new StreakSystem(SECRET);
    system.register('robot-1');
    const first = system.recordActivity('robot-1', 100, dayTimestamp(0));
    const second = system.recordActivity('robot-1', 100, dayTimestamp(0));
    expect(second.streakDays).toBe(first.streakDays);
  });

  it('tracks longest streak', () => {
    const system = new StreakSystem(SECRET);
    system.register('robot-1');
    system.recordActivity('robot-1', 100, dayTimestamp(0));
    system.recordActivity('robot-1', 100, dayTimestamp(1));
    system.recordActivity('robot-1', 100, dayTimestamp(2)); // streak = 3
    system.recordActivity('robot-1', 100, dayTimestamp(5)); // break, streak = 1
    const record = system.getRecord('robot-1')!;
    expect(record.longestStreak).toBe(3);
    expect(record.currentStreak).toBe(1);
  });

  it('streak freeze preserves streak', () => {
    const system = new StreakSystem(SECRET, { freezeCostPoints: 100 });
    system.register('robot-1');
    const result = system.useFreeze('robot-1', 500);
    expect(result.applied).toBe(true);
    expect(result.pointsDeducted).toBe(100);
  });

  it('streak freeze denied when out of budget', () => {
    const system = new StreakSystem(SECRET, { freezeCostPoints: 500 });
    system.register('robot-1');
    const result = system.useFreeze('robot-1', 100);
    expect(result.applied).toBe(false);
    expect(result.pointsDeducted).toBe(0);
  });

  it('streak freeze limited per month', () => {
    const system = new StreakSystem(SECRET, { maxFreezesPerMonth: 2, freezeCostPoints: 10 });
    system.register('robot-1');
    expect(system.useFreeze('robot-1', 1000).applied).toBe(true);
    expect(system.useFreeze('robot-1', 1000).applied).toBe(true);
    expect(system.useFreeze('robot-1', 1000).applied).toBe(false); // 3rd denied
  });

  it('breakStreak resets to 0', () => {
    const system = new StreakSystem(SECRET);
    system.register('robot-1');
    system.recordActivity('robot-1', 100, dayTimestamp(0));
    system.recordActivity('robot-1', 100, dayTimestamp(1));
    const penalty = system.breakStreak('robot-1');
    expect(penalty.penaltyPercent).toBe(5);
    const record = system.getRecord('robot-1')!;
    expect(record.currentStreak).toBe(0);
  });

  it('rejects negative basePoints', () => {
    const system = new StreakSystem(SECRET);
    system.register('robot-1');
    expect(() => system.recordActivity('robot-1', -10)).toThrow('non-negative');
  });

  it('verifyRecord validates HMAC', () => {
    const system = new StreakSystem(SECRET);
    system.register('robot-1');
    system.recordActivity('robot-1', 100);
    expect(system.verifyRecord('robot-1')).toBe(true);
  });

  it('totalPointsFromStreaks accumulates', () => {
    const system = new StreakSystem(SECRET);
    system.register('robot-1');
    system.recordActivity('robot-1', 100, dayTimestamp(0));
    system.recordActivity('robot-1', 100, dayTimestamp(1));
    const record = system.getRecord('robot-1')!;
    expect(record.totalPointsFromStreaks).toBeGreaterThan(0);
  });
});
