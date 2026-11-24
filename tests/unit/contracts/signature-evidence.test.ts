import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

const downloadFile = vi.hoisted(() => vi.fn());
vi.mock('@/lib/storage', () => ({ downloadFile }));
vi.mock('@/lib/log', () => ({ log: { warn: vi.fn() } }));

import { storedDocumentSha256 } from '@/lib/contracts/signature-evidence';

beforeEach(() => { downloadFile.mockReset(); });

describe('storedDocumentSha256', () => {
  it('returns null without a stored document', async () => {
    expect(await storedDocumentSha256(null)).toBeNull();
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it('hashes the stored PDF bytes', async () => {
    const pdf = Buffer.from('%PDF-1.7 contract');
    downloadFile.mockResolvedValue(pdf);

    expect(await storedDocumentSha256('org/contract.pdf')).toBe(createHash('sha256').update(pdf).digest('hex'));
    expect(downloadFile).toHaveBeenCalledWith('contracts', 'org/contract.pdf');
  });

  it('returns null when the download fails', async () => {
    downloadFile.mockImplementation(async () => { throw new Error('timeout'); });

    expect(await storedDocumentSha256('org/contract.pdf')).toBeNull();
  });
});
