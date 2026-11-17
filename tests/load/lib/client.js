import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { BASE_URL, SESSION_TOKEN } from './config.js';
import { ENDPOINTS, MIX } from './endpoints.js';

// Only 200 is a success: a 3xx (e.g. redirect to /login = lost session) must count as failed.
http.setResponseCallback(http.expectedStatuses(200));

// Custom Trend (latency) + Rate (body-validated success) per endpoint.
// Must be created in init context, hence module scope.
export const durations = {};
export const successes = {};
for (const name of Object.keys(ENDPOINTS)) {
  durations[name] = new Trend(`dur_${name}`, true);
  successes[name] = new Rate(`ok_${name}`);
}

const cookieHeader = () => ({ Cookie: `authjs.session-token=${SESSION_TOKEN}` });

export function hit(name) {
  const ep = ENDPOINTS[name];
  const params = {
    headers: ep.auth ? cookieHeader() : {},
    redirects: 0, // never follow: a redirect means the session was rejected
    tags: { endpoint: name },
    timeout: '30s',
  };
  const res = http.get(`${BASE_URL}${ep.path}`, params);
  const ok = check(res, {
    [`${name}: status 200`]: (r) => r.status === 200,
    [`${name}: body valid (not /login redirect)`]: (r) => ep.marker(r),
  });
  durations[name].add(res.timings.duration);
  successes[name].add(ok);
  return res;
}

const totalWeight = MIX.reduce((s, [, w]) => s + w, 0);
export function pickEndpoint() {
  let roll = Math.random() * totalWeight;
  for (const [name, weight] of MIX) {
    roll -= weight;
    if (roll <= 0) return name;
  }
  return MIX[0][0];
}

// setup(): the session cookie (database session row created by tests/load/seed.mjs)
// must resolve to a real admin dashboard, otherwise abort instead of measuring redirects.
export function verifySession() {
  if (!SESSION_TOKEN) throw new Error('SESSION_TOKEN missing. Run via tests/load/run.mjs (reads .env.loadtest.local).');
  const health = http.get(`${BASE_URL}/api/health`);
  if (health.status !== 200) throw new Error(`Target not reachable: ${BASE_URL} -> ${health.status}`);
  const res = http.get(`${BASE_URL}/dashboard`, { headers: cookieHeader(), redirects: 0 });
  if (!ENDPOINTS.dashboard.marker(res)) {
    throw new Error(`Session cookie rejected (status ${res.status}). Re-run tests/load/seed.mjs.`);
  }
  return { token: 'ok' };
}

export function thinkTime(min = 0.5, max = 2) {
  sleep(min + Math.random() * (max - min));
}

export function perEndpointThresholds(errorRate) {
  const t = {};
  for (const name of Object.keys(ENDPOINTS)) t[`ok_${name}`] = [`rate>${1 - errorRate}`];
  return t;
}

export function buildThresholds(budget) {
  const t = {
    http_req_failed: [`rate<${budget.errorRate}`],
    http_req_duration: [`p(95)<${budget.p95}`, `p(99)<${budget.p99}`],
    checks: [`rate>${1 - budget.errorRate}`],
    ...perEndpointThresholds(budget.errorRate),
  };
  for (const name of Object.keys(ENDPOINTS)) {
    t[`http_req_duration{endpoint:${name}}`] = [`p(95)<${budget.p95}`];
  }
  return t;
}
