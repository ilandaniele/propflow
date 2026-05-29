# PropFlow — Property & Tenant Management SaaS

A premium, multi-tenant property management platform built with Next.js 16, Supabase, and Tailwind CSS v4.

## Setup — Local Development

```bash
npm install
cp .env.example .env.local  # fill in Supabase credentials
npx supabase start          # start local Supabase (requires Docker)
npx supabase db push --local
npx tsx scripts/seed.ts     # create demo orgs + users
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
npm run seed             # run seed script
```

See implementation-notes.md for full architecture documentation.
