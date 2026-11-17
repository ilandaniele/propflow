// Runs one k6 scenario against the LOCAL app with the session token from .env.loadtest.local.
// Usage: node tests/load/run.mjs <load|stress|spike|soak|peak> [extra k6 args]
// Env: BASE_URL (default http://localhost:3100)
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [name, ...extra] = process.argv.slice(2);
if (!['load', 'stress', 'spike', 'soak', 'peak'].includes(name)) {
  console.error('usage: node tests/load/run.mjs <load|stress|spike|soak|peak>');
  process.exit(2);
}
const env = { ...process.env };
for (const line of readFileSync(resolve('.env.loadtest.local'), 'utf8').split('\n')) {
  const m = line.match(/^LOADTEST_SESSION_TOKEN=(.*)$/);
  if (m) env.SESSION_TOKEN = m[1];
}
const baseUrl = process.env.BASE_URL ?? 'http://localhost:3100';
const r = spawnSync('k6', ['run', '-e', `BASE_URL=${baseUrl}`, ...extra, `tests/load/scenarios/${name}.k6.js`], { env, stdio: 'inherit' });
process.exit(r.status ?? 1);
