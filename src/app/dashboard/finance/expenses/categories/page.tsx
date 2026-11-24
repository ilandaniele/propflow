import { requireStaff } from '@/lib/auth/guards';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { listExpenseCategories } from '@/lib/expenses/queries';
import { buildCategoryTree } from '@/lib/expenses/categories';
import { CreateExpenseCategoryForm } from './CreateExpenseCategoryForm';

function ColorDot({ color }: { color: string | null }) {
  return (
    <div
      className="w-3 h-3 rounded-full flex-shrink-0"
      style={{ backgroundColor: color ?? '#94a3b8' }}
      aria-hidden="true"
    />
  );
}

export default async function ExpenseCategoriesPage() {
  const ctx = await requireStaff('finance', 'read');
  const t = await getTranslations('expenseCategories');
  const tree = buildCategoryTree(await listExpenseCategories(ctx.orgId));

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-4">{t('addCategory')}</h2>
        <CreateExpenseCategoryForm parents={tree.map(({ id, name }) => ({ id, name }))} />
      </Card>

      {tree.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          description={t('emptyDesc')}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {tree.map((cat) => (
            <div key={cat.id} className="p-3 border border-slate-200 rounded-lg bg-white space-y-2">
              <div className="flex items-center gap-3">
                <ColorDot color={cat.color} />
                <span className="text-sm font-medium text-slate-900">{cat.name}</span>
              </div>
              {cat.children.length > 0 && (
                <ul className="pl-6 space-y-1">
                  {cat.children.map((child) => (
                    <li key={child.id} className="flex items-center gap-2 text-sm text-slate-700">
                      <ColorDot color={child.color} />
                      {child.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
