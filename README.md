# PropFlow — Property & Tenant Management SaaS

A premium, multi-tenant property management platform built with Next.js 16, Supabase, and Tailwind CSS v4.

## Setup — Local Development

```bash
npm install
cp .env.example .env.local  # fill in Supabase credentials
npx supabase start          # start local Supabase (requires Docker)
npx supabase db push --local
npx tsx scripts/seed.ts     # create demo orgs + users (idempotent — safe to re-run)
npm run dev
```

Demo logins after seed:
- Admin: admin@org-a.demo / DemoAdmin123!
- Tenant: tenant@org-a.demo / DemoTenant123!

## Scripts

```bash
npm run build            # production build
npm run lint             # ESLint
npm run typecheck        # TypeScript check
npm run test:unit        # Vitest unit tests
npm run test:e2e         # Playwright E2E tests
npm run seed             # run seed script (idempotent)
```

## Google OAuth Setup — Human Steps Required

Google sign-in requires one-time configuration by the project owner. The app adds zero new env vars; Google credentials live in Supabase Auth.

### Step 1 — Google Cloud Console
1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials.
2. Create an **OAuth 2.0 Client ID** (type: Web application).
3. Add authorized redirect URIs:
   - `https://<your-supabase-project-ref>.supabase.co/auth/v1/callback` (Supabase's own callback)
   - `https://propflow-rouge-ten.vercel.app/auth/callback` (propflow production)
   - `http://localhost:3000/auth/callback` (local dev, optional)
4. Copy the **Client ID** and **Client Secret**.

### Step 2 — Supabase Dashboard
1. Go to Supabase dashboard → Authentication → Providers → Google.
2. Toggle **Google** to enabled.
3. Paste the Client ID and Client Secret from Step 1.
4. Under **Redirect URLs**, add:
   - `https://propflow-rouge-ten.vercel.app/auth/callback`
   - `http://localhost:3000/auth/callback` (for local dev)
5. Save.

### Step 3 — Local dev (optional)
For Google sign-in to work with local Supabase (`supabase start`), add to `.env.local`:
```
SUPABASE_AUTH_GOOGLE_CLIENT_ID=<your-google-client-id>
SUPABASE_AUTH_GOOGLE_CLIENT_SECRET=<your-google-client-secret>
```
These are read by the local Supabase Auth container via `supabase/config.toml`. They are NOT read by the Next.js app and must never be in `NEXT_PUBLIC_*` env vars.

### Step 4 — Confirm NEXT_PUBLIC_SITE_URL in Vercel
In Vercel project settings → Environment Variables, confirm:
```
NEXT_PUBLIC_SITE_URL=https://propflow-rouge-ten.vercel.app
```
This is used as the OAuth `redirectTo` base URL.

## Seed Repair / Re-run

If demo accounts are broken (users exist in auth.users but have no profiles row), re-run the seed:

```bash
SUPABASE_SERVICE_ROLE_KEY=<key> NEXT_PUBLIC_SUPABASE_URL=<url> npx tsx scripts/seed.ts
```

The seed is now **fully idempotent**:
- Organizations are upserted by `slug` (no unique-constraint error on re-run).
- When a user already exists in `auth.users`, the seed looks up their id and upserts the `profiles` row (the old bug skipped this step, leaving auth users with no profile).

**Never run against production automatically.** Always use DEV/STAGING credentials.

See implementation-notes.md for full architecture documentation.
