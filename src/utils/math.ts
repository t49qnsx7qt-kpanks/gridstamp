/**
 * Math utilities for RoboMnemo
 * Vector ops, quaternion math, coordinate transforms
 */
import type { Vec3, Quaternion, Mat4, Pose } from '../types/index.js';

// ============================================================
// VECTOR OPERATIONS
// ============================================================

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vec3Scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function vec3Dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vec3Length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function vec3Normalize(v: Vec3): Vec3 {
  const len = vec3Length(v);
  if (len < 1e-10) return { x: 0, y: 0, z: 0 };
  return vec3Scale(v, 1 / len);
}

export function vec3Distance(a: Vec3, b: Vec3): number {
  return vec3Length(vec3Sub(a, b));
}

export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function vec3Lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    x: a.x + (b.x - a.x) * clamped,
    y: a.y + (b.y - a.y) * clamped,
    z: a.z + (b.z - a.z) * clamped,
  };
}

// ============================================================
// QUATERNION OPERATIONS
// ============================================================

export const QUAT_IDENTITY: Quaternion = { w: 1, x: 0, y: 0, z: 0 };

export function quatMultiply(a: Quaternion, b: Quaternion): Quaternion {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function quatConjugate(q: Quaternion): Quaternion {
  return { w: q.w, x: -q.x, y: -q.y, z: -q.z };
}

export function quatNormalize(q: Quaternion): Quaternion {
  const len = Math.sqrt(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z);
  if (len < 1e-10) return QUAT_IDENTITY;
  return { w: q.w / len, x: q.x / len, y: q.y / len, z: q.z / len };
}

/** Rotate vector by quaternion: q * v * q^-1 */
export function quatRotateVec3(q: Quaternion, v: Vec3): Vec3 {
  const qv: Quaternion = { w: 0, x: v.x, y: v.y, z: v.z };
  const result = quatMultiply(quatMultiply(q, qv), quatConjugate(q));
  return { x: result.x, y: result.y, z: result.z };
}

/** Create quaternion from axis-angle */
export function quatFromAxisAngle(axis: Vec3, angle: number): Quaternion {
  const halfAngle = angle / 2;
  const s = Math.sin(halfAngle);
  const normalized = vec3Normalize(axis);
  return quatNormalize({
    w: Math.cos(halfAngle),
    x: normalized.x * s,
    y: normalized.y * s,
    z: normalized.z * s,
  });
}

/** Spherical linear interpolation */
export function quatSlerp(a: Quaternion, b: Quaternion, t: number): Quaternion {
  let dot = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
  let bAdj = b;
  if (dot < 0) {
    dot = -dot;
    bAdj = { w: -b.w, x: -b.x, y: -b.y, z: -b.z };
  }
  if (dot > 0.9995) {
    // Linear interpolation for very close quaternions
    return quatNormalize({
      w: a.w + (bAdj.w - a.w) * t,
      x: a.x + (bAdj.x - a.x) * t,
      y: a.y + (bAdj.y - a.y) * t,
      z: a.z + (bAdj.z - a.z) * t,
    });
  }
  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  return {
    w: wa * a.w + wb * bAdj.w,
    x: wa * a.x + wb * bAdj.x,
    y: wa * a.y + wb * bAdj.y,
    z: wa * a.z + wb * bAdj.z,
  };
}

// ============================================================
// COORDINATE TRANSFORMS
// ============================================================

/** Pose to 4x4 transformation matrix */
export function poseToMat4(pose: Pose): Mat4 {
  const { w, x, y, z } = pose.orientation;
  const { x: tx, y: ty, z: tz } = pose.position;
  // Rotation matrix from quaternion
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return [
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy), tx,
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx), ty,
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy), tz,
    0, 0, 0, 1,
  ] as const satisfies Mat4;
}

/** Transform point from egocentric (robot) to allocentric (world) frame */
export function egoToAllo(point: Vec3, robotPose: Pose): Vec3 {
  const rotated = quatRotateVec3(robotPose.orientation, point);
  return vec3Add(rotated, robotPose.position);
}

/** Transform point from allocentric (world) to egocentric (robot) frame */
export function alloToEgo(point: Vec3, robotPose: Pose): Vec3 {
  const relative = vec3Sub(point, robotPose.position);
  return quatRotateVec3(quatConjugate(robotPose.orientation), relative);
}

/** Stereo depth from disparity: Z = f * B / d */
export function stereoDepth(
  focalLength: number,
  baseline: number,
  disparity: number,
): number {
  if (disparity <= 0) return Infinity;
  return (focalLength * baseline) / disparity;
}

// ============================================================
// STATISTICAL
// ============================================================

/** Gaussian function: f(x) = peak * exp(-((x-center)^2) / (2*sigma^2)) */
export function gaussian(x: number, center: number, sigma: number, peak: number = 1): number {
  const diff = x - center;
  return peak * Math.exp(-(diff * diff) / (2 * sigma * sigma));
}

/** 3D Gaussian: radial falloff from center point */
export function gaussian3D(point: Vec3, center: Vec3, sigma: number, peak: number = 1): number {
  const dist = vec3Distance(point, center);
  return peak * Math.exp(-(dist * dist) / (2 * sigma * sigma));
}

/** Clamp value to [min, max] */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Mean Absolute Error between two arrays */
export function meanAbsoluteError(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error('Array length mismatch');
  if (a.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs(a[i]! - b[i]!);
  }
  return sum / a.length;
}
