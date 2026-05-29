export interface TenantStatement {
  tenant_id: string;
  total_charges: number;
  total_approved_payments: number;
  balance: number; // negative = debt
  is_overdue: boolean;
}

/**
 * Compute balance from charges and approved payments.
 * balance = approved_payments - charges
 * Negative balance = tenant owes money (debt).
 */
export function computeBalance(
  totalCharges: number,
  totalApprovedPayments: number
): number {
  return totalApprovedPayments - totalCharges;
}

/**
 * Determine if a tenant is overdue.
 * Overdue = negative balance AND at least one charge has a past due_date.
 */
export function isOverdue(
  balance: number,
  charges: Array<{ due_date: string | null; amount: number }>
): boolean {
  if (balance >= 0) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return charges.some((c) => {
    if (!c.due_date) return false;
    const due = new Date(c.due_date);
    due.setHours(0, 0, 0, 0);
    return due < today;
  });
}

/**
 * Build a statement summary from raw totals.
 */
export function buildStatement(
  tenantId: string,
  charges: Array<{ amount: number; due_date: string | null }>,
  approvedPayments: Array<{ amount: number }>
): TenantStatement {
  const totalCharges = charges.reduce((sum, c) => sum + c.amount, 0);
  const totalApproved = approvedPayments.reduce((sum, p) => sum + p.amount, 0);
  const balance = computeBalance(totalCharges, totalApproved);
  return {
    tenant_id: tenantId,
    total_charges: totalCharges,
    total_approved_payments: totalApproved,
    balance,
    is_overdue: isOverdue(balance, charges),
  };
}
