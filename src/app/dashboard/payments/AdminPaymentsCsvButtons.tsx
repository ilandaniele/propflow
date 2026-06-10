'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { CsvImportModal } from '@/app/portal/payments/CsvImportModal';

/**
 * Admin payment CSV actions: import (modal), template download, import history.
 * Uses the admin endpoints (any tenant, any status) — the tenant portal uses
 * its own restricted endpoints.
 */
export function AdminPaymentsCsvButtons() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const t = useTranslations('csvImport');

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t('importCsv')}
      </Button>
      <a
        href="/api/admin/payments/import/template"
        className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        download
      >
        {t('downloadTemplate')}
      </a>
      <Link
        href="/dashboard/admin/imports"
        className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        {t('viewHistory')}
      </Link>
      <CsvImportModal
        open={open}
        onClose={() => setOpen(false)}
        onSuccess={() => {
          setOpen(false);
          router.refresh();
        }}
        checkUrl="/api/admin/payments/import/check"
        importUrl="/api/admin/payments/import"
        importType="payment"
      />
    </div>
  );
}
