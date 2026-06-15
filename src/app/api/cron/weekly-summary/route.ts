/**
 * POST /api/cron/weekly-summary
 * Sunday 8pm UTC cron — send property weekly summary to all org admin phones.
 *
 * Auth: Authorization: Bearer {CRON_SECRET} (constant-time compare).
 * Uses service-role Supabase client (bypasses RLS for cron context).
 *
 * Idempotency: UNIQUE(property_id, iso_week) on property_weekly_summaries.
 * Re-running during the same ISO week skips the insert (duplicate) and skips sends.
 *
 * Fan-out: for each org, resolves all profiles where
 *   role = 'admin' AND whatsapp_phone IS NOT NULL
 * and sends once per admin. Partial send failures are logged and tolerated —
 * the idempotency row is committed regardless (no retry storm next week).
 *
 * Recipient resolution: queries profiles table (role=admin, whatsapp_phone IS NOT NULL).
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getWhatsAppProvider } from '@/lib/whatsapp';
import { buildWeeklySummary } from '@/lib/whatsapp/weekly-summary';
import { log } from '@/lib/log';

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Constant-time secret comparison
  const authHeader = request.headers.get('authorization') ?? '';
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    log.warn('[cron/weekly-summary] CRON_SECRET not configured');
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Cron secret not configured' } },
      { status: 503 }
    );
  }

  const expected = Buffer.from(`Bearer ${cronSecret}`, 'utf8');
  const actual   = Buffer.from(authHeader, 'utf8');

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    log.warn('[cron/weekly-summary] unauthorized attempt');
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid secret' } },
      { status: 401 }
    );
  }

  try {
    const adminClient = createAdminClient();
    const provider    = getWhatsAppProvider();

    // Fetch all organizations
    const { data: orgs, error: orgsError } = await adminClient
      .from('organizations')
      .select('id, name');

    if (orgsError) {
      log.error('[cron/weekly-summary] orgs query failed', { error: orgsError.message });
      return NextResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Query failed' } },
        { status: 500 }
      );
    }

    let orgsProcessed    = 0;
    let summariesInserted = 0;
    let messagesSent     = 0;
    let messagesFailed   = 0;

    for (const org of orgs ?? []) {
      orgsProcessed++;

      const { data: properties } = await adminClient
        .from('properties')
        .select('id, name')
        .eq('org_id', org.id);

      for (const property of properties ?? []) {
        try {
          const summary = await buildWeeklySummary(org.id, property.id);

          // Attempt insert — UNIQUE(property_id, iso_week) prevents duplicate sends.
          // Insert BEFORE sends so idempotency row exists even if all sends fail.
          const { error: insertError } = await adminClient
            .from('property_weekly_summaries')
            .insert({
              org_id:      org.id,
              property_id: property.id,
              iso_week:    summary.isoWeek,
              body:        summary.body,
            });

          if (insertError) {
            if (insertError.code === '23505') {
              // Duplicate — already sent this week; skip sends
              log.debug('[cron/weekly-summary] already sent this week', {
                orgId:      org.id,
                propertyId: property.id,
                isoWeek:    summary.isoWeek,
              });
              continue;
            }
            throw new Error(`insert failed: ${insertError.message}`);
          }

          summariesInserted++;

          // Resolve all admin profiles with a whatsapp_phone for this org
          const { data: adminProfiles, error: profilesError } = await adminClient
            .from('profiles')
            .select('id, whatsapp_phone')
            .eq('org_id', org.id)
            .eq('role', 'admin')
            .not('whatsapp_phone', 'is', null);

          if (profilesError) {
            log.error('[cron/weekly-summary] profiles query failed', {
              orgId: org.id,
              error: profilesError.message,
            });
            // Continue processing other properties; summary row already committed
            continue;
          }

          const recipients = (adminProfiles ?? []).filter(
            (p): p is { id: string; whatsapp_phone: string } =>
              typeof p.whatsapp_phone === 'string' && p.whatsapp_phone.length > 0
          );

          if (recipients.length === 0) {
            log.warn('[cron/weekly-summary] org has no admin recipients', {
              orgId: org.id,
              // Never log whatsapp_phone values
            });
            continue;
          }

          // Fan-out: send once per admin; per-send failure is non-fatal
          for (const admin of recipients) {
            try {
              await provider.sendMessage(org.id, {
                to:   admin.whatsapp_phone,
                body: summary.body,
              });
              messagesSent++;
              log.info('[cron/weekly-summary] sent', {
                orgId:      org.id,
                propertyId: property.id,
                isoWeek:    summary.isoWeek,
                // Never log the phone number
              });
            } catch (sendErr) {
              messagesFailed++;
              log.error('[cron/weekly-summary] send failed for admin', {
                orgId:      org.id,
                propertyId: property.id,
                // Never log adminId or phone number (PII)
                error:      sendErr instanceof Error ? sendErr.message : 'unknown',
              });
              // Continue to next admin — partial failure is tolerated
            }
          }
        } catch (e) {
          log.error('[cron/weekly-summary] property failed', {
            orgId:      org.id,
            propertyId: property.id,
            error:      e instanceof Error ? e.message : 'unknown',
          });
          // Continue processing other properties
        }
      }
    }

    log.info('[cron/weekly-summary] run complete', {
      orgsProcessed,
      summariesInserted,
      messagesSent,
      messagesFailed,
    });

    return NextResponse.json({
      ok: true,
      orgsProcessed,
      summariesInserted,
      messagesSent,
      messagesFailed,
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    log.error('[cron/weekly-summary] exception', { error: msg });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Weekly summary failed' } },
      { status: 500 }
    );
  }
}
