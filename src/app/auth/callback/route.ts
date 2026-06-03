/**
 * GET /auth/callback
 *
 * Handles the OAuth PKCE callback from Supabase (and will handle future flows like
 * magic link if ever added). Never returns a JSON body — all paths are 302 redirects.
 *
 * Flow:
 * 1. If provider-level error present → redirect /login?error=oauth_failed (fail closed).
 * 2. Exchange the PKCE `code` for a session cookie.
 * 3. Read the authenticated user.
 * 4. Check for an existing profile row (via admin client — bypasses RLS, no session needed).
 *    a. Profile exists  → redirect by role (/dashboard for admin, /portal for tenant).
 *    b. No profile      → attempt auto-link (AC2/AC3):
 *       - Exactly 1 unlinked tenant row matches email → create profile + set profile_id → /portal
 *       - 0 or 2+ matches → redirect /onboarding (existing behaviour)
 * 5. Any unhandled error → redirect /login?error=oauth_failed (fail closed).
 *
 * Security:
 * - PKCE code_verifier is validated by Supabase internally — no extra check needed.
 * - Admin client is used only for the profile SELECT and auto-link flow (not for the session exchange).
 * - Never leaks error.message or stack traces to the client.
 * - All failure paths redirect to /login?error=oauth_failed with no session.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getExistingProfile, attemptAutoLink } from '@/lib/auth/provision';
import { log } from '@/lib/log';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

function failRedirect(request: NextRequest): NextResponse {
  const url = new URL('/login', request.url);
  url.searchParams.set('error', 'oauth_failed');
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);

  // Step 1: provider-level error (e.g. user denied consent)
  const providerError = searchParams.get('error');
  if (providerError) {
    const desc = searchParams.get('error_description') ?? 'unknown';
    log.authFailure('', `oauth_provider_error:${providerError}:${desc}`);
    return failRedirect(request);
  }

  const code = searchParams.get('code');
  if (!code) {
    log.authFailure('', 'oauth_missing_code');
    return failRedirect(request);
  }

  try {
    // Step 2: exchange PKCE code for session (sets httpOnly cookies)
    const supabase = await createClient();
    const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError || !exchangeData?.user) {
      log.authFailure('', `oauth_exchange_failed:${exchangeError?.status ?? 'unknown'}`);
      return failRedirect(request);
    }

    const user = exchangeData.user;
    log.authSuccess(user.id, user.email ?? '');

    // Step 3: check for existing profile (admin client bypasses RLS — profile may not exist yet)
    const profile = await getExistingProfile(user.id);

    if (profile) {
      // Step 4a: profile exists → route by role
      const destination = profile.role === 'admin'
        ? new URL('/dashboard', SITE_URL)
        : new URL('/portal', SITE_URL);

      log.info('[callback] existing profile → routing by role', {
        event: 'oauth_callback_routed',
        userId: user.id,
        role: profile.role,
        destination: destination.pathname,
      });

      return NextResponse.redirect(destination);
    }

    // Step 4b: no profile — attempt auto-link by email (AC2 / AC3)
    // Only runs when the user has no profile row at all (first login).
    const userEmail = user.email ?? '';

    if (userEmail) {
      const autoLinkResult = await attemptAutoLink(user.id, userEmail);

      if (autoLinkResult.linked) {
        // Exactly one tenant matched — profile created and tenant linked → send to portal
        log.info('[callback] auto-link succeeded → redirecting to /portal', {
          event: 'oauth_callback_auto_linked',
          userId: user.id,
        });
        return NextResponse.redirect(new URL('/portal', SITE_URL));
      }

      if (autoLinkResult.reason === 'ambiguous_match') {
        // Multiple tenants share this email — do NOT auto-link; fall through to onboarding
        log.warn('[callback] auto-link skipped — ambiguous email match', {
          event: 'oauth_callback_ambiguous',
          userId: user.id,
        });
        // Fall through to onboarding below
      }

      // reason === 'no_match' || 'ambiguous_match' → onboarding
    }

    // Step 4c: no auto-link possible → onboarding
    log.info('[callback] no profile + no auto-link → redirecting to onboarding', {
      event: 'oauth_callback_onboarding',
      userId: user.id,
    });

    const onboardingUrl = new URL('/onboarding', SITE_URL);
    return NextResponse.redirect(onboardingUrl);

  } catch (err) {
    // Step 5: catch-all fail closed — never expose internal error
    const errName = err instanceof Error ? err.name : 'unknown';
    log.error('[callback] unhandled error — failing closed', { errName });
    return failRedirect(request);
  }
}
