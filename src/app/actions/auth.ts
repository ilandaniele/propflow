'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import bcryptjs from 'bcryptjs';
import { signOut as nextAuthSignOut } from '@/auth';
import { err, Errors } from '@/lib/errors';
import { log } from '@/lib/log';
import { checkRateLimit } from '@/lib/ratelimit';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { provisionUser } from '@/lib/auth/provision';
import { createUserSession } from '@/lib/auth/session';

const BCRYPT_COST = 12;

// A valid bcrypt hash used to keep the login path constant-time when the email
// doesn't exist — prevents user enumeration via response timing. The password is
// never this value; the compare simply always runs.
const DUMMY_PASSWORD_HASH = bcryptjs.hashSync('propflow-login-timing-guard', BCRYPT_COST);

const SignInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(200),
});

const ResetPasswordSchema = z.object({
  email: z.string().email(),
});

export type AuthState = {
  error?: { code: string; message: string };
  success?: boolean;
};

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const headersList = await headers();
  const forwardedFor = headersList.get('x-forwarded-for') ?? 'anonymous';
  const ip = forwardedFor.split(',')[0].trim();

  const rl = checkAuthRateLimitByIp(ip);
  if (!rl.success) {
    log.authFailure('', 'rate_limited');
    return Errors.RATE_LIMITED();
  }

  const parsed = SignInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return Errors.VALIDATION_ERROR(parsed.error.flatten());
  }

  const email = parsed.data.email.trim().toLowerCase();

  // Validate credentials and issue a database session ourselves. NextAuth's
  // Credentials provider can't create a session under strategy:'database', so we
  // do it directly (see src/lib/auth/session.ts). Same opaque-token mechanism as
  // OAuth sessions, so auth()/middleware resolve it identically.
  try {
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    // Always run a compare (against a dummy hash when the user/hash is absent) so
    // response timing doesn't reveal whether the email exists — no enumeration.
    const hashToCheck = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const passwordOk = await bcryptjs.compare(parsed.data.password, hashToCheck);
    if (!user?.passwordHash || !passwordOk) {
      log.authFailure(email, 'invalid_credentials');
      return err('AUTH_FAILED', 'Invalid email or password');
    }
    await createUserSession(user.id);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'unknown';
    log.authFailure(email, errMsg);
    return err('AUTH_FAILED', 'Invalid email or password');
  }

  log.authSuccess('', email);
  // /auth/callback dispatches by role (admin → /dashboard, tenant → /portal).
  redirect('/auth/callback');
}

export async function signOut(): Promise<void> {
  await nextAuthSignOut({ redirectTo: '/login' });
}

const RegisterSchema = z.object({
  name:     z.string().trim().min(2, 'Ingresa tu nombre').max(120),
  email:    z.string().email('Correo electrónico inválido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200),
  orgName:  z.string().trim().min(2).max(120).optional(),
});

/**
 * Email/password sign-up. Creates a NextAuth `users` row (bcrypt hash), provisions
 * the workspace (allowlisted emails join the primary org as admin; everyone else
 * gets a fresh org), signs the user in, then hands off to /auth/callback to route
 * by role. Mirrors the credentials provider so the same password works at login.
 */
export async function registerWithEmail(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const headersList = await headers();
  const forwardedFor = headersList.get('x-forwarded-for') ?? 'anonymous';
  const ip = forwardedFor.split(',')[0].trim();

  const rl = checkRateLimit(`register:${ip}`, 5, 10_000);
  if (!rl.success) {
    return Errors.RATE_LIMITED();
  }

  const parsed = RegisterSchema.safeParse({
    name:     formData.get('name'),
    email:    formData.get('email'),
    password: formData.get('password'),
    orgName:  formData.get('orgName') || undefined,
  });
  if (!parsed.success) {
    return { error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? 'Datos inválidos' } };
  }

  const email = parsed.data.email.trim().toLowerCase();

  try {
    const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (existing) {
      return { error: { code: 'EMAIL_TAKEN', message: 'Ya existe una cuenta con este correo. Inicia sesión.' } };
    }

    const passwordHash = await bcryptjs.hash(parsed.data.password, BCRYPT_COST);
    const [created] = await db
      .insert(users)
      .values({ email, name: parsed.data.name, passwordHash, emailVerified: new Date() })
      .returning({ id: users.id });

    if (!created?.id) throw new Error('user_insert_no_rows');

    await provisionUser(created.id, email, parsed.data.name, parsed.data.orgName);
    await createUserSession(created.id);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'unknown';
    log.error('[auth] registerWithEmail failed', { code: errMsg });
    return { error: { code: 'REGISTRATION_FAILED', message: 'No pudimos crear tu cuenta. Intenta nuevamente.' } };
  }

  log.authSuccess('', email);
  // /auth/callback dispatches by role (new accounts are admins → /dashboard).
  redirect('/auth/callback');
}

export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const headersList = await headers();
  const forwardedFor = headersList.get('x-forwarded-for') ?? 'anonymous';
  const ip = forwardedFor.split(',')[0].trim();

  const rl = checkAuthRateLimitByIp(ip);
  if (!rl.success) {
    return Errors.RATE_LIMITED();
  }

  const parsed = ResetPasswordSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return Errors.VALIDATION_ERROR(parsed.error.flatten());
  }

  // Password reset not yet available — credentials provider users must use Google sign-in
  return {
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'Password reset not yet available. Please use Google sign-in.',
    },
  };
}

// Helper: rate limit by IP
function checkAuthRateLimitByIp(ip: string): { success: boolean } {
  return checkRateLimit(`auth:${ip}`, 5, 10_000);
}
