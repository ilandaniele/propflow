// Load-test seed. Creates 1 org, 1 admin user + profile, 1 DB session row,
// 10 properties, 200 units, 200 tenants, 200 contracts, 1200 payments.
//
// Usage (DATABASE_URL must point at the LOCAL load-test Postgres):
//   node --env-file=.env.loadtest.local tests/load/seed.mjs
//
// Idempotent: deletes the previous load-test org/user (cascade) and recreates.
// Writes LOADTEST_SESSION_TOKEN=<token> into .env.loadtest.local (gitignored)
// so the k6 runner can pass it via -e SESSION_TOKEN=...
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL not set');
const host = new URL(url).hostname;
if (host !== 'localhost' && host !== '127.0.0.1') {
  throw new Error(`Refusing to seed non-local database host: ${host}`);
}

const sql = postgres(url, { max: 4, onnotice: () => {} });
const SLUG = 'loadtest-org';
const EMAIL = 'loadtest-admin@example.invalid';
const N = 200;

const methods = ['transfer', 'cash', 'card', 'other'];
const statuses = ['approved', 'approved', 'approved', 'pending', 'under_review', 'rejected'];
const firstNames = ['Ana', 'Luis', 'Maria', 'Carlos', 'Rosa', 'Jorge', 'Lucia', 'Pedro', 'Elena', 'Diego'];
const lastNames = ['Quispe', 'Flores', 'Garcia', 'Rojas', 'Mamani', 'Torres', 'Vargas', 'Salas', 'Rios', 'Paredes'];

async function main() {
  await sql`DELETE FROM organizations WHERE slug = ${SLUG}`;
  await sql`DELETE FROM users WHERE email = ${EMAIL}`;

  const [org] = await sql`INSERT INTO organizations (name, slug) VALUES ('Load Test Org', ${SLUG}) RETURNING id`;
  const [user] = await sql`
    INSERT INTO users (name, email, email_verified) VALUES ('Load Admin', ${EMAIL}, now()) RETURNING id`;
  await sql`
    INSERT INTO profiles (user_id, org_id, role, full_name, email, preferred_language)
    VALUES (${user.id}, ${org.id}, 'admin', 'Load Admin', ${EMAIL}, 'es')`;

  const token = randomBytes(32).toString('hex');
  await sql`INSERT INTO sessions (session_token, user_id, expires)
            VALUES (${token}, ${user.id}, now() + interval '30 days')`;

  const props = await sql`
    INSERT INTO properties ${sql(
      Array.from({ length: 10 }, (_, i) => ({
        org_id: org.id, name: `Propiedad ${i + 1}`, address: `Av. Load ${i + 1}`, city: 'Lima', country: 'PE',
      })),
    )} RETURNING id`;

  const units = await sql`
    INSERT INTO units ${sql(
      Array.from({ length: N }, (_, i) => ({
        org_id: org.id, property_id: props[i % props.length].id, label: `U-${String(i + 1).padStart(3, '0')}`,
        floor: String((i % 5) + 1), bedrooms: (i % 3) + 1, monthly_rent_default: 800 + (i % 10) * 100,
        status: 'occupied', toilet_type: 'private', area_m2: 12 + (i % 20),
      })),
    )} RETURNING id`;

  const tenants = await sql`
    INSERT INTO tenants ${sql(
      Array.from({ length: N }, (_, i) => ({
        org_id: org.id, full_name: `${firstNames[i % 10]} ${lastNames[(i * 7) % 10]} ${i + 1}`,
        email: `tenant${i + 1}@example.invalid`, phone: `+5199${String(1000000 + i)}`,
        unit_id: units[i].id, document_number: String(40000000 + i), sync_status: 'synced',
        external_tenant_id: `LT-${i + 1}`, move_in_date: '2026-01-01',
      })),
    )} RETURNING id`;

  const contracts = await sql`
    INSERT INTO contracts ${sql(
      Array.from({ length: N }, (_, i) => ({
        org_id: org.id, tenant_id: tenants[i].id, unit_id: units[i].id, start_date: '2026-01-01',
        end_date: '2027-01-01', monthly_rent: 800 + (i % 10) * 100, status: 'active', deposit: 800,
      })),
    )} RETURNING id`;

  const pay = [];
  for (let i = 0; i < N; i++) {
    for (let m = 0; m < 6; m++) {
      pay.push({
        org_id: org.id, contract_id: contracts[i].id, tenant_id: tenants[i].id,
        amount: 800 + (i % 10) * 100, paid_at: `2026-${String(m + 3).padStart(2, '0')}-05`,
        method: methods[(i + m) % 4], status: statuses[(i * 3 + m) % statuses.length],
        currency: 'PEN', external_payment_id: `LT-P-${i}-${m}`,
      });
    }
  }
  for (let i = 0; i < pay.length; i += 500) {
    await sql`INSERT INTO payments ${sql(pay.slice(i, i + 500))}`;
  }

  // Persist the session token (gitignored env file) without printing it.
  const envPath = resolve('.env.loadtest.local');
  let env = readFileSync(envPath, 'utf8').split('\n').filter((l) => !l.startsWith('LOADTEST_SESSION_TOKEN='));
  while (env.length && env[env.length - 1] === '') env.pop();
  env.push(`LOADTEST_SESSION_TOKEN=${token}`, '');
  writeFileSync(envPath, env.join('\n'));

  const [c] = await sql`
    SELECT (SELECT count(*) FROM tenants WHERE org_id=${org.id})::int AS tenants,
           (SELECT count(*) FROM units WHERE org_id=${org.id})::int AS units,
           (SELECT count(*) FROM payments WHERE org_id=${org.id})::int AS payments`;
  console.log('[seed] done', c);
}

main().then(() => sql.end()).catch(async (e) => { console.error('[seed] failed:', e.message); await sql.end(); process.exit(1); });
