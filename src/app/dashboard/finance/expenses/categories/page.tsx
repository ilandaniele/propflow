import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { CreateExpenseCategoryForm } from './CreateExpenseCategoryForm';
import type { ExpenseCategory } from '@/types';

export default async function ExpenseCategoriesPage() {
  const ctx = await requireAdmin();
  const supabase = await createClient();

  const { data: categories } = await supabase
    .from('expense_categories')
    .select('*')
    .eq('org_id', ctx.orgId)
    .order('name', { ascending: true });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Expense Categories</h1>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-4">Add Category</h2>
        <CreateExpenseCategoryForm />
      </Card>

      {(categories ?? []).length === 0 ? (
        <EmptyState
          title="No categories yet"
          description="Create expense categories to organize your P&L."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(categories as ExpenseCategory[]).map((cat) => (
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
