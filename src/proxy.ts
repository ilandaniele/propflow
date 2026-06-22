import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Generate nonce for strict CSP
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${process.env.TIGRIS_ENDPOINT ?? 'https://fly.storage.tigris.dev'} https://accounts.google.com`,
    `img-src 'self' data: https: ${process.env.TIGRIS_ENDPOINT ?? 'https://fly.storage.tigris.dev'}`,
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "frame-src https://accounts.google.com",           // Google OAuth redirect/popup
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(process.env.CSP_REPORT_URI
      ? [`report-uri ${process.env.CSP_REPORT_URI}`]
      : []),
  ].join('; ');

  // Public routes — skip Supabase session check entirely (no auth needed, no env-var
  // dependency). This prevents a 500 when NEXT_PUBLIC_SUPABASE_URL resolves to a
  // placeholder in CI (Lighthouse job) or when env vars are absent on cold-start.
  //
  // Covered: landing page, login, forgot-password, sign pages, auth callback, onboarding.
  // These routes either have no auth requirement or handle their own auth guard in-page.
  const isFullyPublicRoute =
    path === '/' ||
    path === '/login' ||
    path === '/forgot-password' ||
    path.startsWith('/sign/') ||
    path.startsWith('/auth/') ||
    path === '/onboarding';

  if (isFullyPublicRoute) {
    const publicResponse = NextResponse.next({ request });
    publicResponse.headers.set('x-nonce', nonce);
    publicResponse.headers.set('Content-Security-Policy', csp);
    publicResponse.headers.set('X-Content-Type-Options', 'nosniff');
    publicResponse.headers.set('X-Frame-Options', 'DENY');
    publicResponse.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload'
    );
    publicResponse.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    publicResponse.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    publicResponse.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    return publicResponse;
  }

  // Fast-path session check: NextAuth v5 with strategy:'database' stores an opaque
  // session token cookie. Middleware cannot do a DB lookup (Edge runtime), so we check
  // cookie presence as a routing hint. Real auth validation happens in requireAdmin()
  // / requireTenant() in each page/layout — this is just a redirect shortcut.
  const hasSession =
    request.cookies.has('authjs.session-token') ||
    request.cookies.has('__Secure-authjs.session-token');
  const user = hasSession ? { app_metadata: {} } : null;

  const response = NextResponse.next({ request });

  // Pass nonce to layout via request header
  response.headers.set('x-nonce', nonce);
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains; preload'
  );
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Default: deny camera on all routes (least-privilege).
  // Tenant portal (/portal/*) relaxed to camera=(self) so that the
  // incident creation form's <input capture="environment"> can open
  // the device camera on mobile browsers that honour Permissions-Policy.
  // Admin dashboard, auth pages, and public routes keep camera=().
  // Ref: src/app/portal/incidents/new/page.tsx
  const cameraPolicy = path.startsWith('/portal')
    ? 'camera=(self), microphone=(), geolocation=()'
    : 'camera=(), microphone=(), geolocation=()';
  response.headers.set('Permissions-Policy', cameraPolicy);
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');

  // Route protection
  const isAdminRoute = path.startsWith('/dashboard');
  const isTenantRoute = path.startsWith('/portal');
  const isAuthRoute = path === '/login' || path === '/forgot-password';
  // Public routes — no auth required (security: token/secret gated by the Route Handler)
  // /auth/callback: PKCE code exchange must run before any session check (IC5)
  // /onboarding: unauthenticated guard is handled by the page Server Component itself
  const isPublicRoute =
    path.startsWith('/sign/') ||
    path.startsWith('/api/sign/') ||
    path.startsWith('/auth/') ||    // /auth/callback — must not be blocked before code exchange
    path === '/onboarding';          // guard is in the page itself (may have session but no profile)

  if (!user) {
    if (isPublicRoute) return response; // sign page — public, CSP still applied above
    if (isAdminRoute || isTenantRoute) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', path);
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  // User is authenticated — check role
  // We rely on RLS to enforce role at data layer; here we do fast route-level guard
  // Profile role is in the JWT app_metadata for quick checks
  const appMeta = (user as { app_metadata?: { role?: string } }).app_metadata;
  const role = appMeta?.role as string | undefined;

  if (isAdminRoute && role === 'tenant') {
    // Tenant trying to access admin area — redirect to portal
    return NextResponse.redirect(new URL('/portal', request.url));
  }

  if (isTenantRoute && role === 'admin') {
    // Admin trying to access tenant portal — redirect to dashboard
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Redirect authenticated users away from auth pages
  if (isAuthRoute) {
    if (role === 'admin') return NextResponse.redirect(new URL('/dashboard', request.url));
    if (role === 'tenant') return NextResponse.redirect(new URL('/portal', request.url));
  }

  return response;
}

// Phase 4 CSP note:
// MockWhatsAppProvider requires NO new connect-src domain (all calls are in-process / DB only).
// When a real provider is configured (future PR), add its domain here:
//   Meta Cloud API: https://graph.facebook.com
//   Twilio: https://api.twilio.com
// Environment-gate the addition: `...(process.env.WHATSAPP_PROVIDER === 'meta' ? ['https://graph.facebook.com'] : [])`
// This comment intentionally leaves the existing CSP unchanged.

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
