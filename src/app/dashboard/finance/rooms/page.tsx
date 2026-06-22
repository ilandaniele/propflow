import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { units as unitsTable, contracts, payments as paymentsTable, expenses as expensesTable, properties } from '@/lib/db/schema';
import { eq, and, gte, asc } from 'drizzle-orm';
import { z } from 'zod';
import {
  computeRoomProfitability,
  ROOM_SORT_COLUMNS,
} from '@/lib/finance/reports';
import type { RoomSortColumn, UnitRow, RoomPaymentRow, RoomExpenseRow } from '@/lib/finance/reports';
import { RoomProfitabilityTable } from '@/components/finance/RoomProfitabilityTable';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

const PAGE_SIZE = 50;

const SortSchema = z.enum(ROOM_SORT_COLUMNS as unknown as [string, ...string[]]);
const PageSchema = z.coerce.number().int().min(0).default(0);

interface SearchParams {
  sort?: string;
  page?: string;
}

export default async function RoomProfitabilityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireAdmin();
  const t   = await getTranslations('finance');

  // Validate query params
  const params     = await searchParams;
  const sortResult = SortSchema.safeParse(params.sort ?? 'net_profit');
  const sort: RoomSortColumn = sortResult.success ? (sortResult.data as RoomSortColumn) : 'net_profit';
  const page = PageSchema.parse(params.page ?? '0');

  // Fetch data (last 30 days)
  const now          = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [rawUnits, activeContracts, paymentData, expenseData] = await Promise.all([
    db
      .select({ id: unitsTable.id, label: unitsTable.label, propertyName: properties.name })
      .from(unitsTable)
      .leftJoin(properties, and(eq(properties.id, unitsTable.propertyId), eq(properties.orgId, ctx.orgId)))
      .where(eq(unitsTable.orgId, ctx.orgId))
      .orderBy(asc(unitsTable.label))
      .limit(100),
    db
      .select({ unitId: contracts.unitId })
      .from(contracts)
      .where(and(eq(contracts.orgId, ctx.orgId), eq(contracts.status, 'active'))),
    db
      .select({ amount: paymentsTable.amount, unitId: contracts.unitId })
      .from(paymentsTable)
      .leftJoin(contracts, eq(contracts.id, paymentsTable.contractId))
      .where(and(eq(paymentsTable.orgId, ctx.orgId), eq(paymentsTable.status, 'approved'), gte(paymentsTable.paidAt, thirtyDaysAgo)))
      .limit(500),
    db
      .select({ amount: expensesTable.amount, unitId: expensesTable.unitId })
      .from(expensesTable)
      .where(and(eq(expensesTable.orgId, ctx.orgId), gte(expensesTable.incurredOn, thirtyDaysAgo)))
      .limit(500),
  ]);

  const occupiedIds = new Set(activeContracts.map((c) => c.unitId).filter(Boolean) as string[]);

  const unitRows: UnitRow[] = rawUnits.map((u) => ({
    id:            u.id,
    label:         u.label,
    property_name: u.propertyName ?? null,
  }));

  const payments: RoomPaymentRow[] = paymentData
    .filter((p) => p.unitId != null)
    .map((p) => ({ unit_id: p.unitId as string, amount: Number(p.amount) }));

  const expenses: RoomExpenseRow[] = expenseData
    .filter((e) => e.unitId != null)
    .map((e) => ({ unit_id: e.unitId as string, amount: Number(e.amount) }));

  const rows = computeRoomProfitability(unitRows, payments, expenses, occupiedIds, sort, page, PAGE_SIZE);

  const basePath   = '/dashboard/finance/rooms';
  const tableLabels = {
    room:      t('rooms.room'),
    property:  t('rooms.property'),
    revenue:   t('rooms.revenue'),
    expenses:  t('rooms.expenses'),
    netProfit: t('rooms.netProfit'),
    occupancy: t('rooms.occupancy'),
    occupied:  t('rooms.occupied'),
    vacant:    t('rooms.vacant'),
    previous:  t('rooms.previous'),
    next:      t('rooms.next'),
    noData:    t('rooms.noData'),
    pageInfo:  t('rooms.pageInfo'),
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <Link href="/dashboard/finance" className="text-xs text-slate-500 hover:text-brand-600 transition-colors mb-1 block">
            ← {t('backToFinance')}
          </Link>
          <h1 className="text-2xl font-semibold text-slate-900">{t('rooms.title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('rooms.subtitle')}</p>
        </div>
      </div>

      <Card padding="md">
        <CardHeader>
          <CardTitle>{t('rooms.cardTitle')}</CardTitle>
        </CardHeader>
        <RoomProfitabilityTable
          rows={rows}
          sort={sort}
          page={page}
          totalRows={unitRows.length}
          pageSize={PAGE_SIZE}
          basePath={basePath}
          labels={tableLabels}
        />
      </Card>
    </div>
  );
}
