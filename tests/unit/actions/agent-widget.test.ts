/**
 * Unit tests for the widget admin Server Actions.
 *
 * Covers:
 * 1. Unauthorized calls
 * 2. updateWidgetSettings — invalid origin -> field error; success upserts scoped to ctx.orgId
 * 3. rotateWidgetKey — changes the key (delegates to rotateWebPublicKey)
 * 4. setPublicPages — toggles publicPagesEnabled
 * 5. IDOR: every action only ever reads ctx.orgId from the session, never from form input
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

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const mockUpsertWebChannel = vi.fn();
const mockRotateWebPublicKey = vi.fn();
const mockSetWhatsAppDisplayPhone = vi.fn();
const mockHasWhatsAppChannel = vi.fn();

vi.mock('@/lib/widget/channel', () => ({
  upsertWebChannel: (...a: unknown[]) => mockUpsertWebChannel(...a),
  rotateWebPublicKey: (...a: unknown[]) => mockRotateWebPublicKey(...a),
  setWhatsAppDisplayPhone: (...a: unknown[]) => mockSetWhatsAppDisplayPhone(...a),
  hasWhatsAppChannel: (...a: unknown[]) => mockHasWhatsAppChannel(...a),
  E164_RE: /^\+[1-9]\d{6,14}$/,
}));

const mockSetPublicPagesEnabled = vi.fn();
vi.mock('@/lib/agent/config', () => ({
  setPublicPagesEnabled: (...a: unknown[]) => mockSetPublicPagesEnabled(...a),
}));

import { updateWidgetSettings, rotateWidgetKey, setPublicPages } from '@/app/actions/agent-widget';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

const BASE_SETTINGS = {
  enabled: 'true',
  origins: 'https://example.com',
  daily_message_cap: '300',
  daily_session_cap: '150',
  greeting: '',
  accent_color: '',
  whatsapp_display_phone: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockState.adminRole = 'admin';
  mockState.rateLimitSuccess = true;
  mockUpsertWebChannel.mockResolvedValue({ orgId: ORG_UUID, publicKey: 'pk_abc' });
  mockRotateWebPublicKey.mockResolvedValue('pk_new');
  mockSetWhatsAppDisplayPhone.mockResolvedValue(true);
  mockHasWhatsAppChannel.mockResolvedValue(true);
  mockSetPublicPagesEnabled.mockResolvedValue(undefined);
});

describe('agent-widget actions — auth', () => {
  it('updateWidgetSettings rejects a non-admin', async () => {
    mockState.adminRole = 'tenant';
    const result = await updateWidgetSettings({}, fd(BASE_SETTINGS));
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });

  it('rotateWidgetKey rejects a non-admin', async () => {
    mockState.adminRole = 'tenant';
    const result = await rotateWidgetKey({}, fd({}));
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });

  it('setPublicPages rejects a non-admin', async () => {
    mockState.adminRole = 'tenant';
    const result = await setPublicPages({}, fd({ enabled: 'true' }));
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });

  it('rate-limits updateWidgetSettings', async () => {
    mockState.rateLimitSuccess = false;
    const result = await updateWidgetSettings({}, fd(BASE_SETTINGS));
    expect(result.error?.code).toBe('RATE_LIMITED');
  });
});

describe('updateWidgetSettings — validation', () => {
  it('rejects an invalid origin with a field error', async () => {
    const result = await updateWidgetSettings({}, fd({ ...BASE_SETTINGS, origins: 'not-a-url' }));
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    const fieldErrors = (result.error?.details as { fieldErrors?: Record<string, string[]> })?.fieldErrors;
    expect(fieldErrors?.origins?.[0]).toBeTruthy();
    expect(mockUpsertWebChannel).not.toHaveBeenCalled();
  });

  it('rejects more than 10 origins', async () => {
    const origins = Array.from({ length: 11 }, (_, i) => `https://site${i}.com`).join('\n');
    const result = await updateWidgetSettings({}, fd({ ...BASE_SETTINGS, origins }));
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(mockUpsertWebChannel).not.toHaveBeenCalled();
  });

  it('rejects a cap outside 1..5000', async () => {
    const result = await updateWidgetSettings({}, fd({ ...BASE_SETTINGS, daily_message_cap: '0' }));
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a non-hex accent colour', async () => {
    const result = await updateWidgetSettings({}, fd({ ...BASE_SETTINGS, accent_color: 'blue' }));
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('surfaces a field error when the org has no WhatsApp channel yet, BEFORE touching the web channel', async () => {
    mockHasWhatsAppChannel.mockResolvedValueOnce(false);
    const result = await updateWidgetSettings({}, fd({ ...BASE_SETTINGS, whatsapp_display_phone: '+51987654321' }));
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    const fieldErrors = (result.error?.details as { fieldErrors?: Record<string, string[]> })?.fieldErrors;
    expect(fieldErrors?.whatsapp_display_phone?.[0]).toBeTruthy();
    // Pre-checked before the web channel upsert — never half-saves the form.
    expect(mockUpsertWebChannel).not.toHaveBeenCalled();
    expect(mockSetWhatsAppDisplayPhone).not.toHaveBeenCalled();
  });

  it('attaches the validated display phone after the web channel upsert succeeds', async () => {
    const result = await updateWidgetSettings({}, fd({ ...BASE_SETTINGS, whatsapp_display_phone: '+51987654321' }));
    expect(result.error).toBeUndefined();
    expect(mockHasWhatsAppChannel).toHaveBeenCalledWith(ORG_UUID);
    expect(mockSetWhatsAppDisplayPhone).toHaveBeenCalledWith(ORG_UUID, '+51987654321');
  });

  it('clears the stored display phone when the field is left empty', async () => {
    const result = await updateWidgetSettings({}, fd({ ...BASE_SETTINGS, whatsapp_display_phone: '' }));
    expect(result.error).toBeUndefined();
    expect(mockHasWhatsAppChannel).not.toHaveBeenCalled(); // no phone provided — nothing to gate on
    expect(mockSetWhatsAppDisplayPhone).toHaveBeenCalledWith(ORG_UUID, null);
  });

  it('scopes the upsert to the caller\'s own org (IDOR)', async () => {
    const result = await updateWidgetSettings({}, fd(BASE_SETTINGS));
    expect(result.error).toBeUndefined();
    expect(mockUpsertWebChannel).toHaveBeenCalledWith(ORG_UUID, expect.objectContaining({
      enabled: true,
      allowedOrigins: ['https://example.com'],
      dailyMessageCap: 300,
      dailySessionCap: 150,
    }));
  });
});

describe('rotateWidgetKey', () => {
  it('rotates the key for the caller\'s own org', async () => {
    const result = await rotateWidgetKey({}, fd({}));
    expect(result.error).toBeUndefined();
    expect(mockRotateWebPublicKey).toHaveBeenCalledWith(ORG_UUID);
  });
});

describe('setPublicPages', () => {
  it('toggles publicPagesEnabled for the caller\'s own org', async () => {
    const result = await setPublicPages({}, fd({ enabled: 'true' }));
    expect(result.error).toBeUndefined();
    expect(mockSetPublicPagesEnabled).toHaveBeenCalledWith(ORG_UUID, true);
  });

  it('rejects a malformed enabled value', async () => {
    const result = await setPublicPages({}, fd({ enabled: 'yes' }));
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });
});
