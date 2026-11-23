import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { orgApplications } from '@/lib/applications/service';
import { signedDocumentLinks } from '@/lib/applications/documents';
import { scoreBand } from '@/lib/applications/scoring';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ApplicationStatusSelect } from './ApplicationStatusSelect';

export const metadata: Metadata = { title: 'Applications' };

const BAND_VARIANT = { high: 'success', medium: 'warning', low: 'danger' } as const;

export default async function RentalApplicationsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [rows, t] = await Promise.all([orgApplications(ctx.orgId), getTranslations('rentalApplications')]);
  const applications = await Promise.all(rows.map(async (row) => ({
    ...row,
    links: await signedDocumentLinks(ctx.orgId, row.documents),
  })));

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      {applications.length === 0 ? (
        <Card><EmptyState title={t('emptyTitle')} description={t('emptyDesc')} /></Card>
      ) : (
        <ul className="space-y-3">
          {applications.map((app) => {
            const band = scoreBand(app.score);
            return (
              <li key={app.id} className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{app.fullName}</p>
                    <p className="text-sm text-slate-500">{app.email} · {app.phone}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{app.listingTitle ?? t('noListing')} · {app.createdAt.toLocaleDateString('es-PE')}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={BAND_VARIANT[band]}>{t('score', { score: app.score })} · {t(`band.${band}`)}</Badge>
                    <ApplicationStatusSelect applicationId={app.id} status={app.status} />
                  </div>
                </div>
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                  <div><dt className="text-xs text-slate-400">{t('income')}</dt><dd>S/ {app.monthlyIncome}</dd></div>
                  <div><dt className="text-xs text-slate-400">{t('rent')}</dt><dd>{app.monthlyRent ? `S/ ${app.monthlyRent}` : '—'}</dd></div>
                  <div><dt className="text-xs text-slate-400">{t('employment')}</dt><dd>{t(`employmentType.${app.employmentType}`)} · {t('months', { count: app.employmentMonths })}</dd></div>
                  <div><dt className="text-xs text-slate-400">{t('household')}</dt><dd>{app.householdSize} · {app.hasGuarantor ? t('guarantorYes') : t('guarantorNo')}</dd></div>
                </dl>
                {app.message && <p className="text-sm text-slate-600 whitespace-pre-wrap">{app.message}</p>}
                {app.links.length > 0 && (
                  <div className="flex flex-wrap gap-3 text-sm">
                    {app.links.map((link) => (
                      <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">{link.name}</a>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
