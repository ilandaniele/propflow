/**
 * Fixture schema for the agent eval harness (master plan §"Verificación" —
 * Eval). Each fixture is a scripted, multi-turn conversation with a
 * prospect/tenant plus deterministic assertions run.ts checks against the
 * real transcript. This file has zero side effects (no DB, no Anthropic) so
 * tests/unit/agent-eval/fixtures.test.ts can import and validate it in CI.
 */

import { z } from 'zod/v4';

export const QUALIFICATION_FIELDS = ['operation', 'zone', 'budget', 'bedrooms', 'moveInDate', 'pets'] as const;
export type QualificationField = (typeof QUALIFICATION_FIELDS)[number];

export const EVAL_CATEGORIES = [
  'rent_search',
  'sale_search',
  'owner_listing',
  'pets',
  'price_on_request',
  'invented_property_attempt',
  'booking',
  'reschedule',
  'cancel',
  'complaint_handoff',
  'prompt_injection',
  'off_hours',
  'english_speaker',
  'voice_short_turns',
] as const;
export type EvalCategory = (typeof EVAL_CATEGORIES)[number];

export const SeedListingSchema = z.object({
  operation: z.enum(['rent', 'sale']),
  /** null models "a consultar" — no price loaded. */
  price: z.number().nonnegative().nullable(),
  currency: z.string().default('PEN'),
  title: z.string(),
  zone: z.string().optional(),
  bedrooms: z.number().int().nonnegative().optional(),
  bathrooms: z.number().int().nonnegative().optional(),
  areaM2: z.number().nonnegative().optional(),
  petsAllowed: z.boolean().optional(),
  maintenanceFee: z.number().nonnegative().optional(),
});
export type SeedListing = z.infer<typeof SeedListingSchema>;

export const EvalFixtureSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, 'id must be kebab-case'),
  title: z.string().min(1),
  /** Spanish variants from the three markets named in the plan, plus English and a voice-style shorthand. */
  locale: z.enum(['pe', 'co', 'ar', 'en']),
  channel: z.enum(['whatsapp', 'web', 'voice']),
  category: z.enum(EVAL_CATEGORIES),
  /** Sequential inbound messages from the same prospect/session, oldest first. */
  turns: z.array(z.string().min(1)).min(1),
  seed: z
    .object({
      listings: z.array(SeedListingSchema).default([]),
      /** Seeds one advisor with default availability (Mon-Fri 9-18) so get_available_slots/book_visit have real slots to offer. */
      advisor: z.boolean().default(false),
      /**
       * A decoy tenant row planted in the DB, never reachable by any agent
       * tool. If this string leaks into a reply, the agent crossed the
       * inventory/tenant-data wall (see prompt-injection fixtures).
       */
      decoyTenantName: z.string().optional(),
    })
    .default({ listings: [], advisor: false }),
  expect: z
    .object({
      /** Every price-shaped number (currency symbol/code + digits) in the replies must match a seeded listing price or maintenanceFee. */
      noInventedPrices: z.boolean().optional(),
      /** Substrings the reply text must show reasoning evidence of asking about (heuristic, case-insensitive). */
      requestsFields: z.array(z.enum(QUALIFICATION_FIELDS)).optional(),
      /** handoff_to_human must (or must not) fire across the conversation. */
      handoffCalled: z.boolean().optional(),
      /** Every 'sl_...' id used by book_visit/reschedule_visit must have been offered earlier by get_available_slots in the same session. */
      bookedSlotsSubsetOfOffered: z.boolean().optional(),
      /** When no price is seeded, "a consultar" (or equivalent) must appear instead of a fabricated number. */
      mustSayPriceOnRequest: z.boolean().optional(),
      /** The reply must never mention the decoy tenant name/data. */
      noTenantDataLeak: z.boolean().optional(),
      /** Replies must be in this language (rough heuristic — see assertions.ts). */
      replyLanguage: z.enum(['es', 'en']).optional(),
    })
    .default({}),
});
export type EvalFixture = z.infer<typeof EvalFixtureSchema>;

export function parseFixtures(raw: unknown[]): EvalFixture[] {
  return raw.map((f, i) => {
    const parsed = EvalFixtureSchema.safeParse(f);
    if (!parsed.success) {
      throw new Error(`[agent-eval/schema] fixture #${i} failed validation: ${parsed.error.message}`);
    }
    return parsed.data;
  });
}
