import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldUseSecureAuthCookies } from './secure-cookies';

describe('shouldUseSecureAuthCookies', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is secure in production regardless of the configured URL', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_URL', 'http://localhost:8787');
    expect(shouldUseSecureAuthCookies()).toBe(true);
  });

  it('is secure outside production when AUTH_URL is https', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AUTH_URL', 'https://app.example.com');
    expect(shouldUseSecureAuthCookies()).toBe(true);
  });

  it('is not secure outside production on plain http', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AUTH_URL', 'http://localhost:3000');
    expect(shouldUseSecureAuthCookies()).toBe(false);
  });
});
