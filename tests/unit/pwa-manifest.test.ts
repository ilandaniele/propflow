import { describe, it, expect } from 'vitest';
import { buildManifest } from '@/lib/pwa/manifest';

describe('buildManifest', () => {
  it('anonymous viewer gets the PropFlow app starting at /login', () => {
    const m = buildManifest(null);
    expect(m).toMatchObject({ name: 'PropFlow', short_name: 'PropFlow', start_url: '/login', display: 'standalone' });
    expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });

  it('brands the app with the org name and role start url', () => {
    expect(buildManifest({ role: 'tenant', orgName: 'Casa Aurora' })).toMatchObject({ name: 'Casa Aurora', start_url: '/portal' });
    expect(buildManifest({ role: 'admin', orgName: 'Casa Aurora' }).start_url).toBe('/dashboard');
  });

  it('truncates long short names and falls back on blank org names', () => {
    expect(buildManifest({ role: 'tenant', orgName: 'Residencias del Pacífico' }).short_name).toBe('Residencias…');
    expect(buildManifest({ role: 'tenant', orgName: '  ' }).name).toBe('PropFlow');
  });
});
