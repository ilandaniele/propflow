/**
 * NextAuth v5 type augmentations.
 *
 * Extends the default Session and User types to include PropFlow-specific
 * fields: orgId and role. These are populated in the session callback
 * from the profiles table.
 *
 * AC4: auth() session.user must contain { id, orgId, role, email }.
 */
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      orgId: string;
      role: 'admin' | 'tenant';
      email: string;
      name?: string | null;
      image?: string | null;
    } & DefaultSession['user'];
  }

  interface User {
    orgId?: string;
    role?: 'admin' | 'tenant';
  }
}
