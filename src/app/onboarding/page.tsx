/**
 * /onboarding — New user setup
 *
 * Server Component. Supports two flows selected by the `type` query param:
 *
 * ?type=admin  (default) — org admin creates their first organization.
 *   Renders OnboardingForm → createOrg Server Action.
 *
 * ?type=tenant — new tenant self-registers personal details after Google OAuth.
 *   Renders TenantOnboardingForm → POST /api/tenant/register.
 *
 * Guards:
 * - Not authenticated → redirect /login
 * - Already has a profile → redirect to role home (single-use page)
 */

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getExistingProfile } from '@/lib/auth/provision';
import { OnboardingForm } from './OnboardingForm';
import { TenantOnboardingForm } from './TenantOnboardingForm';

export const metadata = {
  title: 'Configurar cuenta | PropFlow',
};

interface OnboardingPageProps {
  searchParams: Promise<{ type?: string }>;
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const params = await searchParams;
  const onboardingType = params.type === 'tenant' ? 'tenant' : 'admin';

  // Guard 1: must be authenticated
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/login');
  }

  const user = { id: session.user.id, email: session.user.email ?? '' };

  // Guard 2: already has a profile → route to role home (single-use)
  const existingProfile = await getExistingProfile(user.id);
  if (existingProfile) {
    redirect(existingProfile.role === 'admin' ? '/dashboard' : '/portal');
  }

  if (onboardingType === 'tenant') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4 py-8">
        <div className="w-full max-w-lg">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center gap-2">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-md">
                <span className="text-white font-bold text-lg">P</span>
              </div>
            </div>
            <h1 className="mt-4 text-2xl font-bold text-slate-900">Completa tu registro</h1>
            <p className="mt-1 text-sm text-slate-500">
              Ingresa tus datos para finalizar la configuración de tu cuenta de inquilino.
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-7">
            <TenantOnboardingForm />
          </div>

          <p className="mt-6 text-center text-xs text-slate-400">
            Registrado como <span className="font-medium text-slate-600">{user.email}</span>
          </p>
        </div>
      </div>
    );
  }

  // Admin flow (default)
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center gap-2">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-md">
              <span className="text-white font-bold text-lg">P</span>
            </div>
          </div>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Configura tu espacio de trabajo</h1>
          <p className="mt-1 text-sm text-slate-500">
            Bienvenido. Crea tu organización para comenzar a gestionar propiedades.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-7">
          <OnboardingForm />
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Registrado como <span className="font-medium text-slate-600">{user.email}</span>
        </p>
      </div>
    </div>
  );
}
