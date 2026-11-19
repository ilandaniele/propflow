/**
 * signIn / signInWithPassword / registerWithEmail password handling
 * (src/app/actions/auth.ts): PBKDF2 hashing on register, transparent rehash of
 * legacy bcrypt on login, PASSWORD_RESET_REQUIRED when legacy verify is off, and
 * a dummy derivation for unknown emails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bcryptjs from 'bcryptjs';

const mocks = vi.hoisted(() => {
  const whereSpy = vi.fn(async () => {});
  const setSpy = vi.fn(() => ({ where: whereSpy }));
  const updateSpy = vi.fn(() => ({ set: setSpy }));
  const valuesSpy = vi.fn(() => ({ returning: vi.fn(async () => [{ id: 'new-user' }]) }));
  const insertSpy = vi.fn(() => ({ values: valuesSpy }));
  return {
    whereSpy,
    setSpy,
    updateSpy,
    valuesSpy,
    insertSpy,
    findUser: vi.fn(),
    createUserSession: vi.fn(async () => {}),
    provisionUser: vi.fn(async () => {}),
  };
});

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9' }),
}));
vi.mock('@/auth', () => ({ signOut: vi.fn() }));
vi.mock('@/lib/ratelimit', () => ({
  checkRateLimit: () => ({ success: true }),
  clientIpFromHeaders: () => '203.0.113.9',
}));
vi.mock('@/lib/log', () => ({
  log: { authFailure: vi.fn(), authSuccess: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/db', () => ({
  db: {
    query: { users: { findFirst: mocks.findUser } },
    update: mocks.updateSpy,
    insert: mocks.insertSpy,
  },
}));
vi.mock('@/lib/auth/session', () => ({ createUserSession: mocks.createUserSession }));
vi.mock('@/lib/auth/provision', () => ({ provisionUser: mocks.provisionUser }));
vi.mock('@/lib/auth/admin-allowlist', () => ({ isAllowlistedAdmin: () => false }));

type ActionsModule = typeof import('@/app/actions/auth');
type PasswordModule = typeof import('@/lib/auth/password');

async function loadModules(): Promise<{ actions: ActionsModule; password: PasswordModule }> {
  vi.resetModules();
  return {
    actions: await import('@/app/actions/auth'),
    password: await import('@/lib/auth/password'),
  };
}

function loginForm(email: string, password: string): FormData {
  const form = new FormData();
  form.set('email', email);
  form.set('password', password);
  return form;
}

describe('auth actions password handling', () => {
  const legacyHash = bcryptjs.hashSync('legacy-pass', 4);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PBKDF2_ITERATIONS', '');
    vi.stubEnv('LEGACY_BCRYPT_VERIFY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rehashes a legacy bcrypt hash to PBKDF2 on successful signIn', async () => {
    vi.stubEnv('LEGACY_BCRYPT_VERIFY', '1');
    const { actions, password } = await loadModules();
    mocks.findUser.mockResolvedValue({ id: 'u1', passwordHash: legacyHash });

    await expect(actions.signIn({}, loginForm('a@b.co', 'legacy-pass'))).rejects.toThrow('REDIRECT:/auth/callback');

    expect(mocks.setSpy).toHaveBeenCalledTimes(1);
    const [{ passwordHash }] = mocks.setSpy.mock.calls[0] as unknown as [{ passwordHash: string }];
    expect(passwordHash.startsWith('pbkdf2-sha256$')).toBe(true);
    expect(await password.verifyPassword('legacy-pass', passwordHash)).toEqual({ ok: true, needsRehash: false });
    expect(mocks.createUserSession).toHaveBeenCalledWith('u1');
  });

  it('does not rewrite an up-to-date PBKDF2 hash', async () => {
    const { actions, password } = await loadModules();
    mocks.findUser.mockResolvedValue({ id: 'u1', passwordHash: await password.hashPassword('current-pass') });

    await expect(actions.signIn({}, loginForm('a@b.co', 'current-pass'))).rejects.toThrow('REDIRECT:/auth/callback');

    expect(mocks.updateSpy).not.toHaveBeenCalled();
    expect(mocks.createUserSession).toHaveBeenCalledWith('u1');
  });

  it('still logs in when the rehash UPDATE fails', async () => {
    vi.stubEnv('LEGACY_BCRYPT_VERIFY', '1');
    const { actions } = await loadModules();
    mocks.findUser.mockResolvedValue({ id: 'u1', passwordHash: legacyHash });
    mocks.whereSpy.mockRejectedValueOnce(new Error('db down'));

    await expect(actions.signIn({}, loginForm('a@b.co', 'legacy-pass'))).rejects.toThrow('REDIRECT:/auth/callback');
    expect(mocks.createUserSession).toHaveBeenCalledWith('u1');
  });

  it('returns AUTH_FAILED and creates no session for a wrong password', async () => {
    const { actions, password } = await loadModules();
    mocks.findUser.mockResolvedValue({ id: 'u1', passwordHash: await password.hashPassword('right-pass') });

    const result = await actions.signIn({}, loginForm('a@b.co', 'wrong-pass'));

    expect(result.error?.code).toBe('AUTH_FAILED');
    expect(mocks.createUserSession).not.toHaveBeenCalled();
    expect(mocks.updateSpy).not.toHaveBeenCalled();
  });

  it('returns PASSWORD_RESET_REQUIRED for a legacy hash when verification is disabled', async () => {
    const { actions } = await loadModules();
    mocks.findUser.mockResolvedValue({ id: 'u1', passwordHash: legacyHash });

    const result = await actions.signIn({}, loginForm('a@b.co', 'legacy-pass'));

    expect(result.error?.code).toBe('PASSWORD_RESET_REQUIRED');
    expect(mocks.createUserSession).not.toHaveBeenCalled();
  });

  it('runs a dummy derivation and returns AUTH_FAILED for an unknown email', async () => {
    const deriveBits = vi.spyOn(crypto.subtle, 'deriveBits');
    const { actions } = await loadModules();
    mocks.findUser.mockResolvedValue(undefined);

    const result = await actions.signIn({}, loginForm('nobody@b.co', 'whatever-pass'));

    expect(result.error?.code).toBe('AUTH_FAILED');
    expect(deriveBits).toHaveBeenCalledTimes(1);
    expect(mocks.createUserSession).not.toHaveBeenCalled();
    deriveBits.mockRestore();
  });

  it('signInWithPassword maps legacy_unsupported to PASSWORD_RESET_REQUIRED', async () => {
    const { actions } = await loadModules();
    mocks.findUser.mockResolvedValue({ id: 'u1', passwordHash: legacyHash });

    expect(await actions.signInWithPassword('a@b.co', 'legacy-pass')).toEqual({
      ok: false,
      error: 'PASSWORD_RESET_REQUIRED',
    });
  });

  it('signInWithPassword rehashes legacy hashes when verification is enabled', async () => {
    vi.stubEnv('LEGACY_BCRYPT_VERIFY', '1');
    const { actions } = await loadModules();
    mocks.findUser.mockResolvedValue({ id: 'u1', passwordHash: legacyHash });

    expect(await actions.signInWithPassword('a@b.co', 'legacy-pass')).toEqual({ ok: true });
    expect(mocks.setSpy).toHaveBeenCalledTimes(1);
  });

  it('registerWithEmail stores a PBKDF2 hash', async () => {
    const { actions } = await loadModules();
    mocks.findUser.mockResolvedValue(undefined);
    const form = new FormData();
    form.set('name', 'Test User');
    form.set('email', 'new@b.co');
    form.set('password', 'long-enough-pass');

    await expect(actions.registerWithEmail({}, form)).rejects.toThrow('REDIRECT:/auth/callback');

    const [{ passwordHash }] = mocks.valuesSpy.mock.calls[0] as unknown as [{ passwordHash: string }];
    expect(passwordHash.startsWith('pbkdf2-sha256$')).toBe(true);
  });
});
