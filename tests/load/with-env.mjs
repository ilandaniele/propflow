// Run a command with .env.loadtest.local loaded into its environment.
// Usage: node tests/load/with-env.mjs <command> [args...]
// (Avoids `node --env-file`, which Next's workers reject via NODE_OPTIONS.)
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const env = { ...process.env };
for (const line of readFileSync(resolve('.env.loadtest.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

const [cmd, ...args] = process.argv.slice(2);
const child = spawn(cmd, args, { env, stdio: 'inherit', shell: process.platform === 'win32' && cmd !== process.execPath });
child.on('exit', (code) => process.exit(code ?? 1));
