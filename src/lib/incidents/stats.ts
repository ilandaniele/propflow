import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { incidents, properties } from '@/lib/db/schema';

const DAY_MS = 86_400_000;

export type PropertyMaintenanceRow = {
  propertyId: string | null;
  propertyName: string | null;
  total: number;
  open: number;
  resolvedCount: number;
  resolutionDaysSum: number;
};

export type CategoryCount = { category: string; total: number };

export type PropertyMaintenance = {
  propertyId: string | null;
  propertyName: string | null;
  total: number;
  open: number;
  avgResolutionDays: number | null;
};

export type MaintenanceStats = {
  total: number;
  open: number;
  solved: number;
  avgResolutionDays: number | null;
  byProperty: PropertyMaintenance[];
  byCategory: CategoryCount[];
};

function average(sum: number, count: number): number | null {
  return count === 0 ? null : Math.round((sum / count) * 10) / 10;
}

export function summarizeMaintenance(rows: PropertyMaintenanceRow[], byCategory: CategoryCount[]): MaintenanceStats {
  const total = rows.reduce((s, r) => s + r.total, 0);
  const open = rows.reduce((s, r) => s + r.open, 0);
  const resolvedCount = rows.reduce((s, r) => s + r.resolvedCount, 0);
  const daysSum = rows.reduce((s, r) => s + r.resolutionDaysSum, 0);

  const byProperty = rows
    .map((r) => ({
      propertyId: r.propertyId,
      propertyName: r.propertyName,
      total: r.total,
      open: r.open,
      avgResolutionDays: average(r.resolutionDaysSum, r.resolvedCount),
    }))
    .sort((a, b) => b.total - a.total);

  return {
    total,
    open,
    solved: total - open,
    avgResolutionDays: average(daysSum, resolvedCount),
    byProperty,
    byCategory: [...byCategory].sort((a, b) => b.total - a.total),
  };
}

export async function loadMaintenanceStats(orgId: string): Promise<MaintenanceStats> {
  const isResolved = sql`${incidents.status} = 'solved' AND ${incidents.resolvedAt} IS NOT NULL`;

  const [propertyRows, categoryRows] = await Promise.all([
    db
      .select({
        propertyId: incidents.propertyId,
        propertyName: properties.name,
        total: sql<number>`count(*)`,
        open: sql<number>`sum(CASE WHEN ${incidents.status} <> 'solved' THEN 1 ELSE 0 END)`,
        resolvedCount: sql<number>`sum(CASE WHEN ${isResolved} THEN 1 ELSE 0 END)`,
        resolutionDaysSum: sql<number>`coalesce(sum(CASE WHEN ${isResolved} THEN (${incidents.resolvedAt} - ${incidents.createdAt}) * 1.0 / ${DAY_MS} ELSE 0 END), 0)`,
      })
      .from(incidents)
      .leftJoin(properties, and(eq(properties.id, incidents.propertyId), eq(properties.orgId, orgId)))
      .where(eq(incidents.orgId, orgId))
      .groupBy(incidents.propertyId, properties.name),
    db
      .select({ category: incidents.category, total: sql<number>`count(*)` })
      .from(incidents)
      .where(eq(incidents.orgId, orgId))
      .groupBy(incidents.category),
  ]);

  return summarizeMaintenance(
    propertyRows.map((r) => ({
      ...r,
      total: Number(r.total),
      open: Number(r.open ?? 0),
      resolvedCount: Number(r.resolvedCount ?? 0),
      resolutionDaysSum: Number(r.resolutionDaysSum ?? 0),
    })),
    categoryRows.map((r) => ({ category: r.category, total: Number(r.total) })),
  );
}
