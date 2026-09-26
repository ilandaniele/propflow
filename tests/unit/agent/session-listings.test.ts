import { describe, it, expect, vi, beforeEach } from 'vitest';

const { insertMock, onConflictDoNothingMock, selectResults } = vi.hoisted(() => ({
  insertMock: vi.fn(),
  onConflictDoNothingMock: vi.fn(async () => {}),
  selectResults: [] as unknown[][],
}));

vi.mock('@/lib/db', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => {
        insertMock();
        return { onConflictDoNothing: onConflictDoNothingMock };
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => selectResults.shift() ?? []),
        })),
      })),
    })),
  },
}));

import { rememberSessionListings, isListingKnownToSession } from '@/lib/agent/session-listings';

describe('rememberSessionListings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deduplicates ids and skips the insert entirely when the list is empty', async () => {
    await rememberSessionListings('org-1', 'session-1', [], 'search');
    expect(insertMock).not.toHaveBeenCalled();

    await rememberSessionListings('org-1', 'session-1', ['l1', 'l1', 'l2'], 'search');
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});

describe('isListingKnownToSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.length = 0;
  });

  it('is true when the id was already recorded for the session', async () => {
    selectResults.push([{ listingId: 'l1' }]);
    const known = await isListingKnownToSession('org-1', 'session-1', 'l1');
    expect(known).toBe(true);
  });

  it('falls back to the session\'s stored attribution when there is no recorded sighting', async () => {
    selectResults.push([]); // agent_session_listings: no row
    selectResults.push([{ attribution: { type: 'wa_link', listingId: 'l1', capturedAt: '2024-01-01T00:00:00Z' } }]);
    const known = await isListingKnownToSession('org-1', 'session-1', 'l1');
    expect(known).toBe(true);
  });

  it('is false when neither a sighting nor the attribution match', async () => {
    selectResults.push([]);
    selectResults.push([{ attribution: null }]);
    const known = await isListingKnownToSession('org-1', 'session-1', 'l1');
    expect(known).toBe(false);
  });
});
