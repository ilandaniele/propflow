/**
 * NextAuth v5 configuration — server-only.
 *
 * Providers:
 *   - Google OAuth (AC2)
 *
 * Email/password auth does NOT use a NextAuth Credentials provider: under the
 * database session strategy that provider can't mint a session, and leaving it
 * wired only exposed an unthrottled bcrypt/enumeration oracle at
 * /api/auth/callback/credentials. Password login/sign-up go through the rate-
 * limited server actions in src/app/actions/auth.ts, which validate the password
 * and create the session directly (src/lib/auth/session.ts).
 *
 * Session strategy: database (via DrizzleAdapter) (AC4)
 *
 * Callbacks:
 *   - signIn: allow Google (provisioning happens in events.createUser)
 *   - session: augment session.user with { id, orgId, role } from profiles table
 *
 * Security:
 *   - User identity always fetched server-side; client-supplied userId is never trusted
 *   - No stack traces or PII in error returns
 */

import { DrizzleAdapter } from '@auth/drizzle-adapter';
import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users, accounts, sessions, verificationTokens, profiles } from '@/lib/db/schema';
import { provisionOrgAndProfile, getExistingProfile, attemptAutoLink, attachToPrimaryOrgAsAdmin } from './provision';
import { isAllowlistedAdmin } from './admin-allowlist';
import { log } from '@/lib/log';
import { withDbRetry } from '@/lib/db/retry';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const baseAdapter = DrizzleAdapter(db, { usersTable: users, accountsTable: accounts as any, sessionsTable: sessions, verificationTokensTable: verificationTokens });

// getSessionAndUser runs on EVERY authenticated request. On Fly Postgres a stale
// pooled socket makes this query throw `write CONNECTION_CLOSED`, which NextAuth
// turns into a SessionTokenError → the user is bounced to /login mid-session.
// Wrap just this hot-path lookup in the same retry used by the cron routes so a
// transient connection blip is retried instead of logging the user out.
// (A genuine "no session" returns null without throwing, so it is not retried.)
const resilientAdapter: NextAuthConfig['adapter'] = {
  ...baseAdapter,
  ...(baseAdapter.getSessionAndUser
    ? {
        getSessionAndUser: (sessionToken: string) =>
          withDbRetry(async () => baseAdapter.getSessionAndUser!(sessionToken), 'auth:getSessionAndUser'),
      }
    : {}),
} as NextAuthConfig['adapter'];

export const authConfig: NextAuthConfig = {
  adapter: resilientAdapter,

  session: {
    strategy: 'database',
  },

  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      // Google verifies email ownership, so linking a Google sign-in to an existing
      // user with the same email is safe here (and the events.linkAccount hook below
      // revokes any pre-existing self-asserted password on link). This lets the real
      // owner sign in with Google even if the email was previously password-squatted,
      // instead of being locked out with OAuthAccountNotLinked.
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          access_type: 'offline',
          prompt: 'select_account',
        },
      },
    }),
  ],

  callbacks: {
    async signIn({ user, account }) {
      // IMPORTANT: do NOT provision here. In @auth/core the signIn callback runs
      // BEFORE the adapter creates the user row (and user.id is the OAuth `sub`,
      // not the final DB uuid), so any profile insert keyed on user.id FK-fails
      // → AccessDenied. Provisioning happens in events.createUser (below), which
      // runs AFTER the user row is persisted with its real uuid.
      if (account?.provider === 'google') {
        if (!user.email) {
          log.error('[auth] signIn: Google user missing email');
          return false;
        }
        return true;
      }

      // Credentials provider — user row already exists from authorize(); allow
      return true;
    },

    async session({ session, user }) {
      // Augment session.user with orgId and role from profiles table (AC4).
      // Runs on every authenticated request; retry transient Fly-Postgres blips
      // (CONNECTION_CLOSED) so they don't invalidate an otherwise-valid session.
      try {
        const profile = await withDbRetry(
          () => db.query.profiles.findFirst({
            where: eq(profiles.userId, user.id),
            columns: { orgId: true, role: true },
          }),
          'auth:session-profile',
        );

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

  events: {
    /**
     * When a Google (email-verified) account is linked to an existing user, revoke
     * any self-asserted password on that user. A password set by someone who could
     * not prove ownership of the email must not survive a verified takeover — this
     * closes the account-squatting vector while keeping the verified owner in control.
     * No-op for fresh Google users (they have no password).
     */
    async linkAccount({ user, account }) {
      if (account?.provider !== 'google' || !user?.id) return;
      try {
        await db.update(users).set({ passwordHash: null }).where(eq(users.id, user.id));
      } catch (err) {
        log.error('[auth] linkAccount clear-password failed', {
          code: err instanceof Error ? err.message : 'unknown',
        });
      }
    },

    /**
     * Runs AFTER the adapter persists a brand-new user (real DB uuid, row exists).
     * This is the only safe place to provision the org/profile for OAuth sign-ups —
     * the signIn callback runs too early (no users row yet).
     *
     * Email/password sign-up does NOT trigger this event (the user is inserted
     * manually in registerWithEmail, which provisions inline), so there is no
     * double-provisioning.
     */
    async createUser({ user }) {
      try {
        if (!user.id || !user.email) {
          log.error('[auth] createUser event: missing id or email');
          return;
        }
        const email = user.email.trim().toLowerCase();

        // Idempotency guard — a brand-new user should never already have a profile.
        const existing = await getExistingProfile(user.id);
        if (existing) return;

        if (isAllowlistedAdmin(email)) {
          // Allowlisted co-admin — attach to the primary org as admin.
          await attachToPrimaryOrgAsAdmin(user.id, email, user.name ?? null);
        } else {
          // Default self-serve — fresh org + admin profile, then best-effort
          // auto-link to an existing tenant row.
          await provisionOrgAndProfile(user.id, email, user.name ?? email);
          await attemptAutoLink(user.id, email);
        }
      } catch (err) {
        // Never throw from an event — it would abort the sign-in. Log instead;
        // the session callback surfaces the missing profile as account_not_created.
        const code = err instanceof Error ? err.message : 'unknown';
        log.error('[auth] createUser provisioning failed', { code });
      }
    },
  },

  pages: {
    signIn: '/login',
  },

  // Trusthost required on Vercel (host header comes from the CDN)
  trustHost: true,
};
