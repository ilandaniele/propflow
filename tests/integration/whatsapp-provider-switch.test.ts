/**
 * Integration smoke test for getWhatsAppProvider() switching logic.
 *
 * Tests:
 * 1. WHATSAPP_PROVIDER unset → MockWhatsAppProvider (silent)
 * 2. WHATSAPP_PROVIDER=mock  → MockWhatsAppProvider (silent)
 * 3. WHATSAPP_PROVIDER=meta + all 4 env vars set → MetaWhatsAppProvider
 * 4. WHATSAPP_PROVIDER=meta + missing env var     → MockWhatsAppProvider + log.warn
 *
 * Environment variables are saved and restored per test.
 * resetWhatsAppProvider() is called before each test for singleton isolation.
 *
 * Note: because the factory uses require('./meta-provider') at call-time,
 * we verify the instanceof check using the constructor name (string check) to
 * avoid module-cache identity issues across test-isolation boundaries.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getWhatsAppProvider, resetWhatsAppProvider } from '@/lib/whatsapp';
import { MockWhatsAppProvider } from '@/lib/whatsapp/mock-provider';
import { log } from '@/lib/log';

const META_ENV_VARS = {
  WHATSAPP_ACCESS_TOKEN:         'test-access-token',
  WHATSAPP_PHONE_NUMBER_ID:      '99999999999',
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify-token',
  META_APP_SECRET:               'app-secret',
};

/** Snapshot current env and return a restore function. */
function snapshotEnv(): () => void {
  const saved: Record<string, string | undefined> = {};
  const watchKeys = ['WHATSAPP_PROVIDER', ...Object.keys(META_ENV_VARS)];
  for (const k of watchKeys) saved[k] = process.env[k];
  return () => {
    for (const k of watchKeys) {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    }
  };
}

describe('getWhatsAppProvider() switching', () => {
  let restoreEnv: () => void;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    restoreEnv = snapshotEnv();
    resetWhatsAppProvider();
    warnSpy = vi.spyOn(log, 'warn');
    // Clear all relevant env vars for a clean slate
    delete process.env.WHATSAPP_PROVIDER;
    for (const k of Object.keys(META_ENV_VARS)) delete process.env[k];
  });

  afterEach(() => {
    restoreEnv();
    resetWhatsAppProvider();
    vi.restoreAllMocks();
  });

  it('WHATSAPP_PROVIDER unset → MockWhatsAppProvider without any warning', () => {
    const provider = getWhatsAppProvider();
    expect(provider).toBeInstanceOf(MockWhatsAppProvider);
    // No warn should fire — mock is the silent default
    const warnCalls = warnSpy.mock.calls.filter(
      ([msg]) => typeof msg === 'string' && msg.includes('falling back to mock')
    );
    expect(warnCalls).toHaveLength(0);
  });

  it('WHATSAPP_PROVIDER=mock → MockWhatsAppProvider without any warning', () => {
    process.env.WHATSAPP_PROVIDER = 'mock';
    const provider = getWhatsAppProvider();
    expect(provider).toBeInstanceOf(MockWhatsAppProvider);
    const warnCalls = warnSpy.mock.calls.filter(
      ([msg]) => typeof msg === 'string' && msg.includes('falling back to mock')
    );
    expect(warnCalls).toHaveLength(0);
  });

  it('WHATSAPP_PROVIDER=meta + all 4 vars set → MetaWhatsAppProvider (no network)', () => {
    process.env.WHATSAPP_PROVIDER = 'meta';
    Object.assign(process.env, META_ENV_VARS);

    const provider = getWhatsAppProvider();
    // Check by constructor name to avoid module-cache identity mismatch
    expect(provider.constructor.name).toBe('MetaWhatsAppProvider');
    // Also verify it is NOT a MockWhatsAppProvider
    expect(provider).not.toBeInstanceOf(MockWhatsAppProvider);
  });

  it('WHATSAPP_PROVIDER=meta + META_APP_SECRET missing → MockWhatsAppProvider + log.warn', () => {
    process.env.WHATSAPP_PROVIDER = 'meta';
    Object.assign(process.env, META_ENV_VARS);
    delete process.env.META_APP_SECRET;  // intentional gap

    const provider = getWhatsAppProvider();
    expect(provider).toBeInstanceOf(MockWhatsAppProvider);

    // The factory must emit a log.warn mentioning fallback
    const fallbackWarn = warnSpy.mock.calls.find(
      ([msg]) => typeof msg === 'string' && msg.includes('falling back to mock')
    );
    expect(fallbackWarn).toBeDefined();

    // The warn call MUST NOT contain any env var VALUE (only names are allowed)
    if (fallbackWarn) {
      const serialized = JSON.stringify(fallbackWarn);
      expect(serialized).not.toContain(META_ENV_VARS.WHATSAPP_ACCESS_TOKEN);
    }
  });

  it('WHATSAPP_PROVIDER=meta + WHATSAPP_ACCESS_TOKEN missing → MockWhatsAppProvider + log.warn', () => {
    process.env.WHATSAPP_PROVIDER = 'meta';
    Object.assign(process.env, META_ENV_VARS);
    delete process.env.WHATSAPP_ACCESS_TOKEN;

    const provider = getWhatsAppProvider();
    expect(provider).toBeInstanceOf(MockWhatsAppProvider);
    const fallbackWarn = warnSpy.mock.calls.find(
      ([msg]) => typeof msg === 'string' && msg.includes('falling back to mock')
    );
    expect(fallbackWarn).toBeDefined();
  });

  it('singleton returns the same instance on second call without reset', () => {
    process.env.WHATSAPP_PROVIDER = 'mock';
    const first  = getWhatsAppProvider();
    const second = getWhatsAppProvider();
    expect(first).toBe(second);
  });

  it('resetWhatsAppProvider() clears the singleton so next call re-evaluates env', () => {
    process.env.WHATSAPP_PROVIDER = 'mock';
    const first = getWhatsAppProvider();
    expect(first).toBeInstanceOf(MockWhatsAppProvider);

    // Switch to meta with all vars
    resetWhatsAppProvider();
    process.env.WHATSAPP_PROVIDER = 'meta';
    Object.assign(process.env, META_ENV_VARS);
    const second = getWhatsAppProvider();
    // Second should be a MetaWhatsAppProvider (checked by name) and a different instance
    expect(second.constructor.name).toBe('MetaWhatsAppProvider');
    expect(second).not.toBe(first);
  });
});
