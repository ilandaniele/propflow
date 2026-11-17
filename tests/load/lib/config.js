export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3100').replace(/\/$/, '');
export const SESSION_TOKEN = __ENV.SESSION_TOKEN || '';

export const SUMMARY_STATS = ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'];

// p95 / error-rate budgets per test type (phase 7.2 table).
export const BUDGETS = {
  load: { p95: 800, p99: 1500, errorRate: 0.01 },
  stress: { p95: 5000, p99: 8000, errorRate: 0.2 },
  spike: { p95: 3000, p99: 6000, errorRate: 0.1 },
  soak: { p95: 1000, p99: 2000, errorRate: 0.01 },
  peak: { p95: 1000, p99: 2500, errorRate: 0.05 },
};

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE_URL) && __ENV.ALLOW_REMOTE !== 'yes') {
  throw new Error(`Refusing to load-test non-local BASE_URL (${BASE_URL}). Set -e ALLOW_REMOTE=yes only with explicit permission.`);
}
