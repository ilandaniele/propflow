/**
 * Supabase SSR client — STORAGE-ONLY after W3 migration.
 *
 * This file retains `createClient` as a transitional export while W4 migrates
 * all server actions and pages to Drizzle. Once W4 is complete, this file
 * should export only `createStorageClient` and `getSessionFast`.
 *
 * `getSessionFast` now uses NextAuth `auth()` instead of Supabase session cookies.
 * It is used in layouts for fast, zero-network session reads.
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { cache } from 'react';
import type { Session as NextAuthSession } from 'next-auth';
import { auth } from '@/auth';

// ---------------------------------------------------------------------------
// NextAuth-backed session helper (replaces old Supabase getSessionFast)
// ---------------------------------------------------------------------------

/**
 * Returns the current NextAuth session for the current request.
 *
 * Backed by React.cache() so the session lookup happens at most once per
 * React render pass (layout + nested Server Components).
 *
 * Returns null when no session is present (unauthenticated or expired).
 * The middleware (src/proxy.ts) validates the session on every request;
 * by the time the layout calls this, the session is already validated.
 *
 * LAYOUTS ONLY: For authorization in Server Actions / Route Handlers,
 * use requireAdmin() / requireTenant() from @/lib/auth/guards instead.
 */
export const getSessionFast = cache(async (): Promise<NextAuthSession | null> => {
  return auth();
});

// ---------------------------------------------------------------------------
// Supabase SSR client — transitional (for storage operations and W4 migration)
// ---------------------------------------------------------------------------

/**
 * Returns (or creates) a Supabase SSR client for the current request.
 *
 * After W4 migration, this will only be used for Supabase Storage operations.
 * Direct DB operations (supabase.from()) should be replaced with Drizzle in W4.
 *
 * Wrapped in React.cache() so repeated calls within one render pass receive
 * the same client instance.
 */
export const createClient = cache(async () => {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              store.set(name, value, options)
            );
          } catch {
            // set() is only allowed in Server Actions / Route Handlers
          }
        },
      },
    }
  );
});

/**
 * Storage-specific Supabase client.
 * Use this for all Supabase Storage bucket operations.
 */
export const createStorageClient = cache(async () => createClient());
