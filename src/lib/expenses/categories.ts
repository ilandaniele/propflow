import type { ExpenseKind } from '@/lib/schemas/finance';

export interface CategoryRow {
  id: string;
  name: string;
  color: string | null;
  parentId: string | null;
}

export interface CategoryNode extends CategoryRow {
  children: CategoryRow[];
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

export function buildCategoryTree(rows: CategoryRow[]): CategoryNode[] {
  const topLevelIds = new Set(rows.filter((row) => !row.parentId).map((row) => row.id));
  return rows
    .filter((row) => topLevelIds.has(row.id))
    .sort(byName)
    .map((parent) => ({ ...parent, children: rows.filter((row) => row.parentId === parent.id).sort(byName) }));
}

export function categoryOptions(rows: CategoryRow[]): Array<{ id: string; label: string }> {
  return buildCategoryTree(rows).flatMap((parent) => [
    { id: parent.id, label: parent.name },
    ...parent.children.map((child) => ({ id: child.id, label: `${parent.name} › ${child.name}` })),
  ]);
}

export function totalsByKind(rows: Array<{ amount: string; kind: string }>): Record<ExpenseKind, number> {
  const totals: Record<ExpenseKind, number> = { ordinary: 0, extraordinary: 0 };
  for (const row of rows) {
    const kind: ExpenseKind = row.kind === 'extraordinary' ? 'extraordinary' : 'ordinary';
    totals[kind] += Number(row.amount);
  }
  return totals;
}
