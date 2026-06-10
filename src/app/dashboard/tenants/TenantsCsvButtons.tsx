'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { TenantCsvImportModal } from '@/app/dashboard/admin/tenants/TenantCsvImportModal';

/** Tenant CSV actions for the main Tenants page: import modal, template, history. */
export function TenantsCsvButtons() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const t = useTranslations('csvImport');

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t('importTenants')}
      </Button>
      <a
        href="/api/admin/tenants/import/template"
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
      <TenantCsvImportModal
        open={open}
        onClose={() => setOpen(false)}
        onSuccess={() => {
          setOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}
