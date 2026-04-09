import { describe, it, expect } from 'vitest';
import {
  vec3Add, vec3Sub, vec3Scale, vec3Dot, vec3Length, vec3Normalize,
  vec3Distance, vec3Cross, vec3Lerp,
  quatMultiply, quatConjugate, quatNormalize, quatRotateVec3,
  quatFromAxisAngle, quatSlerp, QUAT_IDENTITY,
  poseToMat4, egoToAllo, alloToEgo, stereoDepth,
  gaussian, gaussian3D, clamp, meanAbsoluteError,
} from '../../src/utils/math.js';

describe('Vector Operations', () => {
  it('adds vectors', () => {
    const result = vec3Add({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 });
    expect(result).toEqual({ x: 5, y: 7, z: 9 });
  });

  it('subtracts vectors', () => {
    const result = vec3Sub({ x: 5, y: 7, z: 9 }, { x: 4, y: 5, z: 6 });
    expect(result).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('scales vectors', () => {
    expect(vec3Scale({ x: 1, y: 2, z: 3 }, 2)).toEqual({ x: 2, y: 4, z: 6 });
  });

  it('computes dot product', () => {
    expect(vec3Dot({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBe(0);
    expect(vec3Dot({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 })).toBe(14);
  });

  it('computes length', () => {
    expect(vec3Length({ x: 3, y: 4, z: 0 })).toBe(5);
  });

  it('normalizes vectors', () => {
    const n = vec3Normalize({ x: 3, y: 4, z: 0 });
    expect(n.x).toBeCloseTo(0.6);
    expect(n.y).toBeCloseTo(0.8);
    expect(vec3Length(n)).toBeCloseTo(1);
  });

  it('handles zero vector normalization', () => {
    const n = vec3Normalize({ x: 0, y: 0, z: 0 });
    expect(n).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('computes distance', () => {
    expect(vec3Distance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBe(5);
  });

  it('computes cross product', () => {
    const result = vec3Cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(result).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('lerps between vectors', () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 10, y: 10, z: 10 };
    const mid = vec3Lerp(a, b, 0.5);
    expect(mid).toEqual({ x: 5, y: 5, z: 5 });
  });

  it('clamps lerp parameter', () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 10, y: 10, z: 10 };
    expect(vec3Lerp(a, b, -1)).toEqual(a);
    expect(vec3Lerp(a, b, 2)).toEqual(b);
  });
});

describe('Quaternion Operations', () => {
  it('identity quaternion preserves rotation', () => {
    const v = { x: 1, y: 2, z: 3 };
    const rotated = quatRotateVec3(QUAT_IDENTITY, v);
    expect(rotated.x).toBeCloseTo(1);
    expect(rotated.y).toBeCloseTo(2);
    expect(rotated.z).toBeCloseTo(3);
  });

  it('rotates 90 degrees around Z axis', () => {
    const q = quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2);
    const v = { x: 1, y: 0, z: 0 };
    const rotated = quatRotateVec3(q, v);
    expect(rotated.x).toBeCloseTo(0);
    expect(rotated.y).toBeCloseTo(1);
    expect(rotated.z).toBeCloseTo(0);
  });

  it('conjugate reverses rotation', () => {
    const q = quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 4);
    const v = { x: 1, y: 0, z: 0 };
    const rotated = quatRotateVec3(q, v);
    const unrotated = quatRotateVec3(quatConjugate(q), rotated);
    expect(unrotated.x).toBeCloseTo(1);
    expect(unrotated.y).toBeCloseTo(0);
    expect(unrotated.z).toBeCloseTo(0);
  });

  it('slerp interpolates between quaternions', () => {
    const a = QUAT_IDENTITY;
    const b = quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI);
    const mid = quatSlerp(a, b, 0.5);
    // At t=0.5, should be 90 degrees rotation
    const v = quatRotateVec3(mid, { x: 1, y: 0, z: 0 });
    expect(v.x).toBeCloseTo(0, 1);
    expect(Math.abs(v.y)).toBeCloseTo(1, 1);
  });
});

describe('Coordinate Transforms', () => {
  it('ego to allo with identity pose is identity', () => {
    const pose = {
      position: { x: 0, y: 0, z: 0 },
      orientation: QUAT_IDENTITY,
      timestamp: 0,
    };
    const result = egoToAllo({ x: 1, y: 2, z: 3 }, pose);
    expect(result.x).toBeCloseTo(1);
    expect(result.y).toBeCloseTo(2);
    expect(result.z).toBeCloseTo(3);
  });

  it('ego to allo applies translation', () => {
    const pose = {
      position: { x: 10, y: 20, z: 30 },
      orientation: QUAT_IDENTITY,
      timestamp: 0,
    };
    const result = egoToAllo({ x: 1, y: 2, z: 3 }, pose);
    expect(result.x).toBeCloseTo(11);
    expect(result.y).toBeCloseTo(22);
    expect(result.z).toBeCloseTo(33);
  });

  it('allo to ego reverses ego to allo', () => {
    const pose = {
      position: { x: 5, y: 10, z: 15 },
      orientation: quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 4),
      timestamp: 0,
    };
    const worldPoint = { x: 7, y: 12, z: 18 };
    const ego = alloToEgo(worldPoint, pose);
    const back = egoToAllo(ego, pose);
    expect(back.x).toBeCloseTo(worldPoint.x);
    expect(back.y).toBeCloseTo(worldPoint.y);
    expect(back.z).toBeCloseTo(worldPoint.z);
  });

  it('computes stereo depth correctly', () => {
    // Z = f*B/d
    expect(stereoDepth(500, 0.1, 10)).toBeCloseTo(5); // 500*0.1/10 = 5m
    expect(stereoDepth(500, 0.1, 0)).toBe(Infinity); // zero disparity = infinity
  });
});

describe('Statistical Functions', () => {
  it('gaussian peaks at center', () => {
    expect(gaussian(0, 0, 1)).toBeCloseTo(1);
    expect(gaussian(0, 0, 1, 2)).toBeCloseTo(2);
  });

  it('gaussian falls off with distance', () => {
    const atCenter = gaussian(0, 0, 1);
    const at1Sigma = gaussian(1, 0, 1);
    const at2Sigma = gaussian(2, 0, 1);
    expect(atCenter).toBeGreaterThan(at1Sigma);
    expect(at1Sigma).toBeGreaterThan(at2Sigma);
  });

  it('3D gaussian works in 3D', () => {
    const center = { x: 0, y: 0, z: 0 };
    expect(gaussian3D(center, center, 1)).toBeCloseTo(1);
    expect(gaussian3D({ x: 1, y: 0, z: 0 }, center, 1)).toBeLessThan(1);
  });

  it('clamp works', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('meanAbsoluteError computes correctly', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([1, 2, 3]);
    expect(meanAbsoluteError(a, b)).toBe(0);

    const c = new Float32Array([1, 2, 3]);
    const d = new Float32Array([2, 3, 4]);
    expect(meanAbsoluteError(c, d)).toBe(1);
  });

  it('meanAbsoluteError throws on mismatch', () => {
    expect(() => meanAbsoluteError(new Float32Array(3), new Float32Array(4))).toThrow('mismatch');
  });
});
