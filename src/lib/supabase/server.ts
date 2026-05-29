import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// We don't pass the Database generic here to avoid strict type mismatches
// between our hand-written types and the supabase-js internal types.
// All operations are type-safe at the application layer via the Zod schemas.
export async function createClient() {
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
}
