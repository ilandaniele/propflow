import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSignedUrl = vi.hoisted(() => vi.fn());
vi.mock('@/lib/storage', () => ({ getSignedUrl }));

import { resolveStoredFileUrl } from '@/lib/storage/resolve';

describe('resolveStoredFileUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSignedUrl.mockResolvedValue('https://signed.example/obj?sig=1');
  });

  it('returns null for empty values', async () => {
    expect(await resolveStoredFileUrl('receipts', null)).toBeNull();
    expect(await resolveStoredFileUrl('receipts', '')).toBeNull();
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('signs storage paths', async () => {
    expect(await resolveStoredFileUrl('receipts', 'org/row/uuid.pdf')).toBe('https://signed.example/obj?sig=1');
    expect(getSignedUrl).toHaveBeenCalledWith('receipts', 'org/row/uuid.pdf');
  });

  it('passes legacy absolute URLs through', async () => {
    expect(await resolveStoredFileUrl('receipts', 'https://v5.airtableusercontent.com/x')).toBe('https://v5.airtableusercontent.com/x');
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('returns null when signing fails', async () => {
    getSignedUrl.mockRejectedValue(new Error('no creds'));
    expect(await resolveStoredFileUrl('receipts', 'org/row/uuid.pdf')).toBeNull();
  });
});
