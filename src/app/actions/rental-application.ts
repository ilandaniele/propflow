'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { actionRateLimit, clientIpFromHeaders, mutationRateLimit } from '@/lib/ratelimit';
import { Errors, ok, type ActionResult } from '@/lib/errors';
import { log } from '@/lib/log';
import { getPublicOrg } from '@/lib/public/catalog';
import { RentalApplicationSchema, UpdateApplicationStatusSchema } from '@/lib/schemas/rental-application';
import { readDocumentUploads, storeDocumentUploads } from '@/lib/applications/documents';
import { createRentalApplication, rentListingBySlug, setApplicationStatus } from '@/lib/applications/service';

const TEN_MINUTES_MS = 10 * 60_000;
const ONE_DAY_MS = 24 * 60 * 60_000;
const MAX_PER_IP = 5;
const MAX_PER_ORG_DAY = 200;

function submittedFiles(formData: FormData): File[] {
  return formData.getAll('documents').filter((value): value is File => value instanceof File && value.size > 0);
}

export async function submitRentalApplication(orgSlug: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const org = await getPublicOrg(orgSlug);
  if (!org) return Errors.NOT_FOUND();

  if (formData.get('website')) return ok(undefined);

  const ip = clientIpFromHeaders(await headers());
  if (!actionRateLimit(`apply:${ip}`, MAX_PER_IP, TEN_MINUTES_MS).success
    || !actionRateLimit(`apply-org:${org.id}`, MAX_PER_ORG_DAY, ONE_DAY_MS).success) {
    return Errors.RATE_LIMITED();
  }

  const parsed = RentalApplicationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const uploads = await readDocumentUploads(submittedFiles(formData));
  if (!uploads) return Errors.VALIDATION_ERROR({ fieldErrors: { documents: ['invalid'] }, formErrors: [] });

  const listing = parsed.data.listing_slug ? await rentListingBySlug(org.id, parsed.data.listing_slug) : null;
  const applicationId = crypto.randomUUID();

  try {
    const documents = await storeDocumentUploads(org.id, applicationId, uploads);
    await createRentalApplication({ id: applicationId, orgId: org.id, input: parsed.data, listing, documents });
  } catch (e) {
    log.error('[submitRentalApplication] failed', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  revalidatePath('/dashboard/leads/applications');
  return ok(undefined);
}

export async function updateRentalApplicationStatus(formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  if (!mutationRateLimit(ctx.userId, 'update-rental-application').success) return Errors.RATE_LIMITED();

  const parsed = UpdateApplicationStatusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const updated = await setApplicationStatus(ctx.orgId, parsed.data.application_id, parsed.data.status);
  if (!updated) return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, `rental_application.${parsed.data.status}`, 'rental_application', parsed.data.application_id);
  revalidatePath('/dashboard/leads/applications');
  return ok(undefined);
}
