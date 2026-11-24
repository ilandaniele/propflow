export interface StatementTotals {
  rentThisMonth: number;
  extrasThisMonth: number;
  rentBefore: number;
  extrasBefore: number;
  paid: number;
}

export interface StatementAmounts {
  rentAmount: number;
  additionalSubtotal: number;
  previousRentBalance: number;
  previousAddlBalance: number;
  totalDue: number;
}

const cents = (value: number) => Math.round(value * 100) / 100;

export function buildStatement(totals: StatementTotals): StatementAmounts {
  let credit = totals.paid;
  const settle = (owed: number) => {
    const applied = Math.min(Math.max(credit, 0), owed);
    credit -= applied;
    return cents(owed - applied);
  };

  const previousRentBalance = settle(totals.rentBefore);
  const previousAddlBalance = settle(totals.extrasBefore);
  const rentDue = settle(totals.rentThisMonth);
  const extrasDue = settle(totals.extrasThisMonth);

  return {
    rentAmount: cents(totals.rentThisMonth),
    additionalSubtotal: cents(totals.extrasThisMonth),
    previousRentBalance,
    previousAddlBalance,
    totalDue: cents(previousRentBalance + previousAddlBalance + rentDue + extrasDue),
  };
}

export function statementCode(month: string, contractCode: string | null, contractId: string): string {
  return `EECC-${month.replace('-', '')}-${contractCode ?? contractId.slice(0, 8)}`;
}

/** First and last day (`YYYY-MM-DD`) of a `YYYY-MM` month. */
export function statementMonthBounds(month: string): { first: string; last: string } {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, '0')}` };
}
