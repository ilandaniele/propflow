'use client';

/**
 * ClickableRow
 *
 * Wraps a <tr> to make the entire row clickable while preserving the normal
 * behaviour of any <a> or <button> elements nested inside the row.
 *
 * Why not a plain <Link> overlay?
 * - Wrapping <tr> with <a> or adding an absolutely-positioned <a> overlay
 *   produces invalid HTML and causes accessibility issues.
 * - `useRouter().push()` on the row's onClick gives us client-side navigation
 *   without invalid nesting.
 *
 * Props
 * -----
 * href      – destination route, passed to router.push()
 * children  – the <td> elements that make up the row
 * className – optional extra Tailwind classes
 *
 * Keyboard support
 * ----------------
 * role="row" + tabIndex={0} already exists on <tr> semantically.
 * We add an explicit tabIndex and handle Enter / Space so keyboard users
 * can navigate without relying solely on a "View" button inside the row.
 *
 * Inner link / button suppression
 * --------------------------------
 * When the click originates from or bubbles through an <a> or <button>,
 * we bail out early so the inner control handles navigation itself.
 * This prevents double-navigation when the "View" button is clicked.
 */

import { useRouter } from 'next/navigation';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';

interface ClickableRowProps {
  href: string;
  children: ReactNode;
  className?: string;
}

export function ClickableRow({ href, children, className }: ClickableRowProps) {
  const router = useRouter();

  function navigate(e: MouseEvent<HTMLTableRowElement> | KeyboardEvent<HTMLTableRowElement>) {
    // Bail if the event originated inside an interactive element.
    // We check both the direct target and its ancestors up to the row.
    const target = e.target as Element;
    if (target.closest('a, button')) return;
    router.push(href);
  }

  function handleClick(e: MouseEvent<HTMLTableRowElement>) {
    navigate(e);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTableRowElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); // prevent Space from scrolling the page
      navigate(e);
    }
  }

  return (
    <tr
      tabIndex={0}
      role="row"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={[
        'cursor-pointer hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-inset',
        className ?? '',
      ]
        .join(' ')
        .trim()}
    >
      {children}
    </tr>
  );
}
