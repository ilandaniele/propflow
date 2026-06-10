'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { signIn, type AuthState } from '@/app/actions/auth';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { GoogleSignInButton } from '@/components/ui/GoogleSignInButton';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
const GOOGLE_CALLBACK_URL = `${SITE_URL}/auth/callback`;

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_cancelled: 'Autenticación con Google cancelada.',
  invalid_callback: 'Error en el callback de autenticación. Intenta nuevamente.',
  missing_email: 'Google no proporcionó un email. Verifica la configuración de tu cuenta.',
  email_conflict: 'Ya existe una cuenta con este email. Inicia sesión con email y contraseña.',
  airtable_unavailable: 'Tu cuenta fue creada, pero no pudimos sincronizar con Airtable. El administrador puede completar la sincronización.',
  local_created_airtable_failed: 'Tu cuenta fue creada localmente. La sincronización con Airtable falló y será reintentada.',
  // legacy param — keep backward compat
  oauth_failed: 'Error en la autenticación con Google. Intenta nuevamente.',
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
  const [state, action] = useActionState<AuthState, FormData>(signIn, {});
  const searchParams = useSearchParams();
  const oauthError = searchParams.get('error');
  const oauthErrorMessage = oauthError ? (OAUTH_ERROR_MESSAGES[oauthError] ?? 'Error de autenticación. Intenta nuevamente.') : null;

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
          <a
            href="mailto:hello@propflow.app?subject=Request Access to PropFlow"
            className="font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            Solicita acceso
          </a>
        </p>
      </div>
    </div>
  );
}
