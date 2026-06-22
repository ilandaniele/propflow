/**
 * POST /api/cron/weekly-summary
 * Fly scheduled machine (replaces Vercel Cron) — send property weekly summary
 * to all org admin phones.
 *
 * Auth: Authorization: Bearer {CRON_SECRET} (constant-time compare — AC10).
 * Idempotency: UNIQUE(property_id, iso_week) on property_weekly_summaries.
 *
 * TODO(W6): buildWeeklySummary still uses SupabaseClient internally.
 * Replace after W6 migrates that lib function to Drizzle.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { organizations, properties, profiles, propertyWeeklySummaries } from '@/lib/db/schema';
import { eq, and, isNotNull } from 'drizzle-orm';
// TODO(W6): buildWeeklySummary still expects a SupabaseClient — remove once migrated.
import { buildWeeklySummary } from '@/lib/whatsapp/weekly-summary';
import { getWhatsAppProvider } from '@/lib/whatsapp';
import { log } from '@/lib/log';

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Constant-time secret comparison (AC10)
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
    const provider = getWhatsAppProvider();

    // Fetch all organizations — Drizzle (AC1)
    const orgs = await db.select({ id: organizations.id, name: organizations.name }).from(organizations);

    let orgsProcessed     = 0;
    let summariesInserted = 0;
    let messagesSent      = 0;
    let messagesFailed    = 0;

    for (const org of orgs) {
      orgsProcessed++;

      // Fetch properties for this org — Drizzle
      const orgProperties = await db
        .select({ id: properties.id, name: properties.name })
        .from(properties)
        .where(eq(properties.orgId, org.id));

      for (const property of orgProperties) {
        try {
          // TODO(W6): buildWeeklySummary needs Drizzle migration — still uses SupabaseClient.
          const summary = await buildWeeklySummary(org.id, property.id);

          // Attempt insert — UNIQUE(property_id, iso_week) prevents duplicate sends.
          // Insert BEFORE sends so idempotency row exists even if all sends fail.
          try {
            await db.insert(propertyWeeklySummaries).values({
              orgId:      org.id,
              propertyId: property.id,
              isoWeek:    summary.isoWeek,
              body:       summary.body,
            });
          } catch (insertErr: unknown) {
            // Drizzle throws on unique constraint violation (23505)
            const code = (insertErr as { code?: string })?.code;
            if (code === '23505') {
              // Duplicate — already sent this week; skip sends
              log.debug('[cron/weekly-summary] already sent this week', {
                orgId:      org.id,
                propertyId: property.id,
                isoWeek:    summary.isoWeek,
              });
              continue;
            }
            throw insertErr;
          }

          summariesInserted++;

          // Resolve all admin profiles with a whatsapp_phone for this org — Drizzle (AC1)
          const adminProfiles = await db
            .select({ id: profiles.id, whatsappPhone: profiles.phone })
            .from(profiles)
            .where(
              and(
                eq(profiles.orgId, org.id),
                eq(profiles.role, 'admin'),
                isNotNull(profiles.phone)
              )
            );

          const recipients = adminProfiles.filter(
            (p): p is { id: string; whatsappPhone: string } =>
              typeof p.whatsappPhone === 'string' && p.whatsappPhone.length > 0
          );

          if (recipients.length === 0) {
            log.warn('[cron/weekly-summary] org has no admin recipients', { orgId: org.id });
            continue;
          }

          // Fan-out: send once per admin; per-send failure is non-fatal
          for (const admin of recipients) {
            try {
              await provider.sendMessage(org.id, {
                to:   admin.whatsappPhone,
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
            }
          }
        } catch (e) {
          log.error('[cron/weekly-summary] property failed', {
            orgId:      org.id,
            propertyId: property.id,
            error:      e instanceof Error ? e.message : 'unknown',
          });
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
