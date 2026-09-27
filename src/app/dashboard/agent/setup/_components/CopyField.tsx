'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

export interface CopyFieldProps {
  label: string;
  value: string;
}

/** A read-only value with a "copy to clipboard" button — used for the webhook callback URL. */
export function CopyField({ label, value }: CopyFieldProps) {
  const t = useTranslations('agentSetup');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — the value is still visible to copy by hand.
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <code className="flex-1 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg overflow-x-auto whitespace-nowrap">
          {value}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          {copied ? t('copied') : t('copy')}
        </button>
      </div>
    </div>
  );
}
