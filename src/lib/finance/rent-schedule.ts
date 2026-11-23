export interface RentContract {
  id: string;
  orgId: string;
  tenantId: string;
  startDate: string;
  endDate: string | null;
  monthlyRent: string;
}

export interface RentCharge {
  orgId: string;
  contractId: string;
  tenantId: string;
  period: string;
  dueDate: string;
  amount: string;
  description: string;
  kind: 'rent';
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function daysInMonth(period: string): number {
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function dueDateFor(startDate: string, period: string): string {
  const day = Math.min(Number(startDate.slice(8, 10)), daysInMonth(period));
  return `${period.slice(0, 8)}${String(day).padStart(2, '0')}`;
}

function coversPeriod(contract: RentContract, period: string): boolean {
  const startsBeforeEnd = monthStart(contract.startDate) <= period;
  const endsAfterStart = !contract.endDate || contract.endDate >= period;
  return startsBeforeEnd && endsAfterStart && Number(contract.monthlyRent) > 0;
}

export function rentChargesFor(contracts: readonly RentContract[], today: string): RentCharge[] {
  const period = monthStart(today);
  return contracts
    .filter((contract) => coversPeriod(contract, period))
    .map((contract) => ({
      orgId: contract.orgId,
      contractId: contract.id,
      tenantId: contract.tenantId,
      period,
      dueDate: dueDateFor(contract.startDate, period),
      amount: contract.monthlyRent,
      description: `Renta ${period.slice(0, 7)}`,
      kind: 'rent',
    }));
}
