'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const REFRESH_INTERVAL_MS = 5000;

/**
 * Refreshes the current route every 5s while the tab is visible, so the
 * inbox picks up new inbound messages / turn results without a manual
 * reload. Clears its interval on unmount. Renders nothing.
 */
export function AutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') {
        router.refresh();
      }
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [router]);

  return null;
}
