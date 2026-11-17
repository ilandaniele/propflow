// Starts the production build (`next start`) on :3100 with .env.loadtest.local loaded.
// Usage: node tests/load/start-app.mjs   (after `node tests/load/with-env.mjs node node_modules/next/dist/bin/next build`)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const next = resolve(here, '..', '..', 'node_modules', 'next', 'dist', 'bin', 'next');
const child = spawn(process.execPath, [resolve(here, 'with-env.mjs'), process.execPath, next, 'start', '-p', '3100'], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
