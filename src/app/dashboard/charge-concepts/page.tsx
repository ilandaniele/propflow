import { asc, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { chargeConcepts } from '@/lib/db/schema';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ChargeConceptForm } from './ChargeConceptForm';

const MAX_CONCEPTS = 200;

export default async function ChargeConceptsPage() {
  const ctx = await requireAdmin();
  const t = await getTranslations('chargeConcepts');

  const concepts = await db
    .select({ id: chargeConcepts.id, description: chargeConcepts.description, code: chargeConcepts.code, baseAmount: chargeConcepts.baseAmount })
    .from(chargeConcepts)
    .where(eq(chargeConcepts.orgId, ctx.orgId))
    .orderBy(asc(chargeConcepts.description))
    .limit(MAX_CONCEPTS);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{t('subtitle')}</p>
      </div>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-4">{t('add')}</h2>
        <ChargeConceptForm />
      </Card>

      {concepts.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDesc')} />
      ) : (
        <Card padding="md">
          <ul className="divide-y divide-slate-100">
            {concepts.map((concept) => (
              <li key={concept.id} className="py-3">
                <ChargeConceptForm concept={concept} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
