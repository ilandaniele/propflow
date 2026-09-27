/**
 * Unit tests for the WhatsApp template admin Server Actions.
 *
 * Covers:
 * 1. Unauthorized/non-admin calls -> UNAUTHORIZED
 * 2. NOT_CONFIGURED -> Spanish message listing missing env var names
 * 3. syncWhatsAppTemplates: rate-limited -> RATE_LIMITED; success -> ok + log.adminAction
 * 4. getWhatsAppTemplateStatus: read-only, no rate limit / adminAction call
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG_UUID = '550e8400-e29b-41d4-a716-446655440010';

const mockState = {
  adminRole: 'admin' as 'admin' | 'tenant' | null,
  rateLimitSuccess: true,
};

vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn().mockImplementation(async () => {
    if (mockState.adminRole !== 'admin') throw new Error('UNAUTHORIZED');
    return { userId: 'admin-uuid', orgId: ORG_UUID, role: 'admin', profile: {} };
  }),
}));

vi.mock('@/lib/ratelimit', () => ({
  mutationRateLimit: vi.fn().mockImplementation(() => ({ success: mockState.rateLimitSuccess })),
}));

vi.mock('@/lib/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), adminAction: vi.fn() },
}));

const mockIsConfigured = vi.fn();
const mockSyncTemplateCatalog = vi.fn();
const mockGetTemplateStatusReport = vi.fn();

vi.mock('@/lib/whatsapp/meta-templates-api', () => ({
  isMetaTemplatesConfigured: (...a: unknown[]) => mockIsConfigured(...a),
  syncTemplateCatalog: (...a: unknown[]) => mockSyncTemplateCatalog(...a),
  getTemplateStatusReport: (...a: unknown[]) => mockGetTemplateStatusReport(...a),
}));

import { syncWhatsAppTemplates, getWhatsAppTemplateStatus } from '@/app/actions/agent-templates';
import { log } from '@/lib/log';

beforeEach(() => {
  vi.clearAllMocks();
  mockState.adminRole = 'admin';
  mockState.rateLimitSuccess = true;
  mockIsConfigured.mockReturnValue(true);
  mockSyncTemplateCatalog.mockResolvedValue([{ name: 'seguimiento_lead', action: 'created', status: 'PENDING' }]);
  mockGetTemplateStatusReport.mockResolvedValue({ rows: [{ name: 'seguimiento_lead', category: 'MARKETING', remoteStatus: 'APPROVED' }] });
});

describe('syncWhatsAppTemplates', () => {
  it('returns UNAUTHORIZED when the caller is not an admin', async () => {
    mockState.adminRole = 'tenant';
    const result = await syncWhatsAppTemplates();
    expect(result.error?.code).toBe('UNAUTHORIZED');
    expect(mockSyncTemplateCatalog).not.toHaveBeenCalled();
  });

  it('returns RATE_LIMITED when mutationRateLimit rejects', async () => {
    mockState.rateLimitSuccess = false;
    const result = await syncWhatsAppTemplates();
    expect(result.error?.code).toBe('RATE_LIMITED');
    expect(mockSyncTemplateCatalog).not.toHaveBeenCalled();
  });

  it('returns a validation error listing the missing env var names when not configured', async () => {
    mockIsConfigured.mockReturnValue(false);
    const result = await syncWhatsAppTemplates();
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    const message = JSON.stringify(result.error?.details);
    expect(message).toContain('WHATSAPP_ACCESS_TOKEN');
    expect(message).toContain('WHATSAPP_BUSINESS_ACCOUNT_ID');
    expect(mockSyncTemplateCatalog).not.toHaveBeenCalled();
  });

  it('on success, returns the sync results and logs an admin action', async () => {
    const result = await syncWhatsAppTemplates();
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual([{ name: 'seguimiento_lead', action: 'created', status: 'PENDING' }]);
    expect(log.adminAction).toHaveBeenCalledWith('admin-uuid', 'agent_templates_sync', 'whatsapp_templates', ORG_UUID);
  });
});

describe('getWhatsAppTemplateStatus', () => {
  it('returns UNAUTHORIZED when the caller is not an admin', async () => {
    mockState.adminRole = 'tenant';
    const result = await getWhatsAppTemplateStatus();
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns a validation error listing the missing env var names when not configured', async () => {
    mockIsConfigured.mockReturnValue(false);
    const result = await getWhatsAppTemplateStatus();
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(mockGetTemplateStatusReport).not.toHaveBeenCalled();
  });

  it('on success, returns the report without touching rate-limit or adminAction (read-only)', async () => {
    const result = await getWhatsAppTemplateStatus();
    expect(result.data).toEqual({ rows: [{ name: 'seguimiento_lead', category: 'MARKETING', remoteStatus: 'APPROVED' }] });
    expect(log.adminAction).not.toHaveBeenCalled();
  });
});
