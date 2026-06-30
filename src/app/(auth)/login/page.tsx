'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { signIn, type AuthState } from '@/app/actions/auth';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { GoogleSignInButton } from '@/components/ui/GoogleSignInButton';

// Post-OAuth dispatch route (see src/app/auth/callback/page.tsx). Relative so it
// always matches the current origin — no dependency on NEXT_PUBLIC_SITE_URL being
// set correctly in the deploy environment.
const GOOGLE_CALLBACK_URL = '/auth/callback';

// Normalise both our own error params and NextAuth's built-in error codes
// (emitted when the signIn callback aborts) to authErrors message keys, so the
// banner always shows a specific message instead of a blank/generic one.
const ERROR_KEY_MAP: Record<string, string> = {
  // Our app-emitted codes (from /auth/callback)
  oauth_failed: 'oauth_failed',
  account_not_created: 'account_not_created',
  // NextAuth built-in codes
  AccessDenied: 'account_not_created',      // signIn callback returned false (provisioning failed / denied)
  OAuthAccountNotLinked: 'email_conflict',  // email already exists with a different provider
  Configuration: 'oauth_failed',
  Verification: 'oauth_failed',
  OAuthSignin: 'oauth_failed',
  OAuthCallbackError: 'oauth_failed',
  Callback: 'invalid_callback',
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} className="w-full">
      {pending ? 'Ingresando...' : 'Ingresar'}
    </Button>
  );
}

export default function LoginPage() {
  const t = useTranslations('authErrors');
  const [state, action] = useActionState<AuthState, FormData>(signIn, {});
  const searchParams = useSearchParams();
  const oauthError = searchParams.get('error');
  const oauthErrorKey = oauthError ? (ERROR_KEY_MAP[oauthError] ?? 'default') : null;
  const oauthErrorMessage = oauthErrorKey
    ? t(oauthErrorKey as Parameters<typeof t>[0])
    : null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center justify-center gap-2">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-md">
              <span className="text-white font-bold text-lg">P</span>
            </div>
          </Link>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Bienvenido</h1>
          <p className="mt-1 text-sm text-slate-500">Ingresa a tu cuenta de PropFlow</p>
        </div>

        {/* OAuth error banner */}
        {oauthErrorMessage && (
          <div
            role="alert"
            className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800"
          >
            {oauthErrorMessage}
          </div>
        )}

        {/* Form */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-7">
          <form action={action} className="space-y-4">
            <Input
              label="Correo electrónico"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="tu@correo.com"
            />
            <Input
              label="Contraseña"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
            />

            {state.error && (
              <div
                role="alert"
                className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
              >
                {state.error.message}
              </div>
            )}

            <SubmitButton />
          </form>

          <div className="mt-4 text-center">
            <Link
              href="/forgot-password"
              className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
            >
              ¿Olvidaste tu contraseña?
            </Link>
          </div>

          {/* OR divider */}
          <div className="mt-5 flex items-center gap-3" aria-hidden="true">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-400 font-medium uppercase tracking-wide">o</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          {/* Google OAuth button */}
          <div className="mt-4">
            <GoogleSignInButton redirectTo={GOOGLE_CALLBACK_URL} />
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          ¿No tienes cuenta?{' '}
          <Link
            href="/register"
            className="font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            Crear cuenta
          </Link>
        </p>
      </div>
    </div>
  );
}
