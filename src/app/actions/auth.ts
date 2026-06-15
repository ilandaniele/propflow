'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { signIn as nextAuthSignIn, signOut as nextAuthSignOut } from '@/auth';
import { err, Errors } from '@/lib/errors';
import { log } from '@/lib/log';
import { checkRateLimit } from '@/lib/ratelimit';
import { headers } from 'next/headers';

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
