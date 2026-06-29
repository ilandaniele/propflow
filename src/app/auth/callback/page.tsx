import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { auth } from '@/auth';

/**
 * Post-OAuth dispatch route — `/auth/callback`.
 *
 * NextAuth (Google) redirects here after the OAuth round-trip completes, because
 * GoogleSignInButton sets this path as the `callbackUrl`. The actual OAuth code
 * exchange is handled by NextAuth at `/api/auth/callback/google`; by the time we
 * reach this page the session cookie (if any) is already set.
 *
 * This route exists ONLY to dispatch the user to the correct area:
 *   - admin  → /dashboard
 *   - tenant → /portal
 * honouring an optional same-origin `auth_redirect_to` cookie (intended destination).
 *
 * Failure handling — so the user never sees a blank 404 again:
 *   - provider returned an explicit error (e.g. user denied) → /login?error=oauth_failed
 *   - no session at all (OAuth did not produce a session)    → /login?error=oauth_failed
 *   - session exists but no provisioned profile/role         → /login?error=account_not_created
 *
 * This replaces the legacy Supabase `/auth/callback` PKCE handler that was removed
 * during the Drizzle/NextAuth migration but never recreated.
 */
export const dynamic = 'force-dynamic';

/**
 * Allow only same-origin absolute paths. Rejects protocol-relative URLs (`//evil`)
 * and anything carrying a scheme, to prevent open-redirect via the cookie.
 */
function safeInternalPath(value: string | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}

export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  // Provider-side OAuth error (e.g. access_denied) — surface as a clean retry.
  if (params?.error) {
    redirect('/login?error=oauth_failed');
  }

  const session = await auth();

  // No session — OAuth did not complete / no account was established.
  if (!session?.user?.id) {
    redirect('/login?error=oauth_failed');
  }

  // Authenticated, but the profile/org was never provisioned (session callback
  // could not resolve a role). Tell the user their account was not created.
  const role = session.user.role;
  if (role !== 'admin' && role !== 'tenant') {
    redirect('/login?error=account_not_created');
  }

  // Success — dispatch by role, honouring an intended same-origin destination.
  const cookieStore = await cookies();
  const intended = safeInternalPath(cookieStore.get('auth_redirect_to')?.value);
  const fallback = role === 'admin' ? '/dashboard' : '/portal';

  redirect(intended ?? fallback);
}
