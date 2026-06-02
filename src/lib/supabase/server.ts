import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { cache } from 'react';

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
