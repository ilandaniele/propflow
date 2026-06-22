import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { expenseCategories } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { CreateExpenseCategoryForm } from './CreateExpenseCategoryForm';

export default async function ExpenseCategoriesPage() {
  const ctx = await requireAdmin();
  const t = await getTranslations('expenseCategories');

  const categories = await db
    .select({ id: expenseCategories.id, name: expenseCategories.name, color: expenseCategories.color })
    .from(expenseCategories)
    .where(eq(expenseCategories.orgId, ctx.orgId))
    .orderBy(asc(expenseCategories.name));

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-4">{t('addCategory')}</h2>
        <CreateExpenseCategoryForm />
      </Card>

      {categories.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          description={t('emptyDesc')}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {categories.map((cat) => (
            <div
              key={cat.id}
              className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg bg-white"
            >
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: cat.color ?? '#94a3b8' }}
                aria-hidden="true"
              />
              <span className="text-sm font-medium text-slate-900">{cat.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
