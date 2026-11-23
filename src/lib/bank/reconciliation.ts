import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { asBatch, chunk, rowsPerInsert } from '@/lib/db/batch';
import { isUniqueViolation } from '@/lib/db/errors';
import { bankImports, bankLines, contracts, payments, tenants } from '@/lib/db/schema';
import type { StatementLine } from './parse-statement';

const LIST_LIMIT = 200;
const CANDIDATE_LIMIT = 500;
const OPEN_PAYMENT_STATUSES = ['pending', 'under_review'];

export type ImportResult = { importId: string; inserted: number; duplicates: number };
export type MatchResult = { status: 'not_found' } | { status: 'conflict' } | { status: 'done' };
export type CreateFromLineResult = { status: 'not_found' } | { status: 'conflict' } | { status: 'done'; paymentId: string };

export async function importBankLines(orgId: string, createdBy: string, fileName: string, lines: StatementLine[]): Promise<ImportResult> {
  const [row] = await db.insert(bankImports)
    .values({ orgId, fileName: fileName.slice(0, 200), lineCount: lines.length, createdBy })
    .returning({ id: bankImports.id });

  const values = lines.map((line) => ({ orgId, importId: row.id, ...line }));
  const statements = chunk(values, rowsPerInsert(bankLines)).map((part) =>
    db.insert(bankLines).values(part).onConflictDoNothing().returning({ id: bankLines.id }),
  );
  const batch = asBatch(statements);
  const results = batch ? ((await db.batch(batch)) as { id: string }[][]) : [];
  const inserted = results.reduce((total, part) => total + part.length, 0);
  return { importId: row.id, inserted, duplicates: lines.length - inserted };
}

const lineColumns = {
  id: bankLines.id,
  postedOn: bankLines.postedOn,
  description: bankLines.description,
  reference: bankLines.reference,
  amount: bankLines.amount,
  status: bankLines.status,
  paymentId: bankLines.paymentId,
};

export function listBankLines(orgId: string, status: 'unmatched' | 'matched' | 'ignored') {
  return db.select(lineColumns)
    .from(bankLines)
    .where(and(eq(bankLines.orgId, orgId), eq(bankLines.status, status)))
    .orderBy(desc(bankLines.postedOn))
    .limit(LIST_LIMIT);
}

export function openPaymentCandidates(orgId: string) {
  return db.select({
    id: payments.id,
    amount: payments.amount,
    paidAt: payments.paidAt,
    reference: payments.reference,
    tenantName: tenants.fullName,
  })
    .from(payments)
    .innerJoin(tenants, eq(tenants.id, payments.tenantId))
    .where(and(eq(payments.orgId, orgId), inArray(payments.status, OPEN_PAYMENT_STATUSES)))
    .orderBy(desc(payments.paidAt))
    .limit(CANDIDATE_LIMIT);
}

export function activeContractOptions(orgId: string) {
  return db.select({ id: contracts.id, tenantName: tenants.fullName })
    .from(contracts)
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .where(and(eq(contracts.orgId, orgId), eq(contracts.status, 'active')))
    .orderBy(tenants.fullName)
    .limit(CANDIDATE_LIMIT);
}

async function findOpenLine(orgId: string, lineId: string) {
  const [line] = await db.select(lineColumns)
    .from(bankLines)
    .where(and(eq(bankLines.id, lineId), eq(bankLines.orgId, orgId), eq(bankLines.status, 'unmatched')))
    .limit(1);
  return line;
}

async function linkLine(lineId: string, paymentId: string, userId: string): Promise<boolean> {
  try {
    const rows = await db.update(bankLines)
      .set({ status: 'matched', paymentId, resolvedBy: userId, resolvedAt: new Date() })
      .where(and(eq(bankLines.id, lineId), eq(bankLines.status, 'unmatched')))
      .returning({ id: bankLines.id });
    return rows.length === 1;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

export async function matchBankLine(orgId: string, userId: string, lineId: string, paymentId: string): Promise<MatchResult> {
  const [line, [payment]] = await Promise.all([
    findOpenLine(orgId, lineId),
    db.select({ id: payments.id, status: payments.status })
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.orgId, orgId)))
      .limit(1),
  ]);
  if (!line || !payment) return { status: 'not_found' };
  if (!(await linkLine(lineId, paymentId, userId))) return { status: 'conflict' };

  if (payment.status !== 'approved') {
    const now = new Date();
    await db.update(payments)
      .set({ status: 'approved', approvedBy: userId, approvedAt: now, updatedAt: now })
      .where(eq(payments.id, paymentId));
  }
  return { status: 'done' };
}

export async function createPaymentFromLine(orgId: string, userId: string, lineId: string, contractId: string): Promise<CreateFromLineResult> {
  const [line, [contract]] = await Promise.all([
    findOpenLine(orgId, lineId),
    db.select({ id: contracts.id, tenantId: contracts.tenantId, tenantName: tenants.fullName })
      .from(contracts)
      .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
      .where(and(eq(contracts.id, contractId), eq(contracts.orgId, orgId)))
      .limit(1),
  ]);
  if (!line || !contract) return { status: 'not_found' };

  const now = new Date();
  const [payment] = await db.insert(payments).values({
    orgId,
    contractId,
    tenantId: contract.tenantId,
    tenantName: contract.tenantName,
    amount: line.amount,
    paidAt: line.postedOn,
    method: 'transfer',
    status: 'approved',
    approvedBy: userId,
    approvedAt: now,
    reference: line.reference,
  }).returning({ id: payments.id });

  if (!(await linkLine(lineId, payment.id, userId))) {
    await db.delete(payments).where(eq(payments.id, payment.id));
    return { status: 'conflict' };
  }
  return { status: 'done', paymentId: payment.id };
}

export async function setBankLineIgnored(orgId: string, userId: string, lineId: string, ignored: boolean): Promise<boolean> {
  const from = ignored ? 'unmatched' : 'ignored';
  const rows = await db.update(bankLines)
    .set(ignored ? { status: 'ignored', resolvedBy: userId, resolvedAt: new Date() } : { status: 'unmatched', resolvedBy: null, resolvedAt: null })
    .where(and(eq(bankLines.id, lineId), eq(bankLines.orgId, orgId), eq(bankLines.status, from)))
    .returning({ id: bankLines.id });
  return rows.length === 1;
}
