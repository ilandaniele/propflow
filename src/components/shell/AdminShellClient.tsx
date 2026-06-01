'use client';

/**
 * AdminShellClient — client wrapper for admin layout.
 * Holds the mobile sidebar open/close state, handles Escape key, and
 * renders the backdrop overlay when the sidebar is open on mobile.
 *
 * IC6: Three files only (AdminShellClient, AdminSidebar, AdminTopbar).
 * The server layout (src/app/dashboard/layout.tsx) still does auth +
 * profile + org fetch — this component only manages UI state.
 */

import { useState, useEffect, useRef, type ReactNode } from 'react';
import { AdminSidebar } from './AdminSidebar';
import { AdminTopbar } from './AdminTopbar';
import type { Locale } from '@/i18n/config';

interface AdminShellClientProps {
  orgName:      string;
  userName:     string;
  currentLocale?: Locale;
  children:     ReactNode;
}

export function AdminShellClient({
  orgName,
  userName,
  currentLocale = 'es',
  children,
}: AdminShellClientProps) {
  const [open, setOpen]     = useState(false);
  const hamburgerRef        = useRef<HTMLButtonElement>(null);

  // Close sidebar and return focus to hamburger button
  const closeAndFocus = () => {
    setOpen(false);
    // Return focus to the hamburger button (a11y)
    requestAnimationFrame(() => hamburgerRef.current?.focus());
  };

  // Escape key closes the sidebar (a11y / IC6)
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeAndFocus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Backdrop — mobile only, visible only when sidebar is open */}
      {open && (
        <div
          className="md:hidden fixed inset-0 bg-slate-900/50 z-30"
          onClick={closeAndFocus}
          role="presentation"
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <AdminSidebar
        orgName={orgName}
        open={open}
        onClose={closeAndFocus}
      />

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <AdminTopbar
          userName={userName}
          currentLocale={currentLocale}
          onMenuClick={() => setOpen(true)}
          hamburgerRef={hamburgerRef}
        />
        <main className="flex-1 overflow-y-auto p-6" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
