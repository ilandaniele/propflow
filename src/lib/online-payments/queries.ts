import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { charges, paymentIntents, tenants } from '@/lib/db/schema';
import { decodeCursor, encodeCursor, MAX_PAGE_SIZE } from '@/lib/pagination';

const LINKABLE_CHARGES_LIMIT = 100;

export async function findPublicIntentByToken(token: string) {
  const [row] = await db
    .select({
      amount:      paymentIntents.amount,
      currency:    paymentIntents.currency,
      status:      paymentIntents.status,
      provider:    paymentIntents.provider,
      checkoutUrl: paymentIntents.checkoutUrl,
      expiresAt:   paymentIntents.expiresAt,
      concept:     charges.description,
      dueDate:     charges.dueDate,
      tenantName:  tenants.fullName,
    })
    .from(paymentIntents)
    .innerJoin(charges, and(eq(charges.id, paymentIntents.chargeId), eq(charges.orgId, paymentIntents.orgId)))
    .leftJoin(tenants, and(eq(tenants.id, charges.tenantId), eq(tenants.orgId, charges.orgId)))
    .where(eq(paymentIntents.token, token))
    .limit(1);
  if (!row) return null;
  const { tenantName, ...rest } = row;
  return { ...rest, tenantFirstName: tenantName?.trim().split(/\s+/)[0] ?? null };
}

export type PublicIntent = NonNullable<Awaited<ReturnType<typeof findPublicIntentByToken>>>;

export async function listPaymentIntents(orgId: string, cursor?: string | null) {
  const after = cursor ? decodeCursor(cursor) : null;
  const afterDate = after ? new Date(Number(after.created_at)) : null;
  const rows = await db
    .select({
      id:          paymentIntents.id,
      token:       paymentIntents.token,
      provider:    paymentIntents.provider,
      status:      paymentIntents.status,
      amount:      paymentIntents.amount,
      currency:    paymentIntents.currency,
      amountPaid:  paymentIntents.amountPaid,
      paidAt:      paymentIntents.paidAt,
      expiresAt:   paymentIntents.expiresAt,
      createdAt:   paymentIntents.createdAt,
      concept:     charges.description,
      tenantName:  tenants.fullName,
    })
    .from(paymentIntents)
    .innerJoin(charges, and(eq(charges.id, paymentIntents.chargeId), eq(charges.orgId, orgId)))
    .leftJoin(tenants, and(eq(tenants.id, charges.tenantId), eq(tenants.orgId, orgId)))
    .where(and(
      eq(paymentIntents.orgId, orgId),
      after && afterDate && !Number.isNaN(afterDate.getTime())
        ? or(lt(paymentIntents.createdAt, afterDate), and(eq(paymentIntents.createdAt, afterDate), lt(paymentIntents.id, after.id)))
        : undefined,
    ))
    .orderBy(desc(paymentIntents.createdAt), desc(paymentIntents.id))
    .limit(MAX_PAGE_SIZE + 1);

  const items = rows.slice(0, MAX_PAGE_SIZE);
  const last = items[items.length - 1];
  const nextCursor = rows.length > MAX_PAGE_SIZE && last ? encodeCursor(String(last.createdAt.getTime()), last.id) : null;
  return { items, nextCursor };
}

export async function listLinkableCharges(orgId: string) {
  return db
    .select({
      id:          charges.id,
      amount:      charges.amount,
      description: charges.description,
      dueDate:     charges.dueDate,
      tenantName:  tenants.fullName,
    })
    .from(charges)
    .leftJoin(tenants, and(eq(tenants.id, charges.tenantId), eq(tenants.orgId, orgId)))
    .leftJoin(paymentIntents, and(eq(paymentIntents.chargeId, charges.id), eq(paymentIntents.status, 'paid')))
    .where(and(eq(charges.orgId, orgId), isNull(paymentIntents.id)))
    .orderBy(desc(charges.createdAt))
    .limit(LINKABLE_CHARGES_LIMIT);
}
