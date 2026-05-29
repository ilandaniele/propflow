import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Generate nonce for strict CSP
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://*.supabase.co'} wss://*.supabase.co`,
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(process.env.CSP_REPORT_URI
      ? [`report-uri ${process.env.CSP_REPORT_URI}`]
      : []),
  ].join('; ');

  // Get session/user
  const { response, user } = await updateSession(request);

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
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  );
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');

  // Route protection
  const isAdminRoute = path.startsWith('/dashboard');
  const isTenantRoute = path.startsWith('/portal');
  const isAuthRoute = path === '/login' || path === '/forgot-password';

  if (!user) {
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

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
