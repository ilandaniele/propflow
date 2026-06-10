'use client';

/**
 * /invite/accept?token=<raw token>
 *
 * Reads the token from the URL, previews the invitation context (masked email),
 * and lets the user sign in with Google or email/password to accept.
 *
 * After a successful sign-in the user is redirected back here (via auth_redirect_to cookie)
 * and the page calls POST /api/invite/accept to complete the link.
 */

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const visible = local.length > 2 ? local.slice(0, 2) : local.slice(0, 1);
  return `${visible}***@${domain}`;
}

type InviteState =
  | { phase: 'loading' }
  | { phase: 'ready'; maskedEmail: string; orgName: string }
  | { phase: 'signing_in'; maskedEmail: string; orgName: string }
  | { phase: 'accepting'; maskedEmail: string; orgName: string }
  | { phase: 'done' }
  | { phase: 'error'; message: string };

export default function InviteAcceptPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token') ?? '';

  const [state, setState] = useState<InviteState>({ phase: 'loading' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signInErr, setSignInErr] = useState<string | null>(null);

  // On mount: peek at the invitation (public metadata — no auth required)
  useEffect(() => {
    if (!token) {
      setState({ phase: 'error', message: 'El enlace de invitación no es válido.' });
      return;
    }
    void fetch(`/api/invite/peek?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then((json: { maskedEmail?: string; orgName?: string; error?: { message?: string } }) => {
        if (json.error || !json.maskedEmail) {
          setState({ phase: 'error', message: json.error?.message ?? 'Invitación no encontrada o vencida.' });
        } else {
          setState({ phase: 'ready', maskedEmail: json.maskedEmail, orgName: json.orgName ?? 'PropFlow' });
        }
      })
      .catch(() => setState({ phase: 'error', message: 'No se pudo cargar la invitación.' }));
  }, [token]);

  // Check if user is already signed in — if so, try to accept immediately
  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getUser().then((r: Awaited<ReturnType<typeof supabase.auth.getUser>>) => {
      const user = r.data.user;
      if (user && token && state.phase === 'ready') {
        void acceptInvite();
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  async function acceptInvite() {
    setState(prev =>
      (prev.phase === 'ready' || prev.phase === 'signing_in')
        ? { phase: 'accepting', maskedEmail: prev.maskedEmail, orgName: prev.orgName }
        : { phase: 'accepting', maskedEmail: '', orgName: '' }
    );
    const res = await fetch('/api/invite/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const json = await res.json() as { accepted?: boolean; redirectTo?: string; error?: { code?: string; message?: string } };
    if (json.accepted) {
      setState({ phase: 'done' });
      router.replace(json.redirectTo ?? '/portal');
    } else {
      setState({ phase: 'error', message: json.error?.message ?? 'No se pudo aceptar la invitación.' });
    }
  }

  async function signInWithGoogle() {
    setState(prev =>
      (prev.phase === 'ready' || prev.phase === 'signing_in')
        ? { phase: 'signing_in', maskedEmail: prev.maskedEmail, orgName: prev.orgName }
        : { phase: 'signing_in', maskedEmail: '', orgName: '' }
    );
    setSignInErr(null);
    const supabase = createClient();
    const siteUrl = process.env['NEXT_PUBLIC_SITE_URL'] ?? window.location.origin;
    // After OAuth, redirect back to this page to complete acceptance
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${siteUrl}/auth/callback`,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) {
      setSignInErr('No se pudo iniciar sesión con Google. Intenta de nuevo.');
      setState(prev =>
        (prev.phase === 'signing_in')
          ? { phase: 'ready', maskedEmail: prev.maskedEmail, orgName: prev.orgName }
          : { phase: 'error', message: 'No se pudo iniciar sesión.' }
      );
    }
  }

  async function signInWithEmail(e: React.FormEvent) {
    e.preventDefault();
    setSignInErr(null);
    setState(prev =>
      (prev.phase === 'ready' || prev.phase === 'signing_in')
        ? { phase: 'signing_in', maskedEmail: prev.maskedEmail, orgName: prev.orgName }
        : { phase: 'signing_in', maskedEmail: '', orgName: '' }
    );
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setSignInErr(error.message ?? 'Credenciales incorrectas.');
      setState(prev =>
        prev.phase === 'signing_in'
          ? { phase: 'ready', maskedEmail: prev.maskedEmail, orgName: prev.orgName }
          : { phase: 'error', message: 'No se pudo iniciar sesión.' }
      );
      return;
    }
    await acceptInvite();
  }

  if (state.phase === 'loading' || state.phase === 'done') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-slate-500">Cargando...</p>
        </div>
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-md w-full text-center space-y-4">
          <h1 className="text-xl font-semibold text-slate-900">Enlace no válido</h1>
          <p className="text-sm text-slate-600">{state.message}</p>
          <Button variant="primary" onClick={() => router.push('/login')}>
            Ir a inicio de sesión
          </Button>
        </div>
      </div>
    );
  }

  if (state.phase === 'accepting') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-slate-500">Activando tu acceso...</p>
        </div>
      </div>
    );
  }

  // phase === 'ready' or 'signing_in'
  const { maskedEmail, orgName } = state;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-md w-full space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-xl font-semibold text-slate-900">Invitación al portal</h1>
          <p className="text-sm text-slate-500">
            Has sido invitado a unirte al portal de inquilinos de <strong>{orgName}</strong>.
          </p>
          {maskedEmail && (
            <p className="text-xs text-slate-400 mt-1">
              Esta invitación fue enviada a <span className="font-mono">{maskedEmail}</span>. Debes iniciar sesión con esa cuenta.
            </p>
          )}
        </div>

        {signInErr && (
          <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
            {signInErr}
          </div>
        )}

        <div className="space-y-4">
          <Button
            variant="primary"
            className="w-full"
            onClick={signInWithGoogle}
            loading={state.phase === 'signing_in'}
            disabled={state.phase === 'signing_in'}
          >
            Continuar con Google
          </Button>

          <div className="flex items-center gap-3">
            <hr className="flex-1 border-slate-200" />
            <span className="text-xs text-slate-400">o con correo y contraseña</span>
            <hr className="flex-1 border-slate-200" />
          </div>

          <form onSubmit={signInWithEmail} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="email">
                Correo electrónico
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={state.phase === 'signing_in'}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="password">
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={state.phase === 'signing_in'}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
              />
            </div>
            <Button
              type="submit"
              variant="secondary"
              className="w-full"
              loading={state.phase === 'signing_in'}
              disabled={state.phase === 'signing_in'}
            >
              Iniciar sesión
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
