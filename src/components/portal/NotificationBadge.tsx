'use client';

/**
 * NotificationBadge
 *
 * Client component that fetches the unread notification count on mount and
 * renders the bell icon + badge.  Fetching happens client-side so the portal
 * layout can stream immediately without waiting for the notification_inbox
 * query (spec AC4 — notification count must NOT block the layout).
 *
 * Initial render: 0 (no badge shown) — matches the "0 → N" trade-off accepted
 * in spec risk register (non-critical cosmetic flicker).
 *
 * Accessibility: aria-label on the Link is updated once the count is loaded.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NotificationBadgeProps {
  /** Desktop variant shows icon only; mobile variant includes a label. */
  variant?: 'desktop' | 'mobile';
}

export function NotificationBadge({ variant = 'desktop' }: NotificationBadgeProps) {
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;

    async function fetchCount() {
      try {
        const res = await fetch('/api/portal/notifications/unread-count', {
          // no-store: count must be fresh on each mount (navigation), not cached
          cache: 'no-store',
        });
        if (!res.ok || cancelled) return;
        const json = await res.json() as { count?: number };
        if (!cancelled) {
          setCount(typeof json.count === 'number' ? json.count : 0);
        }
      } catch {
        // Network error — keep count at 0 (non-critical cosmetic)
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchCount();
    return () => { cancelled = true; };
  }, []);

  const ariaLabel = loading
    ? 'Notifications'
    : `Notifications${count > 0 ? ` (${count} unread)` : ''}`;

  const displayCount = count > 9 ? '9+' : count;

  if (variant === 'mobile') {
    return (
      <Link
        href="/portal/notifications"
        className={[
          'flex flex-col items-center gap-0.5 py-2 text-xs font-medium relative',
          pathname.startsWith('/portal/notifications') ? 'text-brand-600' : 'text-slate-500',
        ].join(' ')}
        aria-label={ariaLabel}
      >
        <span className="relative">
          <BellIcon size={20} />
          {count > 0 && (
            <span
              className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none text-[10px]"
              aria-hidden="true"
            >
              {displayCount}
            </span>
          )}
        </span>
        Alerts
      </Link>
    );
  }

  return (
    <Link
      href="/portal/notifications"
      className="relative p-1.5 rounded-md hover:bg-slate-100 transition-colors"
      aria-label={ariaLabel}
    >
      <BellIcon size={18} />
      {count > 0 && (
        <span
          className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none"
          aria-hidden="true"
        >
          {displayCount}
        </span>
      )}
    </Link>
  );
}

function BellIcon({ size }: { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
