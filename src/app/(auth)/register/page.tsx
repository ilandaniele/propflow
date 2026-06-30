'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { registerWithEmail } from '@/app/actions/auth';
import type { AuthState } from '@/app/actions/auth';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { GoogleSignInButton } from '@/components/ui/GoogleSignInButton';

// Post-OAuth dispatch route (see src/app/auth/callback/page.tsx).
const GOOGLE_CALLBACK_URL = '/auth/callback';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} className="w-full">
      {pending ? 'Creando cuenta...' : 'Crear cuenta'}
    </Button>
  );
}

export default function RegisterPage() {
  const [state, action] = useActionState<AuthState, FormData>(registerWithEmail, {});

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center justify-center gap-2">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-md">
              <span className="text-white font-bold text-lg">P</span>
            </div>
          </Link>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Crear cuenta</h1>
          <p className="mt-1 text-sm text-slate-500">Empieza a gestionar tus propiedades con PropFlow</p>
        </div>

        {/* Form */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-7">
          <form action={action} className="space-y-4">
            <Input
              label="Nombre completo"
              name="name"
              type="text"
              autoComplete="name"
              required
              placeholder="Tu nombre"
            />
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
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="Mínimo 8 caracteres"
            />
            <Input
              label="Nombre del espacio de trabajo"
              name="orgName"
              type="text"
              autoComplete="organization"
              placeholder="Ej. Inmobiliaria Daniele (opcional)"
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
          ¿Ya tienes cuenta?{' '}
          <Link href="/login" className="font-medium text-slate-600 hover:text-slate-900 transition-colors">
            Inicia sesión
          </Link>
        </p>
      </div>
    </div>
  );
}
