'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
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

  // Validate variables JSON
  let variables: unknown;
  try { variables = JSON.parse(parsed.data.variables ?? '[]'); } catch {
    return Errors.VALIDATION_ERROR({ formErrors: ['Invalid variables JSON'], fieldErrors: {} });
  }

  const supabase = await createClient();
  const { error } = await supabase.from('contract_templates').insert({
    org_id: ctx.orgId,
    name: parsed.data.name,
    body_markdown: parsed.data.body_markdown,
    variables,
  });

  if (error) {
    if (error.code === '23505') return Errors.CONFLICT('Template name already exists');
    log.error('[createContractTemplate] db error', { code: error.code });
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

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('contract_templates').select('id').eq('id', parsed.data.id).eq('org_id', ctx.orgId).single();
  if (!existing) return Errors.NOT_FOUND();

  const { error } = await supabase.from('contract_templates').update({
    name: parsed.data.name,
    body_markdown: parsed.data.body_markdown,
    variables,
    updated_at: new Date().toISOString(),
  }).eq('id', parsed.data.id).eq('org_id', ctx.orgId);

  if (error) {
    log.error('[updateContractTemplate] db error', { code: error.code });
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

  const supabase = await createClient();

  // Load contract + tenant + unit + property + template — all must belong to org
  const [contractRes, templateRes] = await Promise.all([
    supabase.from('contracts').select(`
      id, org_id, monthly_rent, deposit, start_date, end_date,
      tenant:tenants(id, full_name, email),
      unit:units(id, label, property_id, property:properties(id, name, address))
    `).eq('id', parsed.data.contract_id).eq('org_id', ctx.orgId).single(),
    supabase.from('contract_templates').select('id, name, body_markdown').eq('id', parsed.data.template_id).eq('org_id', ctx.orgId).single(),
  ]);

  if (!contractRes.data) return Errors.NOT_FOUND();
  if (!templateRes.data) return Errors.NOT_FOUND();

  const contract = contractRes.data;
  const template = templateRes.data;

  // Load org name
  const { data: org } = await supabase.from('organizations').select('name').eq('id', ctx.orgId).single();

  // Resolve variables from trusted DB data — never from client input (IC-B1)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase nested join (tenant:tenants, unit:units, property:properties) not resolved by codegen; widening to any is safe here since data comes from DB
  const tenant = contract.tenant as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase nested join (unit:units) not generically typed by the JS client
  const unit = contract.unit as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- unit?.property is a further nested join level; shape verified by the select() above
  const property = unit?.property as any;

  const variables: ContractVariables = {
    tenant_name: tenant?.full_name ?? '',
    tenant_email: tenant?.email ?? '',
    unit_label: unit?.label ?? '',
    property_name: property?.name ?? '',
    property_address: property?.address ?? '',
    start_date: contract.start_date,
    end_date: contract.end_date,
    monthly_rent: String(contract.monthly_rent),
    deposit: contract.deposit != null ? String(contract.deposit) : '',
    org_name: org?.name ?? '',
    generated_date: new Date().toLocaleDateString('en-US'),
  };

  try {
    const pdfBytes = await generateContractPdfBuffer({
      templateName: template.name,
      bodyMarkdown: template.body_markdown,
      variables,
    });

    // Upload to contracts bucket: org_id/contract_id/contract.pdf
    const filePath = `${ctx.orgId}/${parsed.data.contract_id}/contract.pdf`;
    const adminClient = createAdminClient(); // service role for storage write
    const { error: uploadError } = await adminClient.storage
      .from('contracts')
      .upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: true });

    if (uploadError) {
      log.error('[generateContractPdf] storage upload error', { code: uploadError.message });
      return Errors.INTERNAL();
    }

    // Update contracts.document_url
    const { error: updateError } = await supabase
      .from('contracts')
      .update({ document_url: filePath, updated_at: new Date().toISOString() })
      .eq('id', parsed.data.contract_id)
      .eq('org_id', ctx.orgId);

    if (updateError) {
      log.error('[generateContractPdf] update error', { code: updateError.code });
      return Errors.INTERNAL();
    }
  } catch (e) {
    // A10: fail-closed; no stack trace to client
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

  const supabase = await createClient();

  // Load contract with tenant email
  const { data: contract } = await supabase
    .from('contracts')
    .select(`
      id, org_id, document_url,
      tenant:tenants(id, full_name, email, profile_id),
      unit:units(id, label, property:properties(id, name, address))
    `)
    .eq('id', parsed.data.contract_id)
    .eq('org_id', ctx.orgId)
    .single();

  if (!contract) return Errors.NOT_FOUND();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase nested join (tenant:tenants) not generically typed by the JS client; shape verified by select() above
  const tenant = contract.tenant as any;
  if (!tenant?.email) {
    return Errors.VALIDATION_ERROR({ formErrors: ['Tenant has no email address'], fieldErrors: {} });
  }

  // Create signature_requests row (expires in 14 days)
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: sigRequest, error: sigError } = await supabase
    .from('signature_requests')
    .insert({
      org_id: ctx.orgId,
      contract_id: parsed.data.contract_id,
      signer_profile_id: tenant.profile_id ?? null,
      signer_email: tenant.email,
      expires_at: expiresAt,
      status: 'sent',
    })
    .select('id, token')
    .single();

  if (sigError || !sigRequest) {
    log.error('[sendSignatureRequest] insert error', { code: sigError?.code });
    return Errors.INTERNAL();
  }

  // Set contract.signature_status = 'pending_signature'
  await supabase.from('contracts').update({
    signature_status: 'pending_signature',
    updated_at: new Date().toISOString(),
  }).eq('id', parsed.data.contract_id).eq('org_id', ctx.orgId);

  // Send email with tokenized link (non-blocking; failure logged, not fatal)
  const siteUrl = env.NEXT_PUBLIC_SITE_URL;
  const signUrl = `${siteUrl}/sign/${sigRequest.token}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase nested join (unit:units → property:properties) not generically typed; shape verified by select() above
  const property = (contract.unit as any)?.property;

  const emailContent = buildSignatureRequestEmail({
    signerName: tenant.full_name ?? 'Tenant',
    propertyAddress: property?.address ?? property?.name ?? 'your rental',
    signUrl,
    expiresAt: new Date(expiresAt),
  });

  const emailResult = await sendEmail({
    to: tenant.email,
    ...emailContent,
    context: 'signature_request',
  });

  if (!emailResult.success) {
    log.warn('[sendSignatureRequest] email send failed', { sigRequestId: sigRequest.id });
    // Don't fail the action — the admin can resend; the token is created
  }

  log.adminAction(ctx.userId, 'send_signature_request', 'signature_request', sigRequest.id);
  revalidatePath(`/dashboard/contracts/${parsed.data.contract_id}`);
  return ok(undefined);
}
