import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { cache } from 'react';
import type { Session } from '@supabase/supabase-js';

// We don't pass the Database generic here to avoid strict type mismatches
// between our hand-written types and the supabase-js internal types.
// All operations are type-safe at the application layer via the Zod schemas.

/**
 * Returns (or creates) a Supabase SSR client for the current request.
 *
 * Wrapped in React.cache() so every Server Component and Server Action that
 * calls createClient() within the same React render pass receives the SAME
 * client instance — no extra cookies() awaits, no duplicate client construction.
 *
 * Safety note: React.cache() is request-scoped (it is reset for each incoming
 * request by React's server renderer). It cannot leak state between users or
 * requests. The underlying client still writes Set-Cookie headers via the
 * setAll hook, so session refresh propagates correctly.
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
 * Returns the current Supabase session by reading the cookie WITHOUT a network
 * round-trip to the Supabase Auth server.
 *
 * This is safe: src/proxy.ts middleware calls updateSession() → getUser() on
 * every matched request, validating the JWT and refreshing the cookie before
 * this Server Component runs. By the time the layout reads this value the
 * cookie already reflects the middleware-validated session state.
 *
 * Use this in layouts for fast, zero-latency session access. Pages that
 * perform data mutations or sensitive reads must continue to use
 * requireAdmin() / requireTenant() which call getUser() for full JWT
 * revalidation (defense in depth per spec IC5).
 *
 * Wrapped in React.cache() so repeated calls within one render pass (e.g.
 * layout + nested Server Components) are free — the getSession() call happens
 * at most once per React render pass.
 *
 * Returns null when no session is present (unauthenticated or expired and
 * middleware has already cleared the cookie).
 */
export const getSessionFast = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session;
});
