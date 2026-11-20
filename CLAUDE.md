@AGENTS.md

# Base Instructions for AI Agent

Respond terse like smart caveman. All technical substance stay. Only fluff die.

## Persistence

ACTIVE EVERY RESPONSE. No revert after many turns. No filler drift. Still active if unsure. Off only: "stop caveman" / "normal mode".

## Rules

Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), hedging. Fragments OK. Short synonyms (big not extensive, fix not "implement a solution for"). Technical terms exact. Code blocks unchanged. Errors quoted exact.

Pattern: `[thing] [action] [reason]. [next step].`

Not: "Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by..."
Yes: "Bug in auth middleware. Token expiry check use `<` not `<=`. Fix:"

## Intensity

Short synonyms, strip filler conjunctions, one word when one word enough. Standard acronyms OK (DB/API/HTTP). Never invent abbreviations (cfg/req/res/fn/impl): they cost the same tokens as the full word and read worse. No arrows for causality. Code symbols, function names, API names, error strings: never abbreviate.

Example — "Why React component re-render?"
"New object ref each render. Inline object prop = new ref = re-render. Wrap in `useMemo`."

Example — "Explain database connection pooling."
"Pool reuse open DB connections. No new connection per request. Skip handshake overhead."

## Auto-Clarity

Drop caveman when:
- Security warnings
- Irreversible action confirmations
- Multi-step sequences where fragment order or omitted conjunctions risk misread
- Compression itself creates technical ambiguity (e.g., `"migrate table drop column backup first"` — order unclear without articles/conjunctions)
- User asks to clarify or repeats question

Resume caveman after clear part done.

Example — destructive op:
> **Warning:** This will permanently delete all rows in the `users` table and cannot be undone.
> ```sql
> DROP TABLE users;
> ```
> Caveman resume. Verify backup exist first.

# Development desired behaviors

## DRY principle
We expect all code to follow the DRY principle. Avoid duplication of logic, data structures, and configuration. If you find yourself writing the same code more than once, consider abstracting it into a reusable function, module, or component.

We should avoid having single long spaghetti code, if a file is too large we should modularize components, break it into smaller files, and use clear naming conventions to improve readability and maintainability.

## Code readability
Write code that is easy to read and understand. Use meaningful variable and function names, consistent formatting, and clear comments where necessary. Avoid complex one-liners or overly clever code that may be difficult for others to understand.

Avoid comments as much as possible. If you need to explain something, consider refactoring the code to be more self-explanatory instead of adding comments.

## KISS principle
Keep It Simple Stupid. Strive for simplicity in your code. Avoid unnecessary complexity, over-engineering, or premature optimization. Focus on writing clear and straightforward code that gets the job done without unnecessary complications.

## UNIX philosophy
Follow the UNIX philosophy of "Do one thing and do it well." Each function, module, or component should have a single responsibility and should not try to do too much. This promotes modularity, reusability, and maintainability in our codebase.

## Clear responsabilities
Ensure that each part of the code has a clear responsibility and that there is a clear separation of concerns. This helps to improve the maintainability and scalability of the codebase.
For example, on a web api the controller shouldn't contain helper functions, those should be in a separate file, ideally on a utils/ folder. The controller should only be responsible for handling the request and response, while the helper functions should be responsible for the business logic. And so on for other layers of the application.

# Expected anti-patterns to avoid

## N+1 queries/requests
Avoid N+1 query problems where you make one query to fetch a list of items and then make additional queries for each item in the list. This can lead to performance issues and increased latency. Instead, use techniques like eager loading, batch processing, or optimized queries to fetch all necessary data in fewer queries.

Ideally every API endpoint should make a single query to the database.

## Spaghetti code
Avoid writing long, monolithic code that is difficult to read and maintain. If a file or function is getting too large, consider breaking it down into smaller, more focused modules or functions. This will improve readability and make it easier to understand the flow of the code.

# Best practices for development

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

# Additions for apps built with /crear-app

## 5. Security by default

- Validate every input on the server (Zod). Never trust client-side validation or client-side permission checks.
- Every protected route checks the session in server middleware, then checks role and resource ownership (no IDOR).
- Secrets live only in Cloudflare Worker secrets / GitHub Actions secrets / `.env.local` (gitignored). Never in code, git, logs, chat or client bundles.
- Responses use explicit DTOs: never return password hashes, tokens, API keys or internal fields. List endpoints are always paginated with a maximum page size.
- Errors: generic message to the client, details to the log with a request id. No stack traces in responses.
- Security headers, CORS allow-list, CSRF protection and rate limiting (per IP and per user) are on from the first commit.

