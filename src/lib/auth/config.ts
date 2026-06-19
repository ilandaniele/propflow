/**
 * NextAuth v5 configuration — server-only.
 *
 * Providers:
 *   - Google OAuth (AC2)
 *   - Credentials (email + password via bcryptjs) (AC3)
 *
 * Session strategy: database (via DrizzleAdapter) (AC4)
 *
 * Callbacks:
 *   - signIn: provision org+profile on first Google login; attempt auto-link
 *   - session: augment session.user with { id, orgId, role } from profiles table
 *
 * Security:
 *   - Credentials authorize() never returns a truthy value for invalid passwords
 *   - User identity always fetched server-side; client-supplied userId is never trusted
 *   - No stack traces or PII in error returns
 */

import { DrizzleAdapter } from '@auth/drizzle-adapter';
import bcryptjs from 'bcryptjs';
import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users, accounts, sessions, verificationTokens, profiles } from '@/lib/db/schema';
import { provisionOrgAndProfile, getExistingProfile, attemptAutoLink } from './provision';
import { log } from '@/lib/log';

export const authConfig: NextAuthConfig = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: DrizzleAdapter(db, { usersTable: users, accountsTable: accounts as any, sessionsTable: sessions, verificationTokensTable: verificationTokens }) as NextAuthConfig['adapter'],

  session: {
    strategy: 'database',
  },

  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      authorization: {
        params: {
          access_type: 'offline',
          prompt: 'select_account',
        },
      },
    }),

    Credentials({
      name: 'Email',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (
          typeof credentials?.email !== 'string' ||
          typeof credentials?.password !== 'string'
        ) {
          return null;
        }

        const email = credentials.email.trim().toLowerCase();
        const password = credentials.password;

        try {
          const user = await db.query.users.findFirst({
            where: eq(users.email, email),
          });

          if (!user?.passwordHash) {
            // No user or no password (OAuth-only account) — fail silently
            return null;
          }

          const valid = await bcryptjs.compare(password, user.passwordHash);
          if (!valid) return null;

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
          };
        } catch (err) {
          const code = err instanceof Error ? err.name : 'unknown';
          log.error('[auth] credentials authorize error', { code });
          return null;
        }
      },
    }),
  ],

  callbacks: {
    async signIn({ user, account }) {
      // Only run provisioning for Google OAuth on sign-in
      if (account?.provider === 'google') {
        if (!user.email) {
          log.error('[auth] signIn: Google user missing email', { userId: user.id });
          return false;
        }

        const email = user.email.trim().toLowerCase();

        try {
          // Check if a profile already exists (returning user)
          const existing = user.id ? await getExistingProfile(user.id) : null;

          if (!existing) {
            // First Google login — provision org + profile
            await provisionOrgAndProfile(
              user.id!,
              email,
              user.name ?? email
            );

            // Attempt auto-link to existing tenant row (best-effort)
            await attemptAutoLink(user.id!, email);
          }

          return true;
        } catch (err) {
          const code = err instanceof Error ? err.name : 'unknown';
          log.error('[auth] signIn callback error', { code, provider: 'google' });
          return false;
        }
      }

      // Credentials provider — user row already exists from authorize(); allow
      if (account?.provider === 'credentials') {
        return true;
      }

      return true;
    },

    async session({ session, user }) {
      // Augment session.user with orgId and role from profiles table (AC4)
      try {
        const profile = await db.query.profiles.findFirst({
          where: eq(profiles.userId, user.id),
          columns: { orgId: true, role: true },
        });

        if (!profile?.orgId) {
          log.error('[auth] session callback: profile missing or has no orgId — invalidating session', { userId: user.id });
          // Returning null invalidates the session in NextAuth v5
          return null as unknown as typeof session;
        }
        session.user.orgId = profile.orgId;
        session.user.role = profile.role as 'admin' | 'tenant';
      } catch (err) {
        const code = err instanceof Error ? err.name : 'unknown';
        log.error('[auth] session callback: profile fetch failed — invalidating session', { code, userId: user.id });
        return null as unknown as typeof session;
      }

      // Ensure id is always set
      session.user.id = user.id;

      return session;
    },
  },

  pages: {
    signIn: '/login',
  },

  // Trusthost required on Vercel (host header comes from the CDN)
  trustHost: true,
};
