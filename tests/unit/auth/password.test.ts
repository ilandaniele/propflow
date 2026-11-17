import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bcryptjs from 'bcryptjs';

type PasswordModule = typeof import('@/lib/auth/password');

async function loadPasswordModule(): Promise<PasswordModule> {
  vi.resetModules();
  return import('@/lib/auth/password');
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function pbkdf2Stored(plain: string, iterations: number): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(plain), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return `pbkdf2-sha256$${iterations}$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`;
}

describe('password module', () => {
  beforeEach(() => {
    vi.stubEnv('PBKDF2_ITERATIONS', '');
    vi.stubEnv('LEGACY_BCRYPT_VERIFY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('PBKDF2_ITERATIONS', () => {
    it('defaults to 100000', async () => {
      const { PBKDF2_ITERATIONS } = await loadPasswordModule();
      expect(PBKDF2_ITERATIONS).toBe(100_000);
    });

    it('reads a valid env override', async () => {
      vi.stubEnv('PBKDF2_ITERATIONS', '50000');
      const { PBKDF2_ITERATIONS } = await loadPasswordModule();
      expect(PBKDF2_ITERATIONS).toBe(50_000);
    });

    it.each(['9999', 'abc', '-5', '12.5', '1e6'])('falls back to default for invalid value %s', async (value) => {
      vi.stubEnv('PBKDF2_ITERATIONS', value);
      const { PBKDF2_ITERATIONS } = await loadPasswordModule();
      expect(PBKDF2_ITERATIONS).toBe(100_000);
    });
  });

  describe('hashPassword / verifyPassword', () => {
    it('round-trips and uses the documented format', async () => {
      const { hashPassword, verifyPassword, PBKDF2_ITERATIONS } = await loadPasswordModule();
      const stored = await hashPassword('correct horse battery staple');
      const [scheme, iterations, salt, hash] = stored.split('$');
      expect(scheme).toBe('pbkdf2-sha256');
      expect(Number(iterations)).toBe(PBKDF2_ITERATIONS);
      expect(atob(salt)).toHaveLength(16);
      expect(atob(hash)).toHaveLength(32);
      expect(await verifyPassword('correct horse battery staple', stored)).toEqual({ ok: true, needsRehash: false });
    });

    it('uses a fresh salt per hash', async () => {
      const { hashPassword } = await loadPasswordModule();
      expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
    });

    it('returns mismatch for a wrong password', async () => {
      const { hashPassword, verifyPassword } = await loadPasswordModule();
      const stored = await hashPassword('right-password');
      expect(await verifyPassword('wrong-password', stored)).toEqual({ ok: false, reason: 'mismatch' });
    });

    it('flags needsRehash when stored iterations are lower than current', async () => {
      const { verifyPassword } = await loadPasswordModule();
      const stored = await pbkdf2Stored('pw-123456', 20_000);
      expect(await verifyPassword('pw-123456', stored)).toEqual({ ok: true, needsRehash: true });
    });

    it('does not flag needsRehash when stored iterations are higher than current', async () => {
      const { verifyPassword } = await loadPasswordModule();
      const stored = await pbkdf2Stored('pw-123456', 150_000);
      expect(await verifyPassword('pw-123456', stored)).toEqual({ ok: true, needsRehash: false });
    });

    it.each([
      ['empty string', ''],
      ['garbage', 'not-a-hash'],
      ['wrong scheme', 'md5$100000$AAAA$AAAA'],
      ['too few parts', 'pbkdf2-sha256$100000$AAAA'],
      ['non-numeric iterations', 'pbkdf2-sha256$lots$AAAA$AAAA'],
      ['zero iterations', 'pbkdf2-sha256$0$AAAA$AAAA'],
      ['absurd iterations', 'pbkdf2-sha256$999999999999$AAAA$AAAA'],
      ['invalid base64', 'pbkdf2-sha256$100000$!!!$@@@'],
      ['empty salt and hash', 'pbkdf2-sha256$100000$$'],
      ['truncated hash', 'pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAA'],
    ])('returns mismatch without throwing for malformed value: %s', async (_label, stored) => {
      const { verifyPassword } = await loadPasswordModule();
      await expect(verifyPassword('whatever', stored)).resolves.toEqual({ ok: false, reason: 'mismatch' });
    });
  });

  describe('legacy bcrypt', () => {
    const legacyHash = bcryptjs.hashSync('legacy-pass', 4);

    it('detects legacy prefixes', async () => {
      const { isLegacyHash } = await loadPasswordModule();
      expect(isLegacyHash(legacyHash)).toBe(true);
      expect(isLegacyHash('$2a$10$abcdefghijklmnopqrstuv')).toBe(true);
      expect(isLegacyHash('$2y$10$abcdefghijklmnopqrstuv')).toBe(true);
      expect(isLegacyHash('pbkdf2-sha256$100000$AAAA$AAAA')).toBe(false);
      expect(isLegacyHash('')).toBe(false);
    });

    it('verifies and requests rehash when LEGACY_BCRYPT_VERIFY=1', async () => {
      vi.stubEnv('LEGACY_BCRYPT_VERIFY', '1');
      const { verifyPassword } = await loadPasswordModule();
      expect(await verifyPassword('legacy-pass', legacyHash)).toEqual({ ok: true, needsRehash: true });
    });

    it('returns mismatch for a wrong password when LEGACY_BCRYPT_VERIFY=1', async () => {
      vi.stubEnv('LEGACY_BCRYPT_VERIFY', '1');
      const { verifyPassword } = await loadPasswordModule();
      expect(await verifyPassword('nope', legacyHash)).toEqual({ ok: false, reason: 'mismatch' });
    });

    it('returns legacy_unsupported when the flag is off', async () => {
      const { verifyPassword } = await loadPasswordModule();
      expect(await verifyPassword('legacy-pass', legacyHash)).toEqual({ ok: false, reason: 'legacy_unsupported' });
    });

    it('returns legacy_unsupported for any flag value other than "1"', async () => {
      vi.stubEnv('LEGACY_BCRYPT_VERIFY', 'true');
      const { verifyPassword } = await loadPasswordModule();
      expect(await verifyPassword('legacy-pass', legacyHash)).toEqual({ ok: false, reason: 'legacy_unsupported' });
    });
  });

  describe('dummyVerify', () => {
    it('resolves without throwing and derives with the configured iterations', async () => {
      const deriveBits = vi.spyOn(crypto.subtle, 'deriveBits');
      const { dummyVerify, PBKDF2_ITERATIONS } = await loadPasswordModule();
      await expect(dummyVerify('anything')).resolves.toBeUndefined();
      expect(deriveBits).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS }),
        expect.anything(),
        256,
      );
      deriveBits.mockRestore();
    });
  });
});
