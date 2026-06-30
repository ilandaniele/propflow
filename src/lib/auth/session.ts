/**
 * Manual database-session creation — SERVER ONLY.
 *
 * NextAuth v5's Credentials provider does NOT create a session under
 * `session.strategy: 'database'` (it requires JWT). Since this app uses database
 * sessions for Google OAuth, we issue the session for email/password sign-in
 * ourselves: insert a row into the same `sessions` table NextAuth reads, and set
 * the same opaque session-token cookie NextAuth expects. `auth()` then resolves
 * it exactly like an OAuth session (getSessionAndUser → session callback).
 */

import { randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { sessions } from '@/lib/db/schema';

// Matches NextAuth's default session maxAge (30 days).
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function isSecureContext(): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  const url = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '';
  return url.startsWith('https://');
}

/**
 * Create a database session for `userId` and set the NextAuth session cookie.
 * The cookie name mirrors NextAuth's default (with the __Secure- prefix on HTTPS),
 * so the existing middleware cookie check and `auth()` both recognise it.
 */
export async function createUserSession(userId: string): Promise<void> {
  const sessionToken = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_MAX_AGE_MS);

  await db.insert(sessions).values({ sessionToken, userId, expires });

  const secure = isSecureContext();
  const cookieName = secure ? '__Secure-authjs.session-token' : 'authjs.session-token';

  const cookieStore = await cookies();
  cookieStore.set(cookieName, sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    expires,
  });
}
