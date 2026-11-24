export interface BudgetCategory {
  categoryId: string | null;
  name: string | null;
  annualBudget: number;
}

export interface CategorySpend {
  categoryId: string | null;
  month: number;
  amount: number;
}

export interface BudgetRow extends BudgetCategory {
  budgetToDate: number;
  actualToDate: number;
  actualYear: number;
  variance: number;
  executedPct: number | null;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function monthsElapsed(year: number, now: Date): number {
  const currentYear = now.getUTCFullYear();
  if (year < currentYear) return 12;
  if (year > currentYear) return 0;
  return now.getUTCMonth() + 1;
}

export function budgetRows(categories: BudgetCategory[], spend: CategorySpend[], elapsed: number): BudgetRow[] {
  const uncategorized = spend.some((s) => s.categoryId === null)
    ? [{ categoryId: null, name: null, annualBudget: 0 }]
    : [];

  return [...categories, ...uncategorized].map((category) => {
    const own = spend.filter((s) => s.categoryId === category.categoryId);
    const actualYear = round2(own.reduce((sum, s) => sum + s.amount, 0));
    const actualToDate = round2(own.filter((s) => s.month <= elapsed).reduce((sum, s) => sum + s.amount, 0));
    const budgetToDate = round2((category.annualBudget * elapsed) / 12);
    return {
      ...category,
      budgetToDate,
      actualToDate,
      actualYear,
      variance: round2(budgetToDate - actualToDate),
      executedPct: category.annualBudget > 0 ? Math.round((actualYear / category.annualBudget) * 1000) / 10 : null,
    };
  });
}
