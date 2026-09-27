/**
 * Unit tests for meta-templates-api.ts.
 *
 * All network calls are stubbed via vi.spyOn(globalThis, 'fetch'). Asserts:
 * - paging is followed until `paging.next` is absent
 * - syncTemplateCatalog only POSTs templates missing remotely (never edits/deletes)
 * - per-template errors are captured without ever surfacing the access token
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WHATSAPP_TEMPLATE_CATALOG } from '@/lib/whatsapp/templates-catalog';

vi.mock('@/lib/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const TEST_ENV = {
  WHATSAPP_ACCESS_TOKEN: 'secret-token-xxx',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'waba-123',
};

function setEnv() {
  Object.assign(process.env, TEST_ENV);
}
function clearEnv() {
  for (const k of Object.keys(TEST_ENV)) delete process.env[k];
}

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('meta-templates-api', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // The status-report cache (item 4) is module-level state — reset the
    // module registry so each test gets an empty cache instead of leaking
    // into the next test's assertions.
    vi.resetModules();
    setEnv();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearEnv();
  });

  describe('isMetaTemplatesConfigured', () => {
    it('false when either env var is missing', async () => {
      clearEnv();
      const { isMetaTemplatesConfigured } = await import('@/lib/whatsapp/meta-templates-api');
      expect(isMetaTemplatesConfigured()).toBe(false);
    });

    it('true when both env vars are set', async () => {
      const { isMetaTemplatesConfigured } = await import('@/lib/whatsapp/meta-templates-api');
      expect(isMetaTemplatesConfigured()).toBe(true);
    });
  });

  describe('listRemoteTemplates', () => {
    it('follows paging.next until absent', async () => {
      fetchSpy
        .mockResolvedValueOnce(
          jsonResponse(200, {
            data: [{ name: 'seguimiento_lead', language: 'es', status: 'APPROVED', category: 'MARKETING' }],
            paging: { next: 'https://graph.facebook.com/v22.0/waba-123/message_templates?after=abc' },
          })
        )
        .mockResolvedValueOnce(
          jsonResponse(200, {
            data: [{ name: 'reactivacion_lead', language: 'es', status: 'PENDING', category: 'MARKETING' }],
            paging: {},
          })
        );

      const { listRemoteTemplates } = await import('@/lib/whatsapp/meta-templates-api');
      const result = await listRemoteTemplates();

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result).toEqual([
        { name: 'seguimiento_lead', language: 'es', status: 'APPROVED', category: 'MARKETING', rejectedReason: undefined },
        { name: 'reactivacion_lead', language: 'es', status: 'PENDING', category: 'MARKETING', rejectedReason: undefined },
      ]);
    });

    it('returns [] when not configured, without calling fetch', async () => {
      clearEnv();
      const { listRemoteTemplates } = await import('@/lib/whatsapp/meta-templates-api');
      const result = await listRemoteTemplates();
      expect(result).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('syncTemplateCatalog', () => {
    it('only POSTs templates missing remotely, marking the rest "exists"', async () => {
      // First call: list (report everything except one template as already existing).
      const existingNames = WHATSAPP_TEMPLATE_CATALOG.slice(1).map((d) => d.name);
      const missingName = WHATSAPP_TEMPLATE_CATALOG[0].name;

      fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (init?.method === 'POST') {
          return jsonResponse(200, { id: 'tpl_new', status: 'PENDING', category: 'UTILITY' });
        }
        if (url.includes('message_templates')) {
          return jsonResponse(200, {
            data: existingNames.map((name) => ({ name, language: 'es', status: 'APPROVED', category: 'MARKETING' })),
            paging: {},
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      });

      const { syncTemplateCatalog } = await import('@/lib/whatsapp/meta-templates-api');
      const results = await syncTemplateCatalog();

      const postCalls = fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
      expect(postCalls).toHaveLength(1);

      const created = results.find((r) => r.name === missingName);
      expect(created).toMatchObject({ name: missingName, action: 'created', status: 'PENDING' });

      for (const name of existingNames) {
        expect(results.find((r) => r.name === name)).toMatchObject({ name, action: 'exists' });
      }
    });

    it('never sends a DELETE or PUT/PATCH request', async () => {
      fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (init?.method === 'POST') return jsonResponse(200, { id: 'x', status: 'PENDING' });
        if (url.includes('message_templates')) return jsonResponse(200, { data: [], paging: {} });
        throw new Error(`unexpected fetch: ${url}`);
      });

      const { syncTemplateCatalog } = await import('@/lib/whatsapp/meta-templates-api');
      await syncTemplateCatalog();

      for (const [, init] of fetchSpy.mock.calls) {
        const method = (init as RequestInit | undefined)?.method ?? 'GET';
        expect(['GET', 'POST']).toContain(method);
      }
    });

    it('captures a per-template error from Meta without throwing or leaking the token', async () => {
      fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (init?.method === 'POST') {
          return jsonResponse(400, { error: { message: 'Template name already exists in a different language.' } });
        }
        if (url.includes('message_templates')) return jsonResponse(200, { data: [], paging: {} });
        throw new Error(`unexpected fetch: ${url}`);
      });

      const { syncTemplateCatalog } = await import('@/lib/whatsapp/meta-templates-api');
      const results = await syncTemplateCatalog();

      expect(results).toHaveLength(WHATSAPP_TEMPLATE_CATALOG.length);
      for (const r of results) {
        expect(r.action).toBe('error');
        expect(r.error).toBe('Template name already exists in a different language.');
        expect(JSON.stringify(r)).not.toContain(TEST_ENV.WHATSAPP_ACCESS_TOKEN);
      }
    });

    it('returns a NOT_CONFIGURED-style error per template when env vars are missing', async () => {
      clearEnv();
      const { syncTemplateCatalog } = await import('@/lib/whatsapp/meta-templates-api');
      const results = await syncTemplateCatalog();
      expect(results).toHaveLength(WHATSAPP_TEMPLATE_CATALOG.length);
      for (const r of results) expect(r.action).toBe('error');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('getTemplateStatusReport', () => {
    it('joins catalog with remote status, MISSING for anything not returned', async () => {
      const [first, ...rest] = WHATSAPP_TEMPLATE_CATALOG;
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(200, {
          data: [{ name: first.name, language: 'es', status: 'APPROVED', category: first.category }],
          paging: {},
        })
      );

      const { getTemplateStatusReport } = await import('@/lib/whatsapp/meta-templates-api');
      const report = await getTemplateStatusReport();

      expect(report.fetchError).toBeUndefined();
      expect(report.rows.find((r) => r.name === first.name)).toMatchObject({ remoteStatus: 'APPROVED' });
      for (const def of rest) {
        expect(report.rows.find((r) => r.name === def.name)).toMatchObject({ remoteStatus: 'MISSING' });
      }
    });

    it('NOT_CONFIGURED for every row when env vars are missing', async () => {
      clearEnv();
      const { getTemplateStatusReport } = await import('@/lib/whatsapp/meta-templates-api');
      const report = await getTemplateStatusReport();
      expect(report.rows).toHaveLength(WHATSAPP_TEMPLATE_CATALOG.length);
      for (const r of report.rows) expect(r.remoteStatus).toBe('NOT_CONFIGURED');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns UNKNOWN rows + a token-free fetchError when listing fails', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(500, { error: { message: 'Internal error' } }));

      const { getTemplateStatusReport } = await import('@/lib/whatsapp/meta-templates-api');
      const report = await getTemplateStatusReport();

      expect(report.fetchError).toBeTruthy();
      expect(report.fetchError).not.toContain(TEST_ENV.WHATSAPP_ACCESS_TOKEN);
      expect(report.rows).toHaveLength(WHATSAPP_TEMPLATE_CATALOG.length);
      for (const r of report.rows) expect(r.remoteStatus).toBe('UNKNOWN');
    });

    it('flags a non-"es" language match with a warning instead of MISSING', async () => {
      const [first] = WHATSAPP_TEMPLATE_CATALOG;
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(200, {
          data: [{ name: first.name, language: 'es_PE', status: 'APPROVED', category: first.category }],
          paging: {},
        })
      );

      const { getTemplateStatusReport } = await import('@/lib/whatsapp/meta-templates-api');
      const report = await getTemplateStatusReport();

      const row = report.rows.find((r) => r.name === first.name);
      expect(row).toMatchObject({ remoteStatus: 'APPROVED' });
      expect(row?.languageWarning).toMatch(/es_PE/);
    });

    it('caches the report for 60s and serves the cache without refetching', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200, { data: [], paging: {} }));

      const { getTemplateStatusReport } = await import('@/lib/whatsapp/meta-templates-api');
      await getTemplateStatusReport();
      const callsAfterFirst = fetchSpy.mock.calls.length;
      await getTemplateStatusReport();

      expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
    });

    it('invalidates the cache after a sync', async () => {
      fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (init?.method === 'POST') return jsonResponse(200, { id: 'x', status: 'PENDING' });
        if (url.includes('message_templates')) return jsonResponse(200, { data: [], paging: {} });
        throw new Error(`unexpected fetch: ${url}`);
      });

      const { getTemplateStatusReport, syncTemplateCatalog } = await import('@/lib/whatsapp/meta-templates-api');
      await getTemplateStatusReport();
      const listCallsBeforeSync = fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== 'POST').length;

      await syncTemplateCatalog();
      await getTemplateStatusReport();
      const listCallsAfterSync = fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== 'POST').length;

      expect(listCallsAfterSync).toBeGreaterThan(listCallsBeforeSync);
    });
  });
});
