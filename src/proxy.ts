import { auth } from '@/auth';
import { NextResponse } from 'next/server';

/**
 * PropFlow middleware — NextAuth v5 pattern.
 *
 * Replaces the old Supabase updateSession() approach.
 * auth() validates the database session on every matched request.
 *
 * Route protection:
 *   - No session + /dashboard/* or /portal/* → redirect /login
 *   - tenant session + /dashboard/* → redirect /portal
 *   - admin session + /portal/* → redirect /dashboard
 *   - Authenticated user on /login or /register → redirect by role
 *
 * CSP nonce is generated per-request and forwarded via x-nonce header.
 * The layout reads this header to inject the nonce into <Script> tags.
 */
export default auth(function middleware(req) {
  const { nextUrl } = req;
  const session = req.auth;
  const path = nextUrl.pathname;

  // Generate per-request nonce for strict CSP
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://*.supabase.co'} wss://*.supabase.co https://accounts.google.com`,
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "frame-src https://accounts.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(process.env.CSP_REPORT_URI
      ? [`report-uri ${process.env.CSP_REPORT_URI}`]
      : []),
  ].join('; ');

  const securityHeaders: Record<string, string> = {
    'x-nonce': nonce,
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // Tenant portal allows camera so incident creation form works on mobile
    'Permissions-Policy': path.startsWith('/portal')
      ? 'camera=(self), microphone=(), geolocation=()'
      : 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };

  const isLoggedIn = !!session;
  const role = session?.user?.role;

  const isOnDashboard = path.startsWith('/dashboard');
  const isOnPortal = path.startsWith('/portal');
  const isAuthPage = path === '/login' || path === '/register' || path === '/forgot-password';

  // 1. Unauthenticated -> redirect protected routes to /login (AC5)
  if (!isLoggedIn && (isOnDashboard || isOnPortal)) {
    const loginUrl = new URL('/login', nextUrl);
    loginUrl.searchParams.set('redirect', path);
    return NextResponse.redirect(loginUrl);
  }

  // 2. Tenant accessing admin area -> redirect to /portal (AC6)
  if (isLoggedIn && role === 'tenant' && isOnDashboard) {
    return NextResponse.redirect(new URL('/portal', nextUrl));
  }

  // 3. Admin accessing tenant portal -> redirect to /dashboard (AC9 inverse)
  if (isLoggedIn && role === 'admin' && isOnPortal) {
    return NextResponse.redirect(new URL('/dashboard', nextUrl));
  }

  // 4. Authenticated user on auth pages -> redirect by role
  if (isLoggedIn && isAuthPage) {
    if (role === 'admin') return NextResponse.redirect(new URL('/dashboard', nextUrl));
    if (role === 'tenant') return NextResponse.redirect(new URL('/portal', nextUrl));
  }

  // Pass through — apply security headers
  const response = NextResponse.next({ request: req });
  for (const [key, value] of Object.entries(securityHeaders)) {
    response.headers.set(key, value);
  }
  return response;
});

// Phase 4 CSP note:
// MockWhatsAppProvider requires NO new connect-src domain (all calls are in-process / DB only).
// When a real provider is configured (future PR), add its domain here:
//   Meta Cloud API: https://graph.facebook.com
//   Twilio: https://api.twilio.com
// Environment-gate the addition:
//   `...(process.env.WHATSAPP_PROVIDER === 'meta' ? ['https://graph.facebook.com'] : [])`

export const config = {
  matcher: [
    // Skip NextAuth API routes, Next.js internals, and static assets (AC7)
    '/((?!api/auth|_next/static|_next/image|favicon.ico|api/health|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
