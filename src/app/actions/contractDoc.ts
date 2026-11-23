'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import {
  contractTemplates,
  contracts,
  tenants,
  units,
  properties,
  organizations,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { uploadFile } from '@/lib/storage';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import { mutationRateLimit, generatePdfRateLimit, sendSignatureRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import type { ActionResult } from '@/lib/errors';
import {
  ContractTemplateSchema,
  UpdateContractTemplateSchema,
  GeneratePdfSchema,
  SaveContractPdfSchema,
  SendSignatureSchema,
} from '@/lib/schemas/contractDoc';
import type { ContractPdfSource, ContractVariables } from '@/lib/contracts/pdf.tsx';
import { dispatchSignatureRequest } from '@/lib/contracts/signature-dispatch';
import { isUniqueViolation } from '@/lib/db/errors';
import { orgSignature } from '@/lib/contracts/org-signature';
import { hasPdfSignature } from '@/lib/contracts/pdf-bytes';


export async function createContractTemplate(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'create-contract-template');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = ContractTemplateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  let variables: unknown;
  try { variables = JSON.parse(parsed.data.variables ?? '[]'); } catch {
    return Errors.VALIDATION_ERROR({ formErrors: ['Invalid variables JSON'], fieldErrors: {} });
  }

  try {
    await db.insert(contractTemplates).values({
      orgId:        ctx.orgId,
      name:         parsed.data.name,
      bodyMarkdown: parsed.data.body_markdown,
      variables,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isUniqueViolation(e)) return Errors.CONFLICT('Template name already exists');
    log.error('[createContractTemplate] db error', { code: msg });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'create_contract_template', 'contract_template');
  revalidatePath('/dashboard/contracts/templates');
  return ok(undefined);
}

export async function updateContractTemplate(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'update-contract-template');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = UpdateContractTemplateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  let variables: unknown;
  try { variables = JSON.parse(parsed.data.variables ?? '[]'); } catch {
    return Errors.VALIDATION_ERROR({ formErrors: ['Invalid variables JSON'], fieldErrors: {} });
  }

  const existing = await db
    .select({ id: contractTemplates.id })
    .from(contractTemplates)
    .where(and(eq(contractTemplates.id, parsed.data.id), eq(contractTemplates.orgId, ctx.orgId)))
    .limit(1);

  if (!existing[0]) return Errors.NOT_FOUND();

  try {
    await db
      .update(contractTemplates)
      .set({ name: parsed.data.name, bodyMarkdown: parsed.data.body_markdown, variables, updatedAt: new Date() })
      .where(and(eq(contractTemplates.id, parsed.data.id), eq(contractTemplates.orgId, ctx.orgId)));
  } catch (e) {
    log.error('[updateContractTemplate] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  revalidatePath('/dashboard/contracts/templates');
  return ok(undefined);
}

export async function getContractPdfSource(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult<ContractPdfSource>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = generatePdfRateLimit(ctx.userId);
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = GeneratePdfSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  // Load contract with joined tenant, unit, property — all scoped to org
  const [contractRows, templateRows] = await Promise.all([
    db
      .select({
        id:          contracts.id,
        monthlyRent: contracts.monthlyRent,
        deposit:     contracts.deposit,
        startDate:   contracts.startDate,
        endDate:     contracts.endDate,
        durationMonths: contracts.durationMonths,
        contractCode:   contracts.contractCode,
        tenantId:    contracts.tenantId,
        unitId:      contracts.unitId,
      })
      .from(contracts)
      .where(and(eq(contracts.id, parsed.data.contract_id), eq(contracts.orgId, ctx.orgId)))
      .limit(1),
    db
      .select({ id: contractTemplates.id, name: contractTemplates.name, bodyMarkdown: contractTemplates.bodyMarkdown })
      .from(contractTemplates)
      .where(and(eq(contractTemplates.id, parsed.data.template_id), eq(contractTemplates.orgId, ctx.orgId)))
      .limit(1),
  ]);

  if (!contractRows[0]) return Errors.NOT_FOUND();
  if (!templateRows[0]) return Errors.NOT_FOUND();

  const contract = contractRows[0];
  const template = templateRows[0];

  // Load related rows
  const [tenantRows, unitRows, orgRows, signature] = await Promise.all([
    db.select({
      fullName: tenants.fullName,
      email: tenants.email,
      phone: tenants.phone,
      documentNumber: tenants.documentNumber,
      dni: tenants.dni,
      paymentDueDay: tenants.paymentDueDay,
    }).from(tenants).where(eq(tenants.id, contract.tenantId)).limit(1),
    db.select({ label: units.label, propertyId: units.propertyId }).from(units).where(eq(units.id, contract.unitId)).limit(1),
    db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1),
    orgSignature(ctx.orgId),
  ]);

  const tenant = tenantRows[0];
  const unit = unitRows[0];

  let property: { name: string; address: string | null; district: string | null } | undefined;
  if (unit?.propertyId) {
    const propRows = await db.select({ name: properties.name, address: properties.address, district: properties.district }).from(properties).where(eq(properties.id, unit.propertyId)).limit(1);
    property = propRows[0];
  }

  const variables: ContractVariables = {
    tenant_name:      tenant?.fullName ?? '',
    tenant_email:     tenant?.email ?? '',
    unit_label:       unit?.label ?? '',
    property_name:    property?.name ?? '',
    property_address: property?.address ?? '',
    start_date:       contract.startDate,
    end_date:         contract.endDate ?? undefined,
    monthly_rent:     String(contract.monthlyRent),
    deposit:          contract.deposit != null ? String(contract.deposit) : '',
    org_name:         orgRows[0]?.name ?? '',
    generated_date:   new Date().toLocaleDateString('en-US'),
    tenant_phone:     tenant?.phone ?? '',
    tenant_document:  tenant?.documentNumber ?? tenant?.dni ?? '',
    payment_day:      tenant?.paymentDueDay != null ? String(tenant.paymentDueDay) : '',
    duration_months:  contract.durationMonths != null ? String(contract.durationMonths) : '',
    property_district: property?.district ?? '',
    contract_code:    contract.contractCode ?? '',
    landlord_name:    signature?.signerName ?? '',
    landlord_document: signature?.signerDocument ?? '',
  };

  return ok({ templateName: template.name, bodyMarkdown: template.bodyMarkdown, variables, signature });
}

/**
 * Stores a contract PDF rendered in the browser (see lib/contracts/pdf-client.ts).
 * The renderer is client-side only so it stays out of the server bundle.
 */
export async function saveContractPdf(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = generatePdfRateLimit(ctx.userId);
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = SaveContractPdfSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const pdfBytes = new Uint8Array(await parsed.data.file.arrayBuffer());
  if (!hasPdfSignature(pdfBytes)) {
    return Errors.VALIDATION_ERROR({ formErrors: ['File is not a PDF'], fieldErrors: {} });
  }

  const contractRows = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(and(eq(contracts.id, parsed.data.contract_id), eq(contracts.orgId, ctx.orgId)))
    .limit(1);

  if (!contractRows[0]) return Errors.NOT_FOUND();

  try {
    // Upload to contracts bucket via unified storage lib
    const filePath = `${ctx.orgId}/${parsed.data.contract_id}/contract.pdf`;
    await uploadFile('contracts', filePath, Buffer.from(pdfBytes), 'application/pdf', false);

    // Update contracts.document_url
    await db
      .update(contracts)
      .set({ documentUrl: filePath, updatedAt: new Date() })
      .where(and(eq(contracts.id, parsed.data.contract_id), eq(contracts.orgId, ctx.orgId)));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    log.error('[saveContractPdf] exception', { error: msg });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'generate_contract_pdf', 'contract', parsed.data.contract_id);
  revalidatePath(`/dashboard/contracts/${parsed.data.contract_id}`);
  return ok(undefined);
}

export async function sendSignatureRequest(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = sendSignatureRateLimit(ctx.userId);
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = SendSignatureSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const [contract] = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(and(eq(contracts.id, parsed.data.contract_id), eq(contracts.orgId, ctx.orgId)))
    .limit(1);
  if (!contract) return Errors.NOT_FOUND();

  const dispatched = await dispatchSignatureRequest(ctx.orgId, contract.id);
  if ('error' in dispatched) {
    return dispatched.error === 'no_email'
      ? Errors.VALIDATION_ERROR({ formErrors: ['Tenant has no email address'], fieldErrors: {} })
      : Errors.INTERNAL();
  }
  const sigRequestId = dispatched.id;

  await db
    .update(contracts)
    .set({ signatureStatus: 'pending_signature', updatedAt: new Date() })
    .where(and(eq(contracts.id, parsed.data.contract_id), eq(contracts.orgId, ctx.orgId)))
    .catch(() => undefined);

  log.adminAction(ctx.userId, 'send_signature_request', 'signature_request', sigRequestId);
  revalidatePath(`/dashboard/contracts/${parsed.data.contract_id}`);
  return ok(undefined);
}
