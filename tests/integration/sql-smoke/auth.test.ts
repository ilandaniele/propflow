/**
 * Real-SQL smoke test for the NextAuth DrizzleAdapter on local D1 (W-CF-39).
 * Drives the adapter calls a Google OAuth sign-in makes (createUser,
 * linkAccount, createSession) and the per-request lookup (getSessionAndUser),
 * then sign-out (deleteSession). `expires` must round-trip as a Date.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Adapter, AdapterAccount } from '@auth/core/adapters';
import { createSmokeDb, type SmokeHandle } from './setup';
import * as schema from '@/lib/db/schema';

let smoke: SmokeHandle;
let adapter: Required<Pick<Adapter, 'createUser' | 'linkAccount' | 'createSession' | 'getSessionAndUser' | 'getUserByAccount' | 'deleteSession'>>;

beforeAll(async () => {
  smoke = await createSmokeDb();
  const { authConfig } = await import('@/lib/auth/config');
  adapter = authConfig.adapter as typeof adapter;
});

afterAll(async () => {
  await smoke.close();
});

describe('DrizzleAdapter on D1 (mocked Google login)', () => {
  it('creates user + account + session, resolves the session, then deletes it', async () => {
    const emailVerified = new Date('2026-01-02T03:04:05.678Z');
    const user = await adapter.createUser({
      id: 'google-sub-ignored',
      email: 'auth-smoke@example.com',
      name: 'Auth Smoke',
      image: null,
      emailVerified,
    });
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.emailVerified).toEqual(emailVerified);

    const account: AdapterAccount = {
      userId: user.id,
      type: 'oidc',
      provider: 'google',
      providerAccountId: 'google-sub-123',
      access_token: 'test-access-token',
      token_type: 'bearer',
      expires_at: 1_900_000_000,
    };
    await adapter.linkAccount(account);
    const linked = await adapter.getUserByAccount({ provider: 'google', providerAccountId: 'google-sub-123' });
    expect(linked?.id).toBe(user.id);

    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const created = await adapter.createSession({ sessionToken: 'smoke-session-token', userId: user.id, expires });
    expect(created.expires).toBeInstanceOf(Date);
    expect(created.expires.getTime()).toBe(expires.getTime());

    const [raw] = await smoke.db
      .select({ expires: schema.sessions.expires })
      .from(schema.sessions)
      .where(eq(schema.sessions.sessionToken, 'smoke-session-token'));
    expect(raw.expires.getTime()).toBe(expires.getTime());

    const found = await adapter.getSessionAndUser('smoke-session-token');
    expect(found?.user.id).toBe(user.id);
    expect(found?.user.email).toBe('auth-smoke@example.com');
    expect(found?.session.expires).toBeInstanceOf(Date);
    expect(found?.session.expires.getTime()).toBe(expires.getTime());

    await adapter.deleteSession('smoke-session-token');
    expect(await adapter.getSessionAndUser('smoke-session-token')).toBeNull();
  });
});
