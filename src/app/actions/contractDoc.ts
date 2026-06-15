'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { contractTemplates, contracts, organizations, signatureRequests, tenants, units, properties } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
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
      orgId: ctx.orgId,
      name: parsed.data.name,
      bodyMarkdown: parsed.data.body_markdown,
      variables,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('23505')) return Errors.CONFLICT('Template name already exists');
    log.error('[createContractTemplate] db error', { err: msg });
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

  const existing = await db.select({ id: contractTemplates.id })
    .from(contractTemplates)
    .where(and(eq(contractTemplates.id, parsed.data.id), eq(contractTemplates.orgId, ctx.orgId)))
    .then(r => r[0] ?? null);
  if (!existing) return Errors.NOT_FOUND();

  try {
    await db.update(contractTemplates).set({
      name: parsed.data.name,
      bodyMarkdown: parsed.data.body_markdown,
      variables,
      updatedAt: new Date(),
    }).where(and(eq(contractTemplates.id, parsed.data.id), eq(contractTemplates.orgId, ctx.orgId)));
  } catch (err) {
    log.error('[updateContractTemplate] db error', { err: err instanceof Error ? err.message : String(err) });
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

  // Load contract, template, org in parallel — all must belong to this org
  const [contractRow, templateRow, orgRow] = await Promise.all([
    db.select({
      id: contracts.id,
      orgId: contracts.orgId,
      monthlyRent: contracts.monthlyRent,
      deposit: contracts.deposit,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      tenantId: contracts.tenantId,
      unitId: contracts.unitId,
    })
      .from(contracts)
      .where(and(eq(contracts.id, parsed.data.contract_id), eq(contracts.orgId, ctx.orgId)))
      .then(r => r[0] ?? null),
    db.select({ id: contractTemplates.id, name: contractTemplates.name, bodyMarkdown: contractTemplates.bodyMarkdown })
      .from(contractTemplates)
      .where(and(eq(contractTemplates.id, parsed.data.template_id), eq(contractTemplates.orgId, ctx.orgId)))
      .then(r => r[0] ?? null),
    db.select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, ctx.orgId))
      .then(r => r[0] ?? null),
  ]);

  if (!contractRow) return Errors.NOT_FOUND();
  if (!templateRow) return Errors.NOT_FOUND();

  // Fetch tenant and unit+property for the contract
  const [tenantRow, unitRow] = await Promise.all([
    db.select({ id: tenants.id, fullName: tenants.fullName, email: tenants.email, profileId: tenants.profileId })
      .from(tenants)
      .where(eq(tenants.id, contractRow.tenantId))
      .then(r => r[0] ?? null),
    db.select({ id: units.id, label: units.label, propertyId: units.propertyId })
      .from(units)
      .where(eq(units.id, contractRow.unitId))
      .then(r => r[0] ?? null),
  ]);

  const propertyRow = unitRow?.propertyId
    ? await db.select({ id: properties.id, name: properties.name, address: properties.address })
        .from(properties)
        .where(eq(properties.id, unitRow.propertyId))
        .then(r => r[0] ?? null)
    : null;

  // Resolve variables from trusted DB data — never from client input (IC-B1)
  const variables: ContractVariables = {
    tenant_name: tenantRow?.fullName ?? '',
    tenant_email: tenantRow?.email ?? '',
    unit_label: unitRow?.label ?? '',
    property_name: propertyRow?.name ?? '',
    property_address: propertyRow?.address ?? '',
    start_date: contractRow.startDate,
    end_date: contractRow.endDate ?? undefined,
    monthly_rent: String(contractRow.monthlyRent),
    deposit: contractRow.deposit != null ? String(contractRow.deposit) : '',
    org_name: orgRow?.name ?? '',
    generated_date: new Date().toLocaleDateString('en-US'),
  };

  try {
    const pdfBytes = await generateContractPdfBuffer({
      templateName: templateRow.name,
      bodyMarkdown: templateRow.bodyMarkdown,
      variables,
    });

    // Upload to contracts bucket: org_id/contract_id/contract.pdf
    const filePath = `${ctx.orgId}/${parsed.data.contract_id}/contract.pdf`;
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const adminClient = createAdminClient(); // service role for storage write
    const { error: uploadError } = await adminClient.storage
      .from('contracts')
      .upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: true });

    if (uploadError) {
      log.error('[generateContractPdf] storage upload error', { code: uploadError.message });
      return Errors.INTERNAL();
    }

    // Update contracts.document_url via Drizzle
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

  // Load contract
  const contractRow = await db.select({
    id: contracts.id,
    orgId: contracts.orgId,
    documentUrl: contracts.documentUrl,
    tenantId: contracts.tenantId,
    unitId: contracts.unitId,
  })
    .from(contracts)
    .where(and(eq(contracts.id, parsed.data.contract_id), eq(contracts.orgId, ctx.orgId)))
    .then(r => r[0] ?? null);

  if (!contractRow) return Errors.NOT_FOUND();

  // Fetch tenant and unit+property
  const [tenantRow, unitRow] = await Promise.all([
    db.select({ id: tenants.id, fullName: tenants.fullName, email: tenants.email, profileId: tenants.profileId })
      .from(tenants)
      .where(eq(tenants.id, contractRow.tenantId))
      .then(r => r[0] ?? null),
    db.select({ id: units.id, label: units.label, propertyId: units.propertyId })
      .from(units)
      .where(eq(units.id, contractRow.unitId))
      .then(r => r[0] ?? null),
  ]);

  if (!tenantRow?.email) {
    return Errors.VALIDATION_ERROR({ formErrors: ['Tenant has no email address'], fieldErrors: {} });
  }

  const propertyRow = unitRow?.propertyId
    ? await db.select({ id: properties.id, name: properties.name, address: properties.address })
        .from(properties)
        .where(eq(properties.id, unitRow.propertyId))
        .then(r => r[0] ?? null)
    : null;

  // Create signature_requests row (expires in 14 days)
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  let sigRequest: { id: string; token: string } | null = null;
  try {
    const [row] = await db.insert(signatureRequests).values({
      orgId: ctx.orgId,
      contractId: parsed.data.contract_id,
      signerProfileId: tenantRow.profileId ?? null,
      signerEmail: tenantRow.email,
      expiresAt,
      status: 'sent',
    }).returning({ id: signatureRequests.id, token: signatureRequests.token });
    sigRequest = row;
  } catch (err) {
    log.error('[sendSignatureRequest] insert error', { err: err instanceof Error ? err.message : String(err) });
    return Errors.INTERNAL();
  }

  if (!sigRequest) return Errors.INTERNAL();

  // Set contract.signature_status = 'pending_signature'
  await db.update(contracts).set({
    signatureStatus: 'pending_signature',
    updatedAt: new Date(),
  }).where(and(eq(contracts.id, parsed.data.contract_id), eq(contracts.orgId, ctx.orgId)));

  // Send email with tokenized link (non-blocking; failure logged, not fatal)
  const siteUrl = env.NEXT_PUBLIC_SITE_URL;
  const signUrl = `${siteUrl}/sign/${sigRequest.token}`;

  const emailContent = buildSignatureRequestEmail({
    signerName: tenantRow.fullName ?? 'Tenant',
    propertyAddress: propertyRow?.address ?? propertyRow?.name ?? 'your rental',
    signUrl,
    expiresAt,
  });

  const emailResult = await sendEmail({
    to: tenantRow.email,
    ...emailContent,
    context: 'signature_request',
  });

  if (!emailResult.success) {
    log.warn('[sendSignatureRequest] email send failed', { sigRequestId: sigRequest.id });
  }

  log.adminAction(ctx.userId, 'send_signature_request', 'signature_request', sigRequest.id);
  revalidatePath(`/dashboard/contracts/${parsed.data.contract_id}`);
  return ok(undefined);
}
