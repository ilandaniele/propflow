import { err, type ActionResult } from '@/lib/errors';
import { findClosedPeriod } from './queries';

export async function closedPeriodError(orgId: string, dates: Array<string | null | undefined>): Promise<ActionResult<never> | null> {
  const period = await findClosedPeriod(orgId, dates);
  return period ? err('PERIOD_CLOSED', `Period ${period} is closed. Reopen it to make changes.`) : null;
}
