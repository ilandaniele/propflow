import { describe, it, expect, vi } from 'vitest';

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));

const { statusChanged, buildStatusNotification } = await import('@/lib/incidents/status-notification');

describe('statusChanged', () => {
  it('is true only for a new, different status', () => {
    expect(statusChanged('pending', 'solved')).toBe(true);
    expect(statusChanged('pending', 'pending')).toBe(false);
    expect(statusChanged('pending', undefined)).toBe(false);
  });
});

describe('buildStatusNotification', () => {
  const target = { orgId: 'o', incidentId: 'i', incidentTitle: 'Fuga', tenantProfileId: 'p' };

  it('returns null without a tenant profile', async () => {
    expect(await buildStatusNotification({ ...target, tenantProfileId: null }, 'solved')).toBeNull();
  });

  it('targets the tenant profile and links the incident', async () => {
    expect(await buildStatusNotification(target, 'solved')).toMatchObject({
      orgId: 'o', profileId: 'p', type: 'incident_status', title: 'title.solved', relatedType: 'incident', relatedId: 'i',
    });
  });
});
