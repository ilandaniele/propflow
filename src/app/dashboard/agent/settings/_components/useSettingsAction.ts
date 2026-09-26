'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionResult } from '@/lib/errors';

/**
 * Shared "call a server action, surface its error, refresh on success" glue
 * for every settings tab — mirrors LeadSettingsCard's handleResult pattern
 * (src/app/dashboard/leads/LeadSettingsCard.tsx) instead of re-inventing it.
 */
export function useSettingsAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const run = useCallback(
    async (action: () => Promise<ActionResult<unknown>>) => {
      setSaving(true);
      setError(null);
      try {
        const result = await action();
        if (result.error) {
          setError(result.error.message);
        } else {
          setSavedAt(Date.now());
          router.refresh();
        }
      } finally {
        setSaving(false);
      }
    },
    [router]
  );

  return { run, error, saving, savedAt };
}
