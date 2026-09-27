/**
 * Meta Graph API client for WhatsApp message *template* management (create /
 * list / status) — distinct from meta-provider.ts, which sends messages.
 * Used by the setup wizard to push WHATSAPP_TEMPLATE_CATALOG to Meta so the
 * owner never has to type the templates into WhatsApp Manager by hand.
 *
 * Security:
 * - WHATSAPP_ACCESS_TOKEN NEVER appears in any log statement or returned value.
 * - Env vars read at call-site (not module top-level) to avoid a startup
 *   crash in previews that haven't set them.
 * - Never deletes or edits an existing remote template — only creates the
 *   ones missing from the catalog.
 */

import { log } from '@/lib/log';
import { META_API_HOST, META_API_VERSION } from './meta-provider';
import { WHATSAPP_TEMPLATE_CATALOG, toGraphPayload } from './templates-catalog';

const REQUEST_TIMEOUT_MS = 15_000;

interface RemoteTemplate {
  name: string;
  language: string;
  status: string;
  category: string;
  rejectedReason?: string;
}

function getAccessToken(): string | null {
  return process.env.WHATSAPP_ACCESS_TOKEN || null;
}

function getBusinessAccountId(): string | null {
  return process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || null;
}

/** True when both env vars this module needs are set. */
export function isMetaTemplatesConfigured(): boolean {
  return Boolean(getAccessToken() && getBusinessAccountId());
}

/** Strips the access token out of an error message before it's logged or returned to the UI. */
function sanitizeFetchError(message: string): string {
  const token = getAccessToken();
  return token ? message.split(token).join('[REDACTED]') : message;
}

interface RemoteTemplateApiRow {
  name: string;
  language: string;
  status: string;
  category: string;
  rejected_reason?: string;
}

/** Lists every template already registered on the WABA, following Meta's cursor pagination. */
export async function listRemoteTemplates(): Promise<RemoteTemplate[]> {
  const accessToken = getAccessToken();
  const wabaId = getBusinessAccountId();
  if (!accessToken || !wabaId) return [];

  const results: RemoteTemplate[] = [];
  let url: string | null =
    `${META_API_HOST}/${META_API_VERSION}/${wabaId}/message_templates?fields=name,language,status,category,rejected_reason&limit=200`;

  while (url) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      const metaMessage = (data as { error?: { message?: string } } | null)?.error?.message;
      log.warn('[meta-templates-api] listRemoteTemplates failed', { status: res.status, metaMessage: metaMessage ?? 'unknown' });
      throw new Error(sanitizeFetchError(metaMessage ?? `HTTP ${res.status}`));
    }

    const body = data as { data?: RemoteTemplateApiRow[]; paging?: { next?: string } };
    for (const row of body.data ?? []) {
      results.push({
        name: row.name,
        language: row.language,
        status: row.status,
        category: row.category,
        rejectedReason: row.rejected_reason,
      });
    }

    url = body.paging?.next ?? null;
  }

  return results;
}

export interface SyncResult {
  name: string;
  action: 'created' | 'exists' | 'error';
  status?: string;
  error?: string;
}

/**
 * Creates only the catalog templates missing on the WABA — never deletes or
 * edits an existing one (Meta re-review would reset an already-approved
 * template's status). Per-template failures are captured individually so one
 * rejection doesn't abort the rest of the batch.
 */
export async function syncTemplateCatalog(): Promise<SyncResult[]> {
  const accessToken = getAccessToken();
  const wabaId = getBusinessAccountId();
  if (!accessToken || !wabaId) {
    return WHATSAPP_TEMPLATE_CATALOG.map((def) => ({ name: def.name, action: 'error' as const, error: 'not_configured' }));
  }

  let remote: RemoteTemplate[];
  try {
    remote = await listRemoteTemplates();
  } catch (e) {
    log.error('[meta-templates-api] syncTemplateCatalog: listRemoteTemplates threw', { error: e instanceof Error ? e.message : 'unknown' });
    return WHATSAPP_TEMPLATE_CATALOG.map((def) => ({ name: def.name, action: 'error' as const, error: 'list_failed' }));
  }
  const remoteNames = new Set(remote.filter((r) => r.language === 'es').map((r) => r.name));

  const results: SyncResult[] = [];
  for (const def of WHATSAPP_TEMPLATE_CATALOG) {
    if (remoteNames.has(def.name)) {
      results.push({ name: def.name, action: 'exists' });
      continue;
    }

    try {
      const res = await fetch(`${META_API_HOST}/${META_API_VERSION}/${wabaId}/message_templates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(toGraphPayload(def)),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        const metaMessage = (data as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`;
        results.push({ name: def.name, action: 'error', error: metaMessage });
        log.warn('[meta-templates-api] template creation failed', { name: def.name, status: res.status });
        continue;
      }

      const status = (data as { status?: string } | null)?.status;
      results.push({ name: def.name, action: 'created', status });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'unknown';
      results.push({ name: def.name, action: 'error', error: message });
      log.error('[meta-templates-api] template creation threw', { name: def.name, error: message });
    }
  }

  invalidateTemplateStatusCache();
  return results;
}

