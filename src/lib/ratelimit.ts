// In-memory rate limiter for auth and action endpoints (server-side only)
//
// IC-C2: This limiter is in-memory and per-serverless-instance. On multi-instance Vercel
// deployments, the effective limit is max × instances. Acceptable for Hobby (low-concurrency,
// typically single-region). Upgrade path: swap checkRateLimit internals for Upstash Redis /
// Vercel KV — the function interface is intentionally stable so callers don't change.

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

export function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;
  return 'anonymous';
}

export function checkRateLimit(
  key: string,
  maxRequests: number = 5,
  windowMs: number = 10_000
): { success: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, retryAfterMs: 0 };
  }

  if (entry.count >= maxRequests) {
    return { success: false, retryAfterMs: entry.resetAt - now };
  }

  entry.count++;
  return { success: true, retryAfterMs: 0 };
}

/** Auth rate limit: 5 requests / 10s / IP */
export function authRateLimit(request: Request) {
  const ip = getClientIp(request);
  return checkRateLimit(`auth:${ip}`, 5, 10_000);
}

/**
 * Generic per-action rate limit (Phase 2).
 * Used by all new Server Actions and Route Handlers.
 * @param key  Unique key — include userId/orgId/token+IP as appropriate
 * @param max  Maximum requests in the window
 * @param windowMs  Window duration in milliseconds
 */
export function actionRateLimit(
  key: string,
  max: number,
  windowMs: number
): { success: boolean; retryAfterMs: number } {
  return checkRateLimit(`action:${key}`, max, windowMs);
}

// ─── Per-feature helpers (named constants for the limits from the spec) ────────

const ONE_MINUTE_MS = 60_000;
const ONE_DAY_MS = 24 * 60 * 60_000;

/** Mutating Server Actions — 30 requests / minute / user */
export function mutationRateLimit(userId: string, action: string) {
  return actionRateLimit(`mut:${action}:${userId}`, 30, ONE_MINUTE_MS);
}

/** OCR extractions — 15 / day / user + 500 / day / org */
export function ocrRateLimit(userId: string, orgId: string): { success: boolean } {
  const user = checkRateLimit(`ocr:user:${userId}`, 15, ONE_DAY_MS);
  if (!user.success) return { success: false };
  const org = checkRateLimit(`ocr:org:${orgId}`, 500, ONE_DAY_MS);
  return { success: org.success };
}

/** AI chat — 20 / day / user + 5 / min / user + 500 / day / org */
export function aiChatRateLimit(userId: string, orgId: string): { success: boolean } {
  const daily = checkRateLimit(`ai:daily:${userId}`, 20, ONE_DAY_MS);
  if (!daily.success) return { success: false };
  const perMin = checkRateLimit(`ai:min:${userId}`, 5, ONE_MINUTE_MS);
  if (!perMin.success) return { success: false };
  const org = checkRateLimit(`ai:org:${orgId}`, 500, ONE_DAY_MS);
  return { success: org.success };
}

/** Signature submit — 5 / min / (token + IP) */
export function signatureRateLimit(token: string, ip: string) {
  return actionRateLimit(`sign:${token}:${ip}`, 5, ONE_MINUTE_MS);
}

/** Send signature request — 10 / min / admin */
export function sendSignatureRateLimit(adminId: string) {
  return actionRateLimit(`send-sig:${adminId}`, 10, ONE_MINUTE_MS);
}

/** Generate PDF — 10 / min / admin */
export function generatePdfRateLimit(adminId: string) {
  return actionRateLimit(`gen-pdf:${adminId}`, 10, ONE_MINUTE_MS);
}

/** WhatsApp webhook — 60 / min / IP */
export function webhookRateLimit(request: Request) {
  const ip = getClientIp(request);
  return actionRateLimit(`wa-webhook:${ip}`, 60, ONE_MINUTE_MS);
}

/** Task proof AI verification — 5 per task (shared aiChatRateLimit envelope) */
export function taskProofRateLimit(userId: string, orgId: string) {
  return aiChatRateLimit(userId, orgId);
}

/** Executive Brief narrative — 10 req/min/user (LLM10, spec §Security) */
export function aiExecutiveBriefRateLimit(userId: string): { success: boolean; retryAfterMs: number } {
  return actionRateLimit(`executive-brief:${userId}`, 10, ONE_MINUTE_MS);
}

// ─── Agent Phase 7: web widget (§2.7) ────────────────────────────────────────

/** Creating a web session — 5 / 10 min / IP. */
export function webSessionCreateRateLimit(ip: string): { success: boolean; retryAfterMs: number } {
  return checkRateLimit(`widget-session:${ip}`, 5, 10 * ONE_MINUTE_MS);
}

/** Sending a widget message — 20/min/IP AND 6/min + 120/day per web session. All three must pass. */
export function webMessageRateLimit(ip: string, webSessionId: string): { success: boolean; retryAfterMs: number } {
  const perIp = checkRateLimit(`widget-msg:ip:${ip}`, 20, ONE_MINUTE_MS);
  if (!perIp.success) return perIp;
  const perSessionMinute = checkRateLimit(`widget-msg:session-min:${webSessionId}`, 6, ONE_MINUTE_MS);
  if (!perSessionMinute.success) return perSessionMinute;
  return checkRateLimit(`widget-msg:session-day:${webSessionId}`, 120, ONE_DAY_MS);
}

/** `/api/public/listing-image/*` and other public assets — 120 / min / IP. */
export function publicAssetRateLimit(ip: string): { success: boolean; retryAfterMs: number } {
  return checkRateLimit(`public-asset:${ip}`, 120, ONE_MINUTE_MS);
}

// Cleanup stale entries periodically (only in non-edge environments)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (now > entry.resetAt) store.delete(key);
    }
  }, 60_000);
}
