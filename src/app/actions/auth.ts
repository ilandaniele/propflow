'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import bcryptjs from 'bcryptjs';
import { signIn as nextAuthSignIn, signOut as nextAuthSignOut } from '@/auth';
import { err, Errors } from '@/lib/errors';
import { log } from '@/lib/log';
import { checkRateLimit } from '@/lib/ratelimit';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { provisionUser } from '@/lib/auth/provision';

const BCRYPT_COST = 12;

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

  try {
    await nextAuthSignIn('credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'unknown';
    log.authFailure(parsed.data.email, errMsg);
    return err('AUTH_FAILED', 'Invalid email or password');
  }

  log.authSuccess('', parsed.data.email);
  redirect('/dashboard');
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
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'unknown';
    log.error('[auth] registerWithEmail failed', { code: errMsg });
    return { error: { code: 'REGISTRATION_FAILED', message: 'No pudimos crear tu cuenta. Intenta nuevamente.' } };
  }

  try {
    await nextAuthSignIn('credentials', {
      email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch (e) {
    // Account created but auto-login failed — send them to login to sign in manually.
    const errMsg = e instanceof Error ? e.message : 'unknown';
    log.warn('[auth] registerWithEmail auto-login failed', { code: errMsg });
    redirect('/login');
  }

  log.authSuccess('', email);
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
