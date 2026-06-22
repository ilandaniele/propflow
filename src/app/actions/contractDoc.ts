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
  signatureRequests,
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
  SendSignatureSchema,
} from '@/lib/schemas/contractDoc';
import { generateContractPdfBuffer, type ContractVariables } from '@/lib/contracts/pdf.tsx';
import { sendEmail, buildSignatureRequestEmail } from '@/lib/notifications/email';
import { env } from '@/lib/env';

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
    if (msg.includes('unique') || msg.includes('23505')) return Errors.CONFLICT('Template name already exists');
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

export async function generateContractPdf(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
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
  const [tenantRows, unitRows, orgRows] = await Promise.all([
    db.select({ fullName: tenants.fullName, email: tenants.email }).from(tenants).where(eq(tenants.id, contract.tenantId)).limit(1),
    db.select({ label: units.label, propertyId: units.propertyId }).from(units).where(eq(units.id, contract.unitId)).limit(1),
    db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1),
  ]);

  const tenant = tenantRows[0];
  const unit = unitRows[0];

  let property: { name: string; address: string | null } | undefined;
  if (unit?.propertyId) {
    const propRows = await db.select({ name: properties.name, address: properties.address }).from(properties).where(eq(properties.id, unit.propertyId)).limit(1);
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
  };

  try {
    const pdfBytes = await generateContractPdfBuffer({
      templateName: template.name,
      bodyMarkdown: template.bodyMarkdown,
      variables,
    });

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
    log.error('[generateContractPdf] exception', { error: msg });
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

  // Load contract scoped to org
  const contractRows = await db
    .select({
      id:           contracts.id,
      documentUrl:  contracts.documentUrl,
      tenantId:     contracts.tenantId,
      unitId:       contracts.unitId,
    })
    .from(contracts)
    .where(and(eq(contracts.id, parsed.data.contract_id), eq(contracts.orgId, ctx.orgId)))
    .limit(1);

  if (!contractRows[0]) return Errors.NOT_FOUND();
  const contract = contractRows[0];

  // Load tenant
  const tenantRows = await db
    .select({ fullName: tenants.fullName, email: tenants.email, profileId: tenants.profileId })
    .from(tenants)
    .where(eq(tenants.id, contract.tenantId))
    .limit(1);

  const tenant = tenantRows[0];
  if (!tenant?.email) {
    return Errors.VALIDATION_ERROR({ formErrors: ['Tenant has no email address'], fieldErrors: {} });
  }

  // Load unit + property for email content
  let propertyDisplay = 'your rental';
  if (contract.unitId) {
    const unitRows = await db.select({ propertyId: units.propertyId }).from(units).where(eq(units.id, contract.unitId)).limit(1);
    if (unitRows[0]?.propertyId) {
      const propRows = await db.select({ name: properties.name, address: properties.address }).from(properties).where(eq(properties.id, unitRows[0].propertyId)).limit(1);
      propertyDisplay = propRows[0]?.address ?? propRows[0]?.name ?? 'your rental';
    }
  }

  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  let sigRequestId: string;
  let sigToken: string;
  try {
    const rows = await db
      .insert(signatureRequests)
      .values({
        orgId:           ctx.orgId,
        contractId:      parsed.data.contract_id,
        signerProfileId: tenant.profileId ?? null,
        signerEmail:     tenant.email,
        expiresAt,
        status:          'sent',
      })
      .returning({ id: signatureRequests.id, token: signatureRequests.token });

    if (!rows[0]) throw new Error('No row returned');
    sigRequestId = rows[0].id;
    sigToken = rows[0].token;
  } catch (e) {
    log.error('[sendSignatureRequest] insert error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  // Set contract.signature_status = 'pending_signature'
  await db
    .update(contracts)
    .set({ signatureStatus: 'pending_signature', updatedAt: new Date() })
    .where(and(eq(contracts.id, parsed.data.contract_id), eq(contracts.orgId, ctx.orgId)))
    .catch(() => undefined);

  // Send email with tokenized link (non-blocking)
  const siteUrl = env.NEXT_PUBLIC_SITE_URL;
  const signUrl = `${siteUrl}/sign/${sigToken}`;

  const emailContent = buildSignatureRequestEmail({
    signerName:      tenant.fullName ?? 'Tenant',
    propertyAddress: propertyDisplay,
    signUrl,
    expiresAt,
  });

  const emailResult = await sendEmail({
    to: tenant.email,
    ...emailContent,
    context: 'signature_request',
  });

  if (!emailResult.success) {
    log.warn('[sendSignatureRequest] email send failed', { sigRequestId });
  }

  log.adminAction(ctx.userId, 'send_signature_request', 'signature_request', sigRequestId);
  revalidatePath(`/dashboard/contracts/${parsed.data.contract_id}`);
  return ok(undefined);
}