export interface TemplateStatusRow {
  name: string;
  category: string;
  remoteStatus: string | 'MISSING' | 'NOT_CONFIGURED' | 'UNKNOWN';
  rejectedReason?: string;
  /** Set when the only remote match is a non-'es' language variant (e.g. 'es_PE') — the system only ever sends 'es'. */
  languageWarning?: string;
}

export interface TemplateStatusReport {
  rows: TemplateStatusRow[];
  /** Set when listing templates from Meta failed — every row's remoteStatus is 'UNKNOWN' in that case. Never contains the access token. */
  fetchError?: string;
}

/**
 * Best 'es' match for a template name among however many language variants
 * Meta has on file. Prefers an exact 'es' row; falls back to the first
 * es_XX-style variant (flagged with a warning) so the wizard still shows
 * something instead of MISSING when a template was mistakenly created in the
 * wrong Spanish locale.
 */
function pickSpanishMatch(rows: RemoteTemplate[]): { match?: RemoteTemplate; languageWarning?: string } {
  const esVariants = rows.filter((r) => r.language.toLowerCase().startsWith('es'));
  const exact = esVariants.find((r) => r.language === 'es');
  if (exact) return { match: exact };

  const variant = esVariants[0];
  if (variant) {
    return {
      match: variant,
      languageWarning: `Creada como '${variant.language}', el sistema envía 'es'.`,
    };
  }

  return {};
}

const STATUS_CACHE_TTL_MS = 60_000;
interface StatusCacheEntry {
  expiresAt: number;
  report: TemplateStatusReport;
}
// Keyed by WABA id (not just a single slot) so a WHATSAPP_BUSINESS_ACCOUNT_ID
// change mid-process never serves another account's cached report.
const statusCache = new Map<string, StatusCacheEntry>();

/** Drops the cached status report — called after syncTemplateCatalog() so a sync's effects show up immediately instead of waiting out the TTL. */
export function invalidateTemplateStatusCache(): void {
  statusCache.clear();
}

/** Joins the local catalog with whatever Meta reports for each name — for the setup wizard's status table. Cached per-process for 60s (per WABA id) since the wizard polls this on every page load. */
export async function getTemplateStatusReport(): Promise<TemplateStatusReport> {
  const cacheKey = getBusinessAccountId() ?? 'not_configured';
  const cached = statusCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.report;

  const report = await fetchTemplateStatusReport();
  statusCache.set(cacheKey, { report, expiresAt: Date.now() + STATUS_CACHE_TTL_MS });
  return report;
}

async function fetchTemplateStatusReport(): Promise<TemplateStatusReport> {
  if (!isMetaTemplatesConfigured()) {
    return {
      rows: WHATSAPP_TEMPLATE_CATALOG.map((def) => ({ name: def.name, category: def.category, remoteStatus: 'NOT_CONFIGURED' as const })),
    };
  }

  let remote: RemoteTemplate[];
  try {
    remote = await listRemoteTemplates();
  } catch (e) {
    const fetchError = e instanceof Error ? sanitizeFetchError(e.message) : 'unknown';
    log.error('[meta-templates-api] getTemplateStatusReport: listRemoteTemplates threw', { error: fetchError });
    return {
      rows: WHATSAPP_TEMPLATE_CATALOG.map((def) => ({ name: def.name, category: def.category, remoteStatus: 'UNKNOWN' as const })),
      fetchError,
    };
  }

  const byName = new Map<string, RemoteTemplate[]>();
  for (const row of remote) {
    const arr = byName.get(row.name);
    if (arr) arr.push(row);
    else byName.set(row.name, [row]);
  }

  const rows = WHATSAPP_TEMPLATE_CATALOG.map((def): TemplateStatusRow => {
    const { match, languageWarning } = pickSpanishMatch(byName.get(def.name) ?? []);
    if (!match) return { name: def.name, category: def.category, remoteStatus: 'MISSING' as const };
    return {
      name: def.name,
      category: def.category,
      remoteStatus: match.status,
      rejectedReason: match.rejectedReason,
      languageWarning,
    };
  });

  return { rows };
}
