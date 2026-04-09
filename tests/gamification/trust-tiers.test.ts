import { describe, it, expect } from 'vitest';
import {
  TrustTier,
  TrustTierSystem,
  verifyTierChange,
  TIER_CONFIGS,
} from '../../src/gamification/trust-tiers.js';

const SECRET = 'a'.repeat(32);

describe('TrustTierSystem', () => {
  it('requires 32-char secret', () => {
    expect(() => new TrustTierSystem('short')).toThrow('32 chars');
  });

  it('registers a robot at Untrusted', () => {
    const system = new TrustTierSystem(SECRET);
    const profile = system.register('robot-1');
    expect(profile.currentTier).toBe(TrustTier.UNTRUSTED);
    expect(profile.points).toBe(0);
    expect(profile.history).toHaveLength(0);
  });

  it('rejects duplicate registration', () => {
    const system = new TrustTierSystem(SECRET);
    system.register('robot-1');
    expect(() => system.register('robot-1')).toThrow('already registered');
  });

  it('rejects empty robotId', () => {
    const system = new TrustTierSystem(SECRET);
    expect(() => system.register('')).toThrow('robotId is required');
  });

  it('awards points on success', () => {
    const system = new TrustTierSystem(SECRET);
    system.register('robot-1');
    const profile = system.recordSuccess('robot-1', 50);
    expect(profile.points).toBe(50);
    expect(profile.successfulVerifications).toBe(1);
    expect(profile.consecutiveSuccesses).toBe(1);
  });

  it('promotes to Probation at 100 points', () => {
    const system = new TrustTierSystem(SECRET);
    system.register('robot-1');
    // Record 10 successes of 10 points each = 100 points
    for (let i = 0; i < 10; i++) {
      system.recordSuccess('robot-1', 10);
    }
    const profile = system.getProfile('robot-1')!;
    expect(profile.currentTier).toBe(TrustTier.PROBATION);
    expect(profile.history.length).toBeGreaterThan(0);
  });

  it('tier change events are HMAC-signed', () => {
    const system = new TrustTierSystem(SECRET);
    system.register('robot-1');
    for (let i = 0; i < 10; i++) system.recordSuccess('robot-1', 10);
    const profile = system.getProfile('robot-1')!;
    const event = profile.history[0]!;
    expect(verifyTierChange(event, SECRET)).toBe(true);
    expect(verifyTierChange(event, 'b'.repeat(32))).toBe(false);
  });

  it('penalizes on failure (10% point loss)', () => {
    const system = new TrustTierSystem(SECRET);
    system.register('robot-1');
    system.recordSuccess('robot-1', 200);
    const profile = system.recordFailure('robot-1', false);
    expect(profile.points).toBe(180); // 200 - 10% = 180
    expect(profile.consecutiveSuccesses).toBe(0);
    expect(profile.failedVerifications).toBe(1);
  });

  it('penalizes 25% on spoofing', () => {
    const system = new TrustTierSystem(SECRET);
    system.register('robot-1');
    system.recordSuccess('robot-1', 200);
    const profile = system.recordFailure('robot-1', true);
    expect(profile.points).toBe(150); // 200 - 25% = 150
    expect(profile.spoofingIncidents).toBe(1);
  });

  it('demotes when points drop below tier minimum', () => {
    const system = new TrustTierSystem(SECRET);
    system.register('robot-1');
    // Promote to Probation (100 pts)
    for (let i = 0; i < 10; i++) system.recordSuccess('robot-1', 10);
    expect(system.getProfile('robot-1')!.currentTier).toBe(TrustTier.PROBATION);
    // Spoofing attack: lose 25% of 100 = 25, new balance 75 < 100 min
    const profile = system.recordFailure('robot-1', true);
    expect(profile.currentTier).toBe(TrustTier.UNTRUSTED);
  });

  it('drops two tiers for spoofing at Trusted+', () => {
    const system = new TrustTierSystem(SECRET);
    system.register('robot-1');
    // Fast-track to Trusted (need 2000 pts, >90% success rate, 0 spoofing)
    for (let i = 0; i < 200; i++) system.recordSuccess('robot-1', 10);
    const before = system.getProfile('robot-1')!;
    expect(before.currentTier).toBeGreaterThanOrEqual(TrustTier.TRUSTED);

    // Spoofing should drop 2 tiers
    const afterTier = before.currentTier;
    const profile = system.recordFailure('robot-1', true);
    expect(profile.currentTier).toBeLessThanOrEqual(afterTier - 2);
  });

  it('fee multiplier decreases with tier', () => {
    expect(TIER_CONFIGS[TrustTier.UNTRUSTED].feeMultiplier).toBe(2.5);
    expect(TIER_CONFIGS[TrustTier.AUTONOMOUS].feeMultiplier).toBe(0.8);
    // Ensure monotonically decreasing
    for (let i = 1; i <= TrustTier.AUTONOMOUS; i++) {
      expect(TIER_CONFIGS[i as TrustTier].feeMultiplier)
        .toBeLessThanOrEqual(TIER_CONFIGS[(i - 1) as TrustTier].feeMultiplier);
    }
  });

  it('getFeeMultiplier returns correct value', () => {
    const system = new TrustTierSystem(SECRET);
    system.register('robot-1');
    expect(system.getFeeMultiplier('robot-1')).toBe(2.5);
    expect(system.getFeeMultiplier('unknown')).toBe(2.5); // defaults to untrusted
  });

  it('isWithinLimits checks tier limits', () => {
    const system = new TrustTierSystem(SECRET);
    system.register('robot-1');
    expect(system.isWithinLimits('robot-1', 5)).toBe(true);
    expect(system.isWithinLimits('robot-1', 15)).toBe(false); // max $10 for Untrusted
  });

  it('requiresVerification respects frequency', () => {
    const system = new TrustTierSystem(SECRET);
    system.register('robot-1');
    // Untrusted: verify every operation (freq=1)
    expect(system.requiresVerification('robot-1', 0)).toBe(true);
    expect(system.requiresVerification('robot-1', 1)).toBe(true);
    expect(system.requiresVerification('robot-1', 5)).toBe(true);
  });

  it('verifyHistory validates entire chain', () => {
    const system = new TrustTierSystem(SECRET);
    system.register('robot-1');
    for (let i = 0; i < 10; i++) system.recordSuccess('robot-1', 10);
    const result = system.verifyHistory('robot-1');
    expect(result.valid).toBe(true);
    expect(result.invalidEvents).toHaveLength(0);
  });

  it('tracks robot count', () => {
    const system = new TrustTierSystem(SECRET);
    expect(system.robotCount).toBe(0);
    system.register('r1');
    system.register('r2');
    expect(system.robotCount).toBe(2);
  });

  it('rejects negative points', () => {
    const system = new TrustTierSystem(SECRET);
    system.register('robot-1');
    expect(() => system.recordSuccess('robot-1', -10)).toThrow('non-negative');
  });
});
