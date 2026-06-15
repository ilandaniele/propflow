/**
 * NextAuth v5 — main export.
 *
 * Import { auth, signIn, signOut, handlers } from here throughout the app.
 * Never import from 'next-auth' directly in application code — always from '@/auth'.
 */
import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth/config';

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
