// Seeds the LOCAL D1 database (wrangler --local) with the demo accounts the
// Playwright specs log in with. Never targets the remote database.
//
// Usage: node scripts/e2e/seed-d1.mjs
// Prerequisite: pnpm exec wrangler d1 migrations apply propflow-db --local
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto as crypto } from 'node:crypto';

const ITERATIONS = 100_000;

const ORG_ID = 'e2e00000-0000-4000-8000-000000000001';
const ACCOUNTS = [
  {
    userId: 'e2e00000-0000-4000-8000-000000000011',
    profileId: 'e2e00000-0000-4000-8000-000000000021',
    email: process.env.E2E_ADMIN_EMAIL ?? 'admin@org-a.demo',
    password: process.env.E2E_ADMIN_PASS ?? 'DemoAdmin123!',
    name: 'Demo Admin',
    role: 'admin',
  },
  {
    userId: 'e2e00000-0000-4000-8000-000000000012',
    profileId: 'e2e00000-0000-4000-8000-000000000022',
    email: process.env.E2E_TENANT_EMAIL ?? 'tenant@org-a.demo',
    password: process.env.E2E_TENANT_PASS ?? 'DemoTenant123!',
    name: 'Demo Tenant',
    role: 'tenant',
  },
];
const TENANT_ROW_ID = 'e2e00000-0000-4000-8000-000000000031';

async function hashPassword(plain) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(plain), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    key,
    256,
  );
  const b64 = (bytes) => Buffer.from(bytes).toString('base64');
  return `pbkdf2-sha256$${ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

async function buildSql() {
  const now = Date.now();
  const statements = [
    `INSERT OR REPLACE INTO organizations (id, name, slug, created_at, updated_at) VALUES (${quote(ORG_ID)}, 'Org A (E2E)', 'org-a-e2e', ${now}, ${now});`,
  ];
  for (const account of ACCOUNTS) {
    const hash = await hashPassword(account.password);
    statements.push(
      `INSERT OR REPLACE INTO users (id, name, email, email_verified, password_hash) VALUES (${quote(account.userId)}, ${quote(account.name)}, ${quote(account.email)}, ${now}, ${quote(hash)});`,
      `INSERT OR REPLACE INTO profiles (id, user_id, org_id, role, full_name, email, preferred_language, terms_accepted_at, terms_version, privacy_accepted_at, privacy_version, created_at, updated_at) VALUES (${quote(account.profileId)}, ${quote(account.userId)}, ${quote(ORG_ID)}, ${quote(account.role)}, ${quote(account.name)}, ${quote(account.email)}, 'es', ${now}, '1.0', ${now}, '1.0', ${now}, ${now});`,
    );
  }
  const tenant = ACCOUNTS.find((a) => a.role === 'tenant');
  statements.push(
    `INSERT OR REPLACE INTO tenants (id, org_id, profile_id, full_name, email, portal_access, created_at, updated_at) VALUES (${quote(TENANT_ROW_ID)}, ${quote(ORG_ID)}, ${quote(tenant.profileId)}, ${quote(tenant.name)}, ${quote(tenant.email)}, 'active', ${now}, ${now});`,
  );
  return statements.join('\n');
}

const dir = mkdtempSync(join(tmpdir(), 'propflow-e2e-seed-'));
const file = join(dir, 'seed.sql');
try {
  writeFileSync(file, await buildSql());
  execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'propflow-db', '--local', `--file=${file}`], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  console.log(`[e2e-seed] seeded ${ACCOUNTS.length} accounts into local D1`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
