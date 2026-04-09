import { describe, it, expect } from 'vitest';
import {
  hmacSign,
  hmacVerify,
  signFrame,
  verifyFrame,
  generateNonce,
  sha256,
  deriveKey,
} from '../../src/utils/crypto.js';

const TEST_SECRET = 'a'.repeat(32); // minimum length secret for testing

describe('Crypto Utilities', () => {
  describe('hmacSign / hmacVerify', () => {
    it('signs and verifies data correctly', () => {
      const data = Buffer.from('hello world');
      const sig = hmacSign(data, TEST_SECRET);
      expect(sig).toHaveLength(64); // SHA-256 hex = 64 chars
      expect(hmacVerify(data, sig, TEST_SECRET)).toBe(true);
    });

    it('rejects tampered data', () => {
      const data = Buffer.from('hello world');
      const sig = hmacSign(data, TEST_SECRET);
      const tampered = Buffer.from('hello World'); // capital W
      expect(hmacVerify(tampered, sig, TEST_SECRET)).toBe(false);
    });

    it('rejects wrong secret', () => {
      const data = Buffer.from('hello world');
      const sig = hmacSign(data, TEST_SECRET);
      const wrongSecret = 'b'.repeat(32);
      expect(hmacVerify(data, sig, wrongSecret)).toBe(false);
    });

    it('throws on short secret', () => {
      expect(() => hmacSign(Buffer.from('test'), 'short')).toThrow('at least 32');
    });

    it('rejects empty secret', () => {
      expect(() => hmacSign(Buffer.from('test'), '')).toThrow('at least 32');
    });
  });

  describe('signFrame / verifyFrame', () => {
    it('signs and verifies frame data', () => {
      const rgb = new Uint8Array([255, 0, 0, 0, 255, 0]);
      const timestamp = 1712600000000;
      const seq = 42;
      const sig = signFrame(rgb, timestamp, seq, TEST_SECRET);
      expect(verifyFrame(rgb, timestamp, seq, sig, TEST_SECRET)).toBe(true);
    });

    it('rejects altered pixel data', () => {
      const rgb = new Uint8Array([255, 0, 0, 0, 255, 0]);
      const sig = signFrame(rgb, 1000, 1, TEST_SECRET);
      const altered = new Uint8Array([255, 0, 0, 0, 255, 1]); // 1 pixel changed
      expect(verifyFrame(altered, 1000, 1, sig, TEST_SECRET)).toBe(false);
    });

    it('rejects altered timestamp', () => {
      const rgb = new Uint8Array([255, 0, 0]);
      const sig = signFrame(rgb, 1000, 1, TEST_SECRET);
      expect(verifyFrame(rgb, 1001, 1, sig, TEST_SECRET)).toBe(false);
    });

    it('rejects altered sequence number', () => {
      const rgb = new Uint8Array([255, 0, 0]);
      const sig = signFrame(rgb, 1000, 1, TEST_SECRET);
      expect(verifyFrame(rgb, 1000, 2, sig, TEST_SECRET)).toBe(false);
    });
  });

  describe('generateNonce', () => {
    it('generates hex string of correct length', () => {
      const nonce = generateNonce(16);
      expect(nonce).toHaveLength(32); // 16 bytes = 32 hex chars
    });

    it('generates unique values', () => {
      const a = generateNonce();
      const b = generateNonce();
      expect(a).not.toBe(b);
    });
  });

  describe('sha256', () => {
    it('hashes strings correctly', () => {
      const hash = sha256('hello');
      expect(hash).toHaveLength(64);
      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('hashes buffers correctly', () => {
      const hash = sha256(Buffer.from('hello'));
      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });
  });

  describe('deriveKey', () => {
    it('derives different keys for different contexts', () => {
      const key1 = deriveKey(TEST_SECRET, 'frame-signing');
      const key2 = deriveKey(TEST_SECRET, 'memory-signing');
      expect(key1).not.toBe(key2);
      expect(key1).toHaveLength(64);
    });

    it('derives same key for same inputs', () => {
      const key1 = deriveKey(TEST_SECRET, 'test');
      const key2 = deriveKey(TEST_SECRET, 'test');
      expect(key1).toBe(key2);
    });
  });
});
