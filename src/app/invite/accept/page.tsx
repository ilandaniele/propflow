'use client';

/**
 * /invite/accept?token=<raw token>
 *
 * Reads the token from the URL, previews the invitation context (masked email),
 * and lets the user sign in with Google or email/password to accept.
 *
 * After a successful sign-in the user is redirected back here (via the redirect
 * query param) and the page calls POST /api/invite/accept to complete the link.
 */

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSession, signIn as nextAuthSignIn } from 'next-auth/react';
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
  const t = useTranslations('invite');
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token') ?? '';

  const { data: session } = useSession();
  const [state, setState] = useState<InviteState>({ phase: 'loading' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signInErr, setSignInErr] = useState<string | null>(null);

  // On mount: peek at the invitation (public metadata — no auth required)
  useEffect(() => {
    if (!token) {
      setState({ phase: 'error', message: t('invalidLink') });
      return;
    }
    void fetch(`/api/invite/peek?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then((json: { maskedEmail?: string; orgName?: string; error?: { message?: string } }) => {
        if (json.error || !json.maskedEmail) {
          setState({ phase: 'error', message: json.error?.message ?? t('notFound') });
        } else {
          setState({ phase: 'ready', maskedEmail: json.maskedEmail, orgName: json.orgName ?? 'PropFlow' });
        }
      })
      .catch(() => setState({ phase: 'error', message: t('loadError') }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Check if user is already signed in — if so, try to accept immediately
  useEffect(() => {
    if (session?.user && token && state.phase === 'ready') {
      void acceptInvite();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user, state.phase]);

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
      setState({ phase: 'error', message: json.error?.message ?? t('errorAccept') });
    }
  }

  async function signInWithGoogle() {
    setState(prev =>
      (prev.phase === 'ready' || prev.phase === 'signing_in')
        ? { phase: 'signing_in', maskedEmail: prev.maskedEmail, orgName: prev.orgName }
        : { phase: 'signing_in', maskedEmail: '', orgName: '' }
    );
    setSignInErr(null);
    try {
      await nextAuthSignIn('google', {
        callbackUrl: `/invite/accept?token=${encodeURIComponent(token)}`,
      });
      // nextAuthSignIn redirects — execution doesn't continue here on success
    } catch {
      setSignInErr(t('googleError'));
      setState(prev =>
        (prev.phase === 'signing_in')
          ? { phase: 'ready', maskedEmail: prev.maskedEmail, orgName: prev.orgName }
          : { phase: 'error', message: t('errorSignIn') }
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
    const result = await nextAuthSignIn('credentials', {
      email,
      password,
      redirect: false,
    });
    if (result?.error) {
      setSignInErr(result.error ?? t('errorSignIn'));
      setState(prev =>
        prev.phase === 'signing_in'
          ? { phase: 'ready', maskedEmail: prev.maskedEmail, orgName: prev.orgName }
          : { phase: 'error', message: t('errorSignIn') }
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
          <p className="text-sm text-slate-500">{t('loadingTitle')}</p>
        </div>
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-md w-full text-center space-y-4">
          <h1 className="text-xl font-semibold text-slate-900">{t('invalidLinkTitle')}</h1>
          <p className="text-sm text-slate-600">{state.message}</p>
          <Button variant="primary" onClick={() => router.push('/login')}>
            {t('goToLogin')}
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
          <p className="text-sm text-slate-500">{t('activating')}</p>
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
          <h1 className="text-xl font-semibold text-slate-900">{t('portalTitle')}</h1>
          <p className="text-sm text-slate-500">
            {t('portalDesc', { orgName })}
          </p>
          {maskedEmail && (
            <p className="text-xs text-slate-400 mt-1">
              {t('emailHint', { maskedEmail })}
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
            {t('continueGoogle')}
          </Button>

          <div className="flex items-center gap-3">
            <hr className="flex-1 border-slate-200" />
            <span className="text-xs text-slate-400">{t('orWithEmail')}</span>
            <hr className="flex-1 border-slate-200" />
          </div>

          <form onSubmit={signInWithEmail} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="email">
                {t('fieldEmail')}
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
                {t('fieldPassword')}
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
              {t('signIn')}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
