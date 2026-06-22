import { requireAdmin } from '@/lib/auth/guards';
import { createAdminServerClient as createClient } from '@/lib/supabase/server';
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

const PAGE_SIZE = 50; // server-paginated; computeRoomProfitability caps at 100

/**
 * Validate sort param against allowlist — prevents any SQL injection risk
 * at the query-param layer (the DB queries below use Supabase client methods
 * with parameterized values, never raw string concat ORDER BY).
 */
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
  const supabase = await createClient();
  const t = await getTranslations('finance');

  // ── Validate query params ────────────────────────────────────────────────
  const params = await searchParams;
  const sortResult = SortSchema.safeParse(params.sort ?? 'net_profit');
  const sort: RoomSortColumn = sortResult.success
    ? (sortResult.data as RoomSortColumn)
    : 'net_profit';
  const page = PageSchema.parse(params.page ?? '0');

  // ── Fetch data (last 30 days) ────────────────────────────────────────────
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Units
  const { data: rawUnits } = await supabase
    .from('units')
    .select('id, label, properties(name)')
    .eq('org_id', ctx.orgId)
    .order('label', { ascending: true })
    .limit(100); // AC23: max 100 rows

  // Active contract → unit mapping (for occupancy)
  const { data: activeContracts } = await supabase
    .from('contracts')
    .select('unit_id')
    .eq('org_id', ctx.orgId)
    .eq('status', 'active');

  const occupiedIds = new Set(
    (activeContracts ?? []).map((c: { unit_id: string }) => c.unit_id)
  );

  // Payments: resolve unit_id via contracts join
  const { data: paymentData } = await supabase
    .from('payments')
    .select('amount, contracts(unit_id)')
    .eq('org_id', ctx.orgId)
    .eq('status', 'approved')
    .gte('paid_at', thirtyDaysAgo)
    .limit(500);

  // Expenses with unit_id
  const { data: expenseData } = await supabase
    .from('expenses')
    .select('amount, unit_id')
    .eq('org_id', ctx.orgId)
    .gte('incurred_on', thirtyDaysAgo)
    .limit(500);

  // ── Map rows ─────────────────────────────────────────────────────────────
  // Supabase join returns relation columns as objects or arrays — cast via any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase join (properties) returns object or array; no generic type resolves this mixed shape
  const units: UnitRow[] = (rawUnits ?? []).map((u: any) => {
    const prop = Array.isArray(u.properties) ? u.properties[0] : u.properties;
    return {
      id: u.id as string,
      label: u.label as string,
      property_name: (prop as { name: string } | null | undefined)?.name ?? null,
    };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase join (contracts) returns object or array; no generic type resolves this mixed shape
  const payments: RoomPaymentRow[] = (paymentData ?? []).flatMap((p: any) => {
    const contract = Array.isArray(p.contracts) ? p.contracts[0] : p.contracts;
    if (!contract?.unit_id) return [];
    return [{ unit_id: contract.unit_id as string, amount: p.amount as number }];
  });

  const expenses: RoomExpenseRow[] = (expenseData ?? []).map((e) => ({
    unit_id: e.unit_id,
    amount: e.amount,
  }));

  // ── Compute profitability (pure function — parameterized sort via allowlist) ──
  const rows = computeRoomProfitability(
    units,
    payments,
    expenses,
    occupiedIds,
    sort,
    page,
    PAGE_SIZE
  );

  const basePath = '/dashboard/finance/rooms';

  const tableLabels = {
    room: t('rooms.room'),
    property: t('rooms.property'),
    revenue: t('rooms.revenue'),
    expenses: t('rooms.expenses'),
    netProfit: t('rooms.netProfit'),
    occupancy: t('rooms.occupancy'),
    occupied: t('rooms.occupied'),
    vacant: t('rooms.vacant'),
    previous: t('rooms.previous'),
    next: t('rooms.next'),
    noData: t('rooms.noData'),
    pageInfo: t('rooms.pageInfo'),
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <Link
            href="/dashboard/finance"
            className="text-xs text-slate-500 hover:text-brand-600 transition-colors mb-1 block"
          >
            ← {t('backToFinance')}
          </Link>
          <h1 className="text-2xl font-semibold text-slate-900">{t('rooms.title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('rooms.subtitle')}</p>
        </div>
      </div>

      {/* Table */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>{t('rooms.cardTitle')}</CardTitle>
        </CardHeader>
        <RoomProfitabilityTable
          rows={rows}
          sort={sort}
          page={page}
          totalRows={units.length}
          pageSize={PAGE_SIZE}
          basePath={basePath}
          labels={tableLabels}
        />
      </Card>
    </div>
  );
}
