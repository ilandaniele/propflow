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

export function AdminTopbar({ userName, pageTitle, currentLocale = 'es', onMenuClick, hamburgerRef }: AdminTopbarProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0">
      <div className="flex items-center gap-3">
        {/* Hamburger — mobile only, toggles the sidebar drawer */}
        <button
          ref={hamburgerRef}
          type="button"
          onClick={onMenuClick}
          className="md:hidden p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          aria-label="Open navigation"
          aria-controls="main-nav"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
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
