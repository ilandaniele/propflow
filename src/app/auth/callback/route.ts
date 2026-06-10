/**
 * GET /auth/callback
 *
 * Handles the OAuth PKCE callback from Supabase. Never returns a JSON body —
 * all paths are 302 redirects.
 *
 * Flow:
 * 1. If provider-level error present → redirect /login?error=oauth_cancelled (fail closed).
 * 2. Exchange the PKCE `code` for a session cookie.
 * 3. Read the authenticated user. Normalize email: trim + toLowerCase.
 * 4. Check for an existing profile row (via admin client — bypasses RLS).
 *    a. Profile exists → read auth_redirect_to cookie; redirect there or role home.
 *    b. No profile    → attempt auto-link (AC2/AC3):
 *       - Exactly 1 unlinked tenant row matches normalized email → create profile
 *         + link tenant → read auth_redirect_to cookie or /portal
 *       - 0 or 2+ matches → redirect /onboarding?type=tenant
 * 5. Any unhandled error → redirect /login?error=invalid_callback (fail closed).
 *
 * Error query params:
 *   oauth_cancelled          — user denied Google consent
 *   invalid_callback         — missing code or exchange failed
 *   missing_email            — Google returned no email
 *   email_conflict           — duplicate email detected
 *   airtable_unavailable     — account created but Airtable sync failed
 *   local_created_airtable_failed — account created locally, sync failed
 *
 * Security:
 * - PKCE code_verifier is validated by Supabase internally.
 * - Admin client used only for profile SELECT and auto-link (not session exchange).
 * - Never leaks error.message or stack traces to client.
 * - auth_redirect_to cookie is cleared after use.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getExistingProfile, attemptAutoLink } from '@/lib/auth/provision';
import { log } from '@/lib/log';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

const ALLOWED_REDIRECT_PATHS = ['/portal', '/dashboard', '/onboarding', '/settings'];

function isSafeRedirectPath(path: string): boolean {
  // Only allow relative paths starting with /; reject absolute URLs to prevent open redirect
  if (!path.startsWith('/')) return false;
  // Block protocol-relative URLs (//evil.com)
  if (path.startsWith('//')) return false;
  return ALLOWED_REDIRECT_PATHS.some(allowed => path === allowed || path.startsWith(allowed + '/'));
}

function readRedirectCookie(request: NextRequest): string | null {
  const raw = request.cookies.get('auth_redirect_to')?.value;
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    return isSafeRedirectPath(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function clearRedirectCookie(response: NextResponse): void {
  response.cookies.set('auth_redirect_to', '', {
    maxAge: 0,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

function loginRedirect(request: NextRequest, errorCode: string): NextResponse {
  const url = new URL('/login', request.url);
  url.searchParams.set('error', errorCode);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);

  // Step 1: provider-level error (e.g. user denied Google consent)
  const providerError = searchParams.get('error');
  if (providerError) {
    // Log only error name/code — never description (may contain PII)
    log.authFailure('', `oauth_provider_error:${providerError}`);
    return loginRedirect(request, 'oauth_cancelled');
  }

  const code = searchParams.get('code');
  if (!code) {
    log.authFailure('', 'oauth_missing_code');
    return loginRedirect(request, 'invalid_callback');
  }

  try {
    // Step 2: exchange PKCE code for session (sets httpOnly cookies)
    const supabase = await createClient();
    const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError || !exchangeData?.user) {
      log.authFailure('', `oauth_exchange_failed:${exchangeError?.status ?? 'unknown'}`);
      return loginRedirect(request, 'invalid_callback');
    }

    const user = exchangeData.user;

    // Step 3: normalize email — trim + toLowerCase
    const rawEmail = user.email ?? '';
    if (!rawEmail) {
      log.authFailure(user.id, 'oauth_missing_email');
      return loginRedirect(request, 'missing_email');
    }
    const userEmail = rawEmail.trim().toLowerCase();

    log.authSuccess(user.id, userEmail);

    // Step 4: check for existing profile (admin client bypasses RLS)
    const profile = await getExistingProfile(user.id);

    if (profile) {
      // Step 4a: profile exists → redirect by role (or auth_redirect_to cookie)
      const cookieDest = readRedirectCookie(request);
      const defaultDest = profile.role === 'admin' ? '/dashboard' : '/portal';
      const destination = new URL(cookieDest ?? defaultDest, SITE_URL);

      log.info('[callback] existing profile → routing', {
        event: 'oauth_callback_routed',
        userId: user.id,
        role: profile.role,
        destination: destination.pathname,
      });

      const response = NextResponse.redirect(destination);
      clearRedirectCookie(response);
      return response;
    }

    // Step 4b: no profile — attempt auto-link by normalized email
    const autoLinkResult = await attemptAutoLink(user.id, userEmail);

    if (autoLinkResult.linked) {
      log.info('[callback] auto-link succeeded → redirecting', {
        event: 'oauth_callback_auto_linked',
        userId: user.id,
      });
      const cookieDest = readRedirectCookie(request);
      const destination = new URL(cookieDest ?? '/portal', SITE_URL);
      const response = NextResponse.redirect(destination);
      clearRedirectCookie(response);
      return response;
    }

    if (autoLinkResult.reason === 'ambiguous_match') {
      log.warn('[callback] auto-link skipped — ambiguous email match', {
        event: 'oauth_callback_ambiguous',
        userId: user.id,
      });
    }

    // Step 4c: no auto-link → send to onboarding as new tenant
    log.info('[callback] no profile + no auto-link → onboarding', {
      event: 'oauth_callback_onboarding',
      userId: user.id,
    });

    const onboardingUrl = new URL('/onboarding', SITE_URL);
    onboardingUrl.searchParams.set('type', 'tenant');
    const response = NextResponse.redirect(onboardingUrl);
    clearRedirectCookie(response);
    return response;

  } catch (err) {
    // Step 5: catch-all fail closed — never expose internal error
    const errName = err instanceof Error ? err.name : 'unknown';
    log.error('[callback] unhandled error — failing closed', { errName });
    return loginRedirect(request, 'invalid_callback');
  }
}
