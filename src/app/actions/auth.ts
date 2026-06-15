'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { signIn as nextAuthSignIn, signOut as nextAuthSignOut } from '@/auth';
import { err, Errors } from '@/lib/errors';
import { log } from '@/lib/log';
import { checkRateLimit } from '@/lib/ratelimit';
import { headers } from 'next/headers';
import { AuthError } from 'next-auth';

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
    // NextAuth Credentials sign-in — redirect:false prevents automatic redirect
    // so we can determine the target based on role after sign-in completes.
    // NOTE: We call redirect() after to do role-based routing.
    await nextAuthSignIn('credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      log.authFailure(parsed.data.email, e.type ?? 'AuthError');
      return err('AUTH_FAILED', 'Invalid email or password');
    }
    // Re-throw redirect() calls — Next.js uses throw to initiate redirects
    throw e;
  }

  log.authSuccess('', parsed.data.email);

  // Role-based redirect: read auth() to get role from session
  // (auth() is available here because the session was just set by signIn above)
  const { auth } = await import('@/auth');
  const session = await auth();
  const role = session?.user?.role ?? 'tenant';

  redirect(role === 'admin' ? '/dashboard' : '/portal');
}

export async function signOut(): Promise<void> {
  // NextAuth signOut — clears session cookie and redirects
  await nextAuthSignOut({ redirectTo: '/login' });
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

  // Password reset is out of scope for this migration PR.
  // Existing users should use Google OAuth. A follow-up PR will implement
  // NextAuth email verification + password reset flow.
  log.info('[auth] requestPasswordReset stub called', { event: 'password_reset_stub' });

  // Always return success to prevent email enumeration
  return { success: true };
}

// Helper: rate limit by IP
function checkAuthRateLimitByIp(ip: string): { success: boolean } {
  return checkRateLimit(`auth:${ip}`, 5, 10_000);
}
