/**
 * Opt-in cold-lead listing alerts (Phase 6, item E, blueprint §6): when a
 * new listing is published, demand-pipeline leads that have gone quiet and
 * match the listing's basics get a one-shot WhatsApp nudge. Disabled by
 * default per org (`followupPolicy.listingAlerts.enabled`) — this is a
 * marketing message and needs explicit opt-in, per blueprint assumption 11.
 */

import { db } from '@/lib/db';
import { agentConfigs, agentSessions, crmLeads, leadListingAlerts, listings } from '@/lib/db/schema';
import { and, eq, gte, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import { log } from '@/lib/log';
import { sendVisitMessage } from '@/lib/agent/visits/messaging';
import { appendSystemOutboundToHistory } from '@/lib/agent/session';
import { getPipelineStages } from './stages';
import { parseFollowupPolicy, type FollowupPolicy } from './types';
import { localDateParts } from '@/lib/agent/visits/slots';

export interface LeadMatchInput {
  operationType: string | null;
  zones: string[];
  budgetMax: number | null;
  bedroomsMin: number | null;
  pets: boolean | null;
}

export interface ListingMatchInput {
  operation: 'rent' | 'sale';
  zone: string | null;
  price: number | null;
  bedrooms: number | null;
  petsAllowed: boolean | null;
}

function normalizeZone(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Pure. rent<->rent, buy<->sale (a null lead operationType matches any
 * listing operation). Empty `zones` matches any zone. Price must be within
 * 10% over budgetMax. Bedrooms must meet the minimum. `pets===true`
 * requires the listing to not explicitly disallow pets.
 */
export function matchesLead(l: LeadMatchInput, x: ListingMatchInput): boolean {
  if (l.operationType === 'rent' && x.operation !== 'rent') return false;
  if (l.operationType === 'buy' && x.operation !== 'sale') return false;
  if (l.operationType && l.operationType !== 'rent' && l.operationType !== 'buy') return false;

  if (l.zones.length > 0) {
    if (!x.zone) return false;
    const normalizedZones = l.zones.map(normalizeZone);
    if (!normalizedZones.includes(normalizeZone(x.zone))) return false;
  }

  if (l.budgetMax != null && x.price != null && x.price > l.budgetMax * 1.1) return false;

  if (l.bedroomsMin != null) {
    if (x.bedrooms == null || x.bedrooms < l.bedroomsMin) return false;
  }

  if (l.pets === true && x.petsAllowed === false) return false;

  return true;
}

interface OrgAlertConfig {
  orgId: string;
  timezone: string;
  policy: FollowupPolicy;
}

async function loadOptedInOrgs(): Promise<OrgAlertConfig[]> {
  const rows = await db.select().from(agentConfigs);
  const out: OrgAlertConfig[] = [];
  for (const row of rows) {
    if (row.shadowMode) continue;
    const channelsEnabled = (row.channelsEnabled as { whatsapp?: boolean } | null) ?? {};
    if (!channelsEnabled.whatsapp) continue;
    const policy = parseFollowupPolicy(row.followupPolicy);
    if (!policy.listingAlerts.enabled) continue;
    out.push({ orgId: row.orgId, timezone: row.timezone, policy });
  }
  return out;
}

function priceLabel(price: string | null, currency: string): string {
  if (price == null) return '';
  const n = Number(price);
  return `${currency} ${Number.isFinite(n) ? n.toLocaleString('es-PE') : price}`;
}

/**
 * Per org: finds recently-published listings, matches them against cold
 * demand-pipeline leads, and sends at most one alert per lead (the cheapest
 * match), claimed via `lead_listing_alerts` UNIQUE(lead_id, listing_id) so a
 * retried cron run never double-sends.
 */
export async function runListingAlertScan(now: Date = new Date()): Promise<{ orgs: number; sent: number; skipped: number; failed: number }> {
  const orgs = await loadOptedInOrgs();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const org of orgs) {
    try {
      const sentForOrg = await scanOrg(org, now);
      sent += sentForOrg.sent;
      skipped += sentForOrg.skipped;
    } catch (err) {
      failed++;
      log.error('[leads/listing-alerts] org scan failed', { orgId: org.orgId, err: (err as Error).message });
    }
  }

  return { orgs: orgs.length, sent, skipped, failed };
}

async function scanOrg(org: OrgAlertConfig, now: Date): Promise<{ sent: number; skipped: number }> {
  const { orgId, policy, timezone } = org;

  const minuteOfDay = localDateParts(now, timezone).minuteOfDay;
  if (minuteOfDay < policy.sendWindow.startMinute || minuteOfDay >= policy.sendWindow.endMinute) {
    return { sent: 0, skipped: 0 };
  }

  const publishedSince = new Date(now.getTime() - 26 * 60 * 60 * 1000);

  const recentListings = await db
    .select({
      id: listings.id,
      title: listings.title,
      operation: listings.operation,
      zone: listings.zone,
      price: listings.price,
      currency: listings.currency,
      bedrooms: listings.bedrooms,
      petsAllowed: listings.petsAllowed,
    })
    .from(listings)
    .where(and(
      eq(listings.orgId, orgId),
      eq(listings.published, true),
      eq(listings.status, 'available'),
      gte(listings.publishedAt, publishedSince),
    ));
  if (recentListings.length === 0) return { sent: 0, skipped: 0 };

  const openStages = (await getPipelineStages(orgId, 'demand')).filter((s) => s.kind === 'open').map((s) => s.key);
  if (openStages.length === 0) return { sent: 0, skipped: 0 };

  const coldCutoff = new Date(now.getTime() - policy.listingAlerts.coldAfterDays * 24 * 60 * 60 * 1000);
  const minDaysCutoff = new Date(now.getTime() - policy.listingAlerts.minDaysBetween * 24 * 60 * 60 * 1000);

  const candidates = await db
    .select({
      id: crmLeads.id,
      fullName: crmLeads.fullName,
      phone: crmLeads.phone,
      operationType: crmLeads.operationType,
      zones: crmLeads.zones,
      budgetMax: crmLeads.budgetMax,
      bedroomsMin: crmLeads.bedroomsMin,
      pets: crmLeads.pets,
      intentTag: crmLeads.intentTag,
      lastListingAlertAt: crmLeads.lastListingAlertAt,
    })
    .from(crmLeads)
    .where(and(
      eq(crmLeads.orgId, orgId),
      eq(crmLeads.pipeline, 'demand'),
      eq(crmLeads.doNotContact, false),
      inArray(crmLeads.stage, openStages),
      ne(crmLeads.followupState, 'active'),
      or(isNull(crmLeads.lastListingAlertAt), lt(crmLeads.lastListingAlertAt, minDaysCutoff)),
    ));

  let sent = 0;
  let skipped = 0;

  for (const lead of candidates) {
    if (sent >= policy.listingAlerts.maxPerOrgPerRun) break;
    if (!lead.phone) continue;

    const sessionRows = await db
      .select({ id: agentSessions.id, lastInboundAt: agentSessions.lastInboundAt })
      .from(agentSessions)
      .where(eq(agentSessions.leadId, lead.id))
      .limit(1);
    const session = sessionRows[0] ?? null;

    const isCold = lead.intentTag === 'cold' || (session?.lastInboundAt != null && session.lastInboundAt < coldCutoff);
    if (!isCold) continue;

    const leadInput: LeadMatchInput = {
      operationType: lead.operationType,
      zones: (lead.zones as string[]) ?? [],
      budgetMax: lead.budgetMax != null ? Number(lead.budgetMax) : null,
      bedroomsMin: lead.bedroomsMin,
      pets: lead.pets,
    };

    const matches = recentListings
      .filter((x) => matchesLead(leadInput, {
        operation: x.operation as 'rent' | 'sale',
        zone: x.zone,
        price: x.price != null ? Number(x.price) : null,
        bedrooms: x.bedrooms,
        petsAllowed: x.petsAllowed,
      }))
      .sort((a, b) => (a.price != null ? Number(a.price) : Infinity) - (b.price != null ? Number(b.price) : Infinity));
    if (matches.length === 0) continue;

    const listing = matches[0];

    const claimed = await db
      .insert(leadListingAlerts)
      .values({ orgId, leadId: lead.id, listingId: listing.id, status: 'sent' })
      .onConflictDoNothing({ target: [leadListingAlerts.leadId, leadListingAlerts.listingId] })
      .returning({ id: leadListingAlerts.id });
    if (claimed.length === 0) continue; // already alerted for this (lead, listing) pair

    const firstName = lead.fullName?.trim().split(/\s+/)[0] ?? '';
    const bodyText = `Hola ${firstName}, tenemos una nueva propiedad que podría interesarte: ${listing.title ?? 'Nueva propiedad'} (${priceLabel(listing.price, listing.currency)}).`;

    const result = await sendVisitMessage({
      orgId,
      phone: lead.phone,
      bodyText,
      template: { name: policy.listingAlerts.template, bodyParams: [firstName, listing.title ?? '', priceLabel(listing.price, listing.currency)] },
      meta: { kind: 'lead_listing_alert', leadId: lead.id, listingId: listing.id },
    });

    if (!result.success) {
      await db.update(leadListingAlerts).set({ status: 'failed', reason: result.error ?? 'send_failed' }).where(eq(leadListingAlerts.id, claimed[0].id));
      skipped++;
      continue;
    }

    await db.update(crmLeads).set({ lastListingAlertAt: now, updatedAt: now }).where(and(eq(crmLeads.id, lead.id), eq(crmLeads.orgId, orgId)));

    if (session) {
      await appendSystemOutboundToHistory({ orgId, sessionId: session.id, text: bodyText }).catch((err) => {
        log.warn('[leads/listing-alerts] appendSystemOutboundToHistory failed', { orgId, err: (err as Error).message });
      });
    }

    sent++;
  }

  return { sent, skipped };
}
