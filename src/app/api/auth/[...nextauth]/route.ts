/**
 * NextAuth v5 route handler — handles GET and POST for all /api/auth/* paths.
 *
 * Includes:
 *   GET  /api/auth/session
 *   POST /api/auth/signin
 *   POST /api/auth/signout
 *   GET  /api/auth/callback/google
 *   GET  /api/auth/providers
 *   GET  /api/auth/csrf
 */
import { handlers } from '@/auth';

export const { GET, POST } = handlers;
