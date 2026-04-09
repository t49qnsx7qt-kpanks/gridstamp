import { describe, it, expect } from 'vitest';
import { ZoneMasterySystem } from '../../src/gamification/zone-mastery.js';

const SECRET = 'a'.repeat(32);

describe('ZoneMasterySystem', () => {
  it('requires 32-char secret', () => {
    expect(() => new ZoneMasterySystem('short')).toThrow('32 chars');
  });

  it('defines a zone', () => {
    const system = new ZoneMasterySystem(SECRET);
    const zone = system.defineZone('Warehouse A', {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 50, y: 50, z: 5 },
    });
    expect(zone.id).toBeTruthy();
    expect(zone.name).toBe('Warehouse A');
    expect(system.totalZones).toBe(1);
  });

  it('rejects invalid bounds', () => {
    const system = new ZoneMasterySystem(SECRET);
    expect(() => system.defineZone('Bad', {
      min: { x: 50, y: 0, z: 0 },
      max: { x: 10, y: 50, z: 5 },
    })).toThrow('min must be less than max');
  });

  it('finds zone for position', () => {
    const system = new ZoneMasterySystem(SECRET);
    system.defineZone('Zone A', {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 50, y: 50, z: 5 },
    });
    const found = system.findZone({ x: 25, y: 25, z: 2 });
    expect(found).toBeDefined();
    expect(found!.name).toBe('Zone A');
  });

  it('returns undefined for position outside all zones', () => {
    const system = new ZoneMasterySystem(SECRET);
    system.defineZone('Zone A', {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 50, y: 50, z: 5 },
    });
    expect(system.findZone({ x: 100, y: 100, z: 0 })).toBeUndefined();
  });

  it('records visit and returns mastery', () => {
    const system = new ZoneMasterySystem(SECRET);
    system.defineZone('Zone A', {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 50, y: 50, z: 5 },
    });
    const result = system.recordVisit('robot-1', { x: 10, y: 10, z: 1 }, true, 50);
    expect(result.zoneId).toBeTruthy();
    expect(result.mastery).toBeDefined();
    expect(result.mastery!.successRate).toBe(1.0);
    expect(result.mastery!.composite).toBeGreaterThan(0);
  });

  it('returns null for position outside zones', () => {
    const system = new ZoneMasterySystem(SECRET);
    const result = system.recordVisit('robot-1', { x: 999, y: 999, z: 0 }, true);
    expect(result.zoneId).toBeNull();
    expect(result.mastery).toBeNull();
  });

  it('coverage increases with unique positions', () => {
    const system = new ZoneMasterySystem(SECRET, 2.0);
    system.defineZone('Zone A', {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 10, y: 10, z: 2 },
    });
    const r1 = system.recordVisit('robot-1', { x: 1, y: 1, z: 1 }, true);
    const r2 = system.recordVisit('robot-1', { x: 5, y: 5, z: 1 }, true);
    const r3 = system.recordVisit('robot-1', { x: 9, y: 9, z: 1 }, true);
    expect(r3.mastery!.coverage).toBeGreaterThan(r1.mastery!.coverage);
  });

  it('success rate reflects failures', () => {
    const system = new ZoneMasterySystem(SECRET);
    system.defineZone('Zone A', {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 50, y: 50, z: 5 },
    });
    system.recordVisit('robot-1', { x: 10, y: 10, z: 1 }, true);
    system.recordVisit('robot-1', { x: 15, y: 15, z: 1 }, false);
    const mastery = system.getMastery('robot-1', system.findZone({ x: 10, y: 10, z: 1 })!.id);
    expect(mastery!.successRate).toBe(0.5);
  });

  it('getZoneCount counts visited zones', () => {
    const system = new ZoneMasterySystem(SECRET);
    system.defineZone('A', { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 5 } });
    system.defineZone('B', { min: { x: 20, y: 20, z: 0 }, max: { x: 30, y: 30, z: 5 } });
    system.recordVisit('robot-1', { x: 5, y: 5, z: 1 }, true);
    system.recordVisit('robot-1', { x: 25, y: 25, z: 1 }, true);
    expect(system.getZoneCount('robot-1')).toBe(2);
  });

  it('getMaxMastery returns highest zone score', () => {
    const system = new ZoneMasterySystem(SECRET, 2.0);
    system.defineZone('A', { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 2 } });
    system.defineZone('B', { min: { x: 20, y: 20, z: 0 }, max: { x: 30, y: 30, z: 2 } });
    // Visit A multiple times
    for (let i = 0; i < 10; i++) {
      system.recordVisit('robot-1', { x: i, y: i, z: 1 }, true);
    }
    // Visit B once
    system.recordVisit('robot-1', { x: 25, y: 25, z: 1 }, true);
    const max = system.getMaxMastery('robot-1');
    expect(max).toBeGreaterThan(0);
  });

  it('getAllMastery returns scores for all zones', () => {
    const system = new ZoneMasterySystem(SECRET);
    system.defineZone('A', { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 5 } });
    system.defineZone('B', { min: { x: 20, y: 20, z: 0 }, max: { x: 30, y: 30, z: 5 } });
    system.recordVisit('robot-1', { x: 5, y: 5, z: 1 }, true);
    system.recordVisit('robot-1', { x: 25, y: 25, z: 1 }, true);
    const scores = system.getAllMastery('robot-1');
    expect(scores).toHaveLength(2);
  });

  it('signMasterySnapshot produces HMAC-signed output', () => {
    const system = new ZoneMasterySystem(SECRET);
    system.defineZone('A', { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 5 } });
    system.recordVisit('robot-1', { x: 5, y: 5, z: 1 }, true);
    const snapshot = system.signMasterySnapshot('robot-1');
    expect(snapshot.scores).toHaveLength(1);
    expect(snapshot.signature).toHaveLength(64);
  });

  it('findAllZones returns overlapping zones', () => {
    const system = new ZoneMasterySystem(SECRET);
    system.defineZone('A', { min: { x: 0, y: 0, z: 0 }, max: { x: 20, y: 20, z: 5 } });
    system.defineZone('B', { min: { x: 10, y: 10, z: 0 }, max: { x: 30, y: 30, z: 5 } });
    const zones = system.findAllZones({ x: 15, y: 15, z: 2 });
    expect(zones).toHaveLength(2);
  });
});
