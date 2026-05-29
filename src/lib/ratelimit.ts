// In-memory rate limiter for auth endpoints (server-side only)
// For production scale, replace with Upstash Redis-backed limiter

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

function getClientIp(request: Request): string {
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

export function authRateLimit(request: Request) {
  const ip = getClientIp(request);
  return checkRateLimit(`auth:${ip}`, 5, 10_000);
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
