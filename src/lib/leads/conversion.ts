import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contracts, crmLeads, leadConversions, properties, tenants, units } from '@/lib/db/schema';
import type { ConvertLeadInput } from '@/lib/schemas/lead-conversion';

export type ConvertLeadOutcome =
  | { kind: 'ok'; tenantId: string }
  | { kind: 'not_found' }
  | { kind: 'already_converted'; tenantId: string };

async function findConversion(leadId: string) {
  const [row] = await db.select({ tenantId: leadConversions.tenantId })
    .from(leadConversions)
    .where(eq(leadConversions.leadId, leadId))
    .limit(1);
  return row ?? null;
}

export async function leadConversionContext(orgId: string, leadId: string) {
  const [lead] = await db.select({
    id: crmLeads.id,
    fullName: crmLeads.fullName,
    email: crmLeads.email,
    phone: crmLeads.phone,
    moveInDate: crmLeads.moveInDate,
    currency: crmLeads.currency,
  })
    .from(crmLeads)
    .where(and(eq(crmLeads.id, leadId), eq(crmLeads.orgId, orgId)))
    .limit(1);
  if (!lead) return null;

  const [conversion, unitOptions] = await Promise.all([
    findConversion(lead.id),
    db.select({
      id: units.id,
      label: units.label,
      status: units.status,
      monthlyRentDefault: units.monthlyRentDefault,
      propertyName: properties.name,
    })
      .from(units)
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .where(eq(units.orgId, orgId))
      .orderBy(asc(properties.name), asc(units.label)),
  ]);

  return { lead, conversion, units: unitOptions };
}

export async function convertLead(orgId: string, input: ConvertLeadInput): Promise<ConvertLeadOutcome> {
  const [[lead], [unit]] = await Promise.all([
    db.select({ id: crmLeads.id }).from(crmLeads)
      .where(and(eq(crmLeads.id, input.lead_id), eq(crmLeads.orgId, orgId))).limit(1),
    db.select({ id: units.id }).from(units)
      .where(and(eq(units.id, input.unit_id), eq(units.orgId, orgId))).limit(1),
  ]);
  if (!lead || !unit) return { kind: 'not_found' };

  const existing = await findConversion(lead.id);
  if (existing) return { kind: 'already_converted', tenantId: existing.tenantId };

  const tenantId = crypto.randomUUID();
  const contractId = crypto.randomUUID();
  const now = new Date();
  const monthlyRent = String(input.monthly_rent);
  const deposit = typeof input.deposit === 'number' ? String(input.deposit) : null;

  await db.batch([
    db.insert(tenants).values({
      id: tenantId,
      orgId,
      fullName: input.full_name,
      email: input.email || null,
      phone: input.phone || null,
      unitId: unit.id,
      moveInDate: input.start_date,
      monthlyRent,
      deposit,
      contractStart: input.start_date,
      contractEnd: input.end_date,
    }),
    db.insert(contracts).values({
      id: contractId,
      orgId,
      tenantId,
      unitId: unit.id,
      startDate: input.start_date,
      endDate: input.end_date,
      monthlyRent,
      deposit,
      status: 'active',
    }),
    db.update(units).set({ status: 'occupied', updatedAt: now })
      .where(and(eq(units.id, unit.id), eq(units.orgId, orgId))),
    db.insert(leadConversions).values({ orgId, leadId: lead.id, tenantId, contractId }),
  ]);

  return { kind: 'ok', tenantId };
}
