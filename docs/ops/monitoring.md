# Monitoring — propflow staging

## Uptime monitoring (UptimeRobot — free, 50 monitors)

UptimeRobot free tier provides 5-minute check intervals with email + Slack alerting.
That is sufficient for MVP staging.

### Setup steps (human)

1. Create a free account at https://uptimerobot.com
2. Click "Add New Monitor"
3. Type: HTTPS
4. Friendly name: propflow-staging-landing
5. URL: https://<your-slug>.vercel.app/
   (The public marketing landing page — must return 200 with no auth redirect.)
6. Monitoring interval: 5 minutes
7. Alert contacts: add your email; optionally add a Slack webhook.
8. Click "Create Monitor".
9. Add a second monitor for the login page:
   Friendly name: propflow-staging-login
   URL: https://<your-slug>.vercel.app/login
10. Verify both monitors show "Up" within 5 minutes of the first staging deploy.

This directly matches the deployed_staging smoke test in spec.md:
- / (landing) returns 200, public, no redirect
- /login loads (auth screen)

## Error tracking (Sentry — free, 5k errors/month)

### Setup steps (human)

1. Create a free account at https://sentry.io
2. Create a new project: Platform = "Next.js", Project name = "propflow"
3. Copy the DSN from: Sentry → Project → Settings → Client Keys → DSN
4. Add the DSN to Vercel env vars:
   Vercel → Project → Settings → Environment Variables
   Key: SENTRY_DSN
   Value: <your DSN>
   Environments: Preview + Production (check both)
5. The senior-dev wires `@sentry/nextjs` in the application code.

### What to watch on staging

- Error rate spikes on any route (especially /api/* and Server Actions)
- Auth failures (401/403 responses)
- RLS policy violations surfaced as 403 or unexpected empty data

## Vercel built-in analytics

Vercel Hobby includes basic request analytics visible in the Vercel dashboard.
No setup needed — visible immediately after first deploy.
Check: Vercel → Project → Analytics tab.

## Supabase dashboard

Supabase free tier provides:
- Database metrics (connections, query count, DB size) under Dashboard → Reports
- Auth logs under Dashboard → Authentication → Logs
- Edge Function logs (if used) under Dashboard → Edge Functions

Review auth logs weekly during staging to catch anomalous login attempts.
