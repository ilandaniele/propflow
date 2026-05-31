import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { handleNotificationFanout } from '@/lib/events/handlers/notification-fanout';

describe('handleNotificationFanout', () => {
  it('resolves without throwing for any valid payload', async () => {
    await expect(
      handleNotificationFanout({ orgId: 'org-1', eventType: 'sanction.proposed' })
    ).resolves.toBeUndefined();
  });

  it('resolves for minimal payload with just orgId', async () => {
    await expect(
      handleNotificationFanout({ orgId: 'org-1' })
    ).resolves.toBeUndefined();
  });
});
