/**
 * /onboarding — New Google user org creation
 *
 * Server Component. Guards:
 * - If not authenticated → redirect /login
 * - If already has a profile → redirect to role home (single-use)
 *
 * Renders a simple form: org name input + "Create workspace" button.
 * The form submits to the createOrg Server Action.
 *
 * This is a Server Component (no 'use client') so it can do the guard
 * checks server-side. The form itself uses a Client Component shell
 * for useActionState + useFormStatus.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getExistingProfile } from '@/lib/auth/provision';
import { OnboardingForm } from './OnboardingForm';

export const metadata = {
  title: 'Set up your workspace | PropFlow',
};

export default async function OnboardingPage() {
  // Guard 1: must be authenticated
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Guard 2: already has a profile → route to role home (single-use)
  const existingProfile = await getExistingProfile(user.id);
  if (existingProfile) {
    redirect(existingProfile.role === 'admin' ? '/dashboard' : '/portal');
  }

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
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Set up your workspace</h1>
          <p className="mt-1 text-sm text-slate-500">
            Welcome! Create your organization to start managing properties.
          </p>
        </div>

        {/* Onboarding form */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-7">
          <OnboardingForm />
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Signed in as <span className="font-medium text-slate-600">{user.email}</span>
        </p>
      </div>
    </div>
  );
}
