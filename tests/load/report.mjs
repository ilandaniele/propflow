// Prints a markdown results table from tests/load/results/*.json (k6 handleSummary output).
import { readFileSync, existsSync } from 'node:fs';

const f = (n, d = 1) => (n == null ? '-' : Number(n).toFixed(d));
const rows = [];
const slowest = [];
for (const name of ['load', 'stress', 'spike', 'soak', 'peak']) {
  const p = `tests/load/results/${name}.json`;
  if (!existsSync(p)) continue;
  const m = JSON.parse(readFileSync(p, 'utf8')).metrics;
  const dur = m.http_req_duration.values;
  const eps = Object.entries(m)
    .filter(([k]) => k.startsWith('dur_'))
    .map(([k, v]) => [k.slice(4), v.values['p(95)']])
    .sort((a, b) => b[1] - a[1]);
  const pass = Object.values(m).every((x) => !x.thresholds || Object.values(x.thresholds).every((t) => t.ok));
  rows.push(
    `| ${name} | ${m.vus_max.values.max} | ${m.http_reqs.values.count} | ${f(m.http_reqs.values.rate)} | ${f(dur.med)} | ${f(dur['p(95)'])} | ${f(m.http_req_failed.values.rate * 100, 2)}% | ${pass ? 'PASS' : 'FAIL'} | ${eps[0][0]} (${f(eps[0][1])} ms) |`,
  );
  slowest.push([name, eps.slice(0, 3).map(([k, v]) => `${k} ${f(v)}ms`).join(', ')]);
}
console.log('| test | max VUs | requests | RPS | p50 ms | p95 ms | error rate | thresholds | slowest endpoint p95 |');
console.log('|---|---|---|---|---|---|---|---|---|');
console.log(rows.join('\n'));
console.log('\nTop-3 slowest endpoints (p95) per test:');
for (const [n, s] of slowest) console.log(`- ${n}: ${s}`);
