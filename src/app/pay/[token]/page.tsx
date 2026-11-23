import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { clientIpFromHeaders, publicAssetRateLimit } from '@/lib/ratelimit';
import { isPayToken } from '@/lib/online-payments/token';
import { findPublicIntentByToken, type PublicIntent } from '@/lib/online-payments/queries';
import { formatAmount, isIntentPayable } from '@/lib/online-payments/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Pago en línea', robots: { index: false, follow: false } };

interface Props {
  params: Promise<{ token: string }>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm max-w-md w-full p-6 space-y-5">{children}</div>
    </main>
  );
}

async function PayAction({ intent, token }: { intent: PublicIntent; token: string }) {
  const t = await getTranslations('payLink');
  if (intent.status === 'paid') {
    return <p role="status" className="rounded-lg bg-success-bg text-success px-4 py-3 text-sm font-medium">{t('paid')}</p>;
  }
  if (!isIntentPayable(intent)) {
    return <p role="status" className="rounded-lg bg-slate-100 text-slate-600 px-4 py-3 text-sm">{t('unavailable')}</p>;
  }
  if (intent.provider === 'sandbox') {
    return (
      <form method="post" action={`/api/pay/${token}/simulate`} className="space-y-3">
        <p className="text-xs text-slate-500">{t('sandboxNotice')}</p>
        <button type="submit" className="w-full rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold py-2.5">
          {t('simulate')}
        </button>
      </form>
    );
  }
  if (!intent.checkoutUrl) {
    return <p role="status" className="rounded-lg bg-slate-100 text-slate-600 px-4 py-3 text-sm">{t('unavailable')}</p>;
  }
  return (
    <div className="space-y-3">
      <a href={intent.checkoutUrl} rel="noopener noreferrer" className="block w-full text-center rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold py-2.5">
        {t('payWithMercadoPago')}
      </a>
      <p className="text-xs text-slate-500 text-center">{t('methods')}</p>
    </div>
  );
}

export default async function PayPage({ params }: Props) {
  const t = await getTranslations('payLink');

  if (!publicAssetRateLimit(clientIpFromHeaders(await headers())).success) {
    return <Shell><p role="alert" className="text-sm text-slate-600">{t('rateLimited')}</p></Shell>;
  }

  const { token } = await params;
  if (!isPayToken(token)) notFound();
  const intent = await findPublicIntentByToken(token);
  if (!intent) notFound();

  return (
    <Shell>
      <div>
        <h1 className="text-lg font-semibold text-slate-900">{t('title')}</h1>
        {intent.tenantFirstName && <p className="text-sm text-slate-500 mt-1">{t('greeting', { name: intent.tenantFirstName })}</p>}
      </div>
      <dl className="space-y-3 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">{t('concept')}</dt>
          <dd className="text-slate-900 text-right">{intent.concept ?? t('defaultConcept')}</dd>
        </div>
        {intent.dueDate && (
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">{t('dueDate')}</dt>
            <dd className="text-slate-900">{intent.dueDate}</dd>
          </div>
        )}
        <div className="flex justify-between gap-4 border-t border-slate-100 pt-3">
          <dt className="text-slate-700 font-medium">{t('amount')}</dt>
          <dd className="text-xl font-bold text-slate-900">{formatAmount(intent.amount, intent.currency)}</dd>
        </div>
      </dl>
      <PayAction intent={intent} token={token} />
    </Shell>
  );
}
