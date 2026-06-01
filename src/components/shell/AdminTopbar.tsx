'use client';

import { Avatar } from '@/components/ui/Avatar';
import { LanguageDropdown } from '@/components/i18n/LanguageDropdown';
import { signOut } from '@/app/actions/auth';
import { useTransition, type RefObject } from 'react';
import type { Locale } from '@/i18n/config';

export interface AdminTopbarProps {
  userName?:     string | null;
  pageTitle?:    string;
  currentLocale?: Locale;
  onMenuClick?:  () => void;
  hamburgerRef?: RefObject<HTMLButtonElement | null>;
}

export function AdminTopbar({ userName, pageTitle, currentLocale = 'es', onMenuClick: _onMenuClick, hamburgerRef: _hamburgerRef }: AdminTopbarProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0">
      <div>
        {pageTitle && (
          <h1 className="text-base font-semibold text-slate-900">{pageTitle}</h1>
        )}
      </div>
      <div className="flex items-center gap-3">
        <LanguageDropdown currentLocale={currentLocale} />
        <Avatar name={userName} size="sm" />
        <span className="text-sm text-slate-700 hidden sm:block">{userName}</span>
        <button
          onClick={() => startTransition(() => signOut())}
          disabled={isPending}
          className="text-sm text-slate-500 hover:text-slate-900 transition-colors px-2 py-1 rounded hover:bg-slate-100 disabled:opacity-50"
          data-testid="logout-button"
        >
          {isPending ? 'Signing out...' : 'Sign out'}
        </button>
      </div>
    </header>
  );
}