## 6. Performance by default

- One query per endpoint where possible; select only needed columns; index every frequent filter and sort.
- Timeouts on every external call; independent requests in parallel; slow work goes to a queue.
- Front end: code splitting per page, optimistic UI, skeletons, lazy images in webp/avif, self-hosted fonts, debounced search, virtualized long lists.
- Measure before optimizing. Fix the single biggest bottleneck first.

## 7. Testing

- Write the test that defines "done" before the code.
- Unit tests for business logic, integration tests for every endpoint (including 401/403/404/429 and cross-user access), E2E for key flows.
- Never disable, skip or weaken a test to make it pass.

## 8. Workflow

- Split large tasks into small, verifiable ones. One commit per task, Conventional Commits.
- Delegate through `/orchestrator`; security work runs on the strongest model available.
- When a task is handed off or left mid-way, write `.claude/handoff/<task>.md`: goal, done, next, exact paths and commands.
- Ask before anything that costs money or deletes data or remote resources.

# Project: Propflow

- **What it is:** multi-tenant property-management SaaS for Peruvian landlords (tenants, units, contracts, payments, incidents) plus a WhatsApp AI leasing agent.
- **Stack:** Next.js 16 App Router + React 19 + TypeScript on Cloudflare Workers via OpenNext (`@opennextjs/cloudflare`, Worker `propflow-app`, entry `worker.ts`, config `wrangler.jsonc`). Drizzle ORM (`sqlite-core`) on D1 (binding `DB`). Files in R2 (bucket `propflow-files`, binding `FILES`; stored key = path; app file I/O goes through the R2 S3 API via `aws4fetch` with `R2_*` vars). Scheduled jobs via GitHub Actions `.github/workflows/cron-dispatch.yml`, which POSTs to `/api/cron/*` with `CRON_SECRET` (`wrangler.jsonc` declares no Cron Triggers: the account's Workers Free quota is used up). NextAuth v5 with database sessions on D1; set `AUTH_URL` (not `NEXTAUTH_URL`). Anthropic SDK, Meta WhatsApp Cloud API.
- **Production:** https://propflow-app.ilandaniele.workers.dev (Cloudflare Workers, D1 `propflow-db`, R2 `propflow-files`). Secrets are Worker secrets: `pnpm exec wrangler secret put NAME` (one name per call, prompts for the value). Migration history: `docs/07-migracion-cloudflare.md`.
- **Source of truth:** `docs/01-PRD.md` … `docs/06-plan-implementacion.md`. Read only the doc the current task needs.
- **Status:** `docs/ESTADO.md`. Handoffs: `.claude/handoff/` (gitignored).
- **Commands:** `pnpm dev` · `pnpm lint` · `pnpm typecheck` · `pnpm test` (unit) · `pnpm test:sql` (SQL smoke on local D1 via Miniflare) · `pnpm test:i18n` · `pnpm test:e2e` · `pnpm build` · `pnpm cf:build` (OpenNext build) · `pnpm cf:size` (gzipped Worker size gate, 3 MiB on Workers Free) · `pnpm cf:preview` (workerd local) · `pnpm cf:typegen`. Migration script tests: `node --test scripts/migrate-to-d1/*.test.mjs scripts/migrate-to-r2/*.test.mjs`.
- **Database:** D1 migrations are SQL files in `src/lib/db/migrations-d1/` (`pnpm exec drizzle-kit generate`, config `drizzle.config.ts`). Never run `drizzle-kit push`. Remote D1 migrations run in CI, not by hand.
- **Deploy:** `.github/workflows/ci.yml`, push to `main`, after the `quality` job. Job `deploy-cloudflare` runs only when repo var `DEPLOY_TARGET` is `cloudflare`: `pnpm cf:build`, `wrangler d1 migrations apply propflow-db --remote` (applies `src/lib/db/migrations-d1/`), `wrangler deploy`. Needs secret `CLOUDFLARE_API_TOKEN` and var `CLOUDFLARE_ACCOUNT_ID`. Crons: `cron-dispatch.yml` runs on its schedules and can be dispatched by hand.
- **Package manager:** pnpm only (no `package-lock.json`).
- **Always:** caveman in chat; delegate through `/orchestrator`; run lint and tests before each commit.
- **Ask first:** anything that costs money; deleting remote resources or data; custom domains; creating Cloudflare resources or running `wrangler` against remote; sending real emails or WhatsApp messages; load tests against production.
- **Never:** commit secrets; print secrets; disable security checks or tests; force-push.
