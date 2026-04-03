import { encrypt, decrypt, maskSecret } from './encryption.util';

// 64 hex characters = 32 bytes (AES-256 key)
const VALID_KEY = 'a'.repeat(64);

describe('encryption.util', () => {
  beforeEach(() => {
    process.env.MASTER_ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    delete process.env.MASTER_ENCRYPTION_KEY;
  });

  // ─── encrypt / decrypt round-trip ─────────────────────────────────────────

  describe('round-trip', () => {
    it('decrypts back to the original plaintext', () => {
      const plaintext = 'sk-test-secret-key-12345';
      expect(decrypt(encrypt(plaintext))).toBe(plaintext);
    });

    it('handles empty string', () => {
      expect(decrypt(encrypt(''))).toBe('');
    });

    it('handles unicode characters', () => {
      const unicode = '🔑 pàssw0rd ñoño';
      expect(decrypt(encrypt(unicode))).toBe(unicode);
    });

    it('handles long strings', () => {
      const long = 'x'.repeat(10_000);
      expect(decrypt(encrypt(long))).toBe(long);
    });
  });

  // ─── IV randomness — distinct ciphertexts per call ────────────────────────

  describe('ciphertext uniqueness', () => {
    it('produces different ciphertext for the same plaintext on each call', () => {
      const plaintext = 'same-input';
      const ct1 = encrypt(plaintext);
      const ct2 = encrypt(plaintext);
      // Random IV ensures every call produces a distinct base64 blob
      expect(ct1).not.toBe(ct2);
    });

    it('each ciphertext decrypts correctly despite different IVs', () => {
      const plaintext = 'same-input';
      const ct1 = encrypt(plaintext);
      const ct2 = encrypt(plaintext);
      expect(decrypt(ct1)).toBe(plaintext);
      expect(decrypt(ct2)).toBe(plaintext);
    });
  });

  // ─── Auth-tag integrity ────────────────────────────────────────────────────

  describe('auth-tag integrity', () => {
    it('throws when ciphertext is tampered (GCM auth-tag check fails)', () => {
      const ct = encrypt('hello');
      // Flip a bit in the base64: replace last char with a different one
      const lastChar = ct[ct.length - 1];
      const tampered = ct.slice(0, -1) + (lastChar === 'A' ? 'B' : 'A');
      expect(() => decrypt(tampered)).toThrow();
    });
  });

  // ─── Missing / invalid key ────────────────────────────────────────────────

  describe('key validation', () => {
    it('throws when MASTER_ENCRYPTION_KEY is not set', () => {
      delete process.env.MASTER_ENCRYPTION_KEY;
      expect(() => encrypt('x')).toThrow('MASTER_ENCRYPTION_KEY');
    });

    it('throws when MASTER_ENCRYPTION_KEY is too short', () => {
      process.env.MASTER_ENCRYPTION_KEY = 'deadbeef'; // only 8 hex chars
      expect(() => encrypt('x')).toThrow('MASTER_ENCRYPTION_KEY');
    });

    it('throws when MASTER_ENCRYPTION_KEY is too long', () => {
      process.env.MASTER_ENCRYPTION_KEY = 'a'.repeat(66);
      expect(() => encrypt('x')).toThrow('MASTER_ENCRYPTION_KEY');
    });
  });

  // ─── maskSecret ───────────────────────────────────────────────────────────

  describe('maskSecret', () => {
    it('shows first 3 and last 3 chars for normal secrets', () => {
      // 'sk-abcdefghijklm' → length 16, last3 = 'klm', middle = 10 stars
      expect(maskSecret('sk-abcdefghijklm')).toBe('sk-**********klm');
    });

    it('replaces n-6 middle characters with asterisks', () => {
      const secret = '123456789';       // length 9
      const masked = maskSecret(secret); // 9 > 8 → first3=123, last3=789, middle=3 *
      expect(masked).toBe('123***789');
    });

    it('returns *** for short secrets (length ≤ 8)', () => {
      expect(maskSecret('')).toBe('***');
      expect(maskSecret('abcde')).toBe('***');
      expect(maskSecret('12345678')).toBe('***'); // exactly 8 → boundary
    });

    it('works for exactly 9 characters (shortest non-masked)', () => {
      // length 9 > 8 → first3 + 3 stars + last3
      const result = maskSecret('aaaaaaaaa');
      expect(result).toBe('aaa***aaa');
    });

    it('star count grows with secret length', () => {
      const short = maskSecret('123456789');    // 9 chars → 3 stars
      const medium = maskSecret('1234567890ab'); // 12 chars → 6 stars
      expect(short.length).toBe(9);
      expect(medium.length).toBe(12);
    });
  });
});
