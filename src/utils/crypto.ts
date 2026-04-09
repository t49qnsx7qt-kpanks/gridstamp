/**
 * Cryptographic utilities for GridStamp
 * HMAC-SHA256 frame signing, nonce generation, constant-time comparison
 */
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Sign data with HMAC-SHA256
 * Used for: frame signing, memory signatures, spatial proof signing
 */
export function hmacSign(data: Buffer | Uint8Array, secret: string): string {
  if (!secret || secret.length < 32) {
    throw new Error('HMAC secret must be at least 32 characters');
  }
  return createHmac('sha256', secret)
    .update(data)
    .digest('hex');
}

/**
 * Verify HMAC-SHA256 signature (constant-time to prevent timing attacks)
 */
export function hmacVerify(
  data: Buffer | Uint8Array,
  signature: string,
  secret: string,
): boolean {
  const expected = hmacSign(data, secret);
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signature, 'hex'),
  );
}

/**
 * Sign a camera frame's pixel data + metadata
 * Includes timestamp and sequence number to prevent replay
 */
export function signFrame(
  rgb: Uint8Array,
  timestamp: number,
  sequenceNumber: number,
  secret: string,
): string {
  const header = Buffer.alloc(16);
  header.writeDoubleBE(timestamp, 0);
  header.writeDoubleBE(sequenceNumber, 8);
  const payload = Buffer.concat([header, Buffer.from(rgb)]);
  return hmacSign(payload, secret);
}

/**
 * Verify a signed frame
 */
export function verifyFrame(
  rgb: Uint8Array,
  timestamp: number,
  sequenceNumber: number,
  signature: string,
  secret: string,
): boolean {
  const header = Buffer.alloc(16);
  header.writeDoubleBE(timestamp, 0);
  header.writeDoubleBE(sequenceNumber, 8);
  const payload = Buffer.concat([header, Buffer.from(rgb)]);
  return hmacVerify(payload, signature, secret);
}

/**
 * Generate cryptographically secure nonce (hex string)
 */
export function generateNonce(bytes: number = 32): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * SHA-256 hash of arbitrary data
 */
export function sha256(data: Buffer | Uint8Array | string): string {
  return createHash('sha256')
    .update(typeof data === 'string' ? Buffer.from(data) : data)
    .digest('hex');
}

/**
 * Derive a sub-key from master secret (for key separation)
 * Different keys for frame signing vs memory signing vs proof signing
 */
export function deriveKey(masterSecret: string, context: string): string {
  return createHmac('sha256', masterSecret)
    .update(`gridstamp:${context}`)
    .digest('hex');
}
