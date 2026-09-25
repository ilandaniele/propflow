/**
 * Shared types for the Phase 6 leads pipeline: stages, follow-up policy and
 * advisor routing. Every other Phase 6 item (B-H) depends only on this file
 * (plus src/lib/leads/stages.ts) — neither is owned by any other item.
 */

import { z } from 'zod';

export type Pipeline = 'demand' | 'supply';
export type StageKind = 'open' | 'won' | 'lost';

export interface PipelineStage {
  id: string;
  orgId: string;
  pipeline: Pipeline;
  key: string;
  label: string;
  position: number;
  kind: StageKind;
  color: string | null;
  isSystem: boolean;
  archived: boolean;
}

export const STAGE_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

/**
 * Seeded lazily per org by getPipelineStages() (src/lib/leads/stages.ts).
 * `demand` keys match the legacy crm_leads.stage enum from 0004 exactly, so
 * existing rows already satisfy the new format CHECK and land on the right
 * stage without a backfill.
 */
export const SYSTEM_STAGES: Record<Pipeline, ReadonlyArray<{ key: string; label: string; kind: StageKind }>> = {
  demand: [
    { key: 'new', label: 'Nuevo', kind: 'open' },
    { key: 'contacted', label: 'Contactado', kind: 'open' },
    { key: 'qualified', label: 'Calificado', kind: 'open' },
    { key: 'visit_scheduled', label: 'Visita agendada', kind: 'open' },
    { key: 'visited', label: 'Visitó', kind: 'open' },
    { key: 'negotiating', label: 'Negociación', kind: 'open' },
    { key: 'won', label: 'Cerrado', kind: 'won' },
    { key: 'lost', label: 'Perdido', kind: 'lost' },
  ],
  supply: [
    { key: 'new', label: 'Nuevo', kind: 'open' },
    { key: 'contacted', label: 'Contactado', kind: 'open' },
    { key: 'valuation', label: 'Tasación', kind: 'open' },
    { key: 'listing_agreement', label: 'Captación firmada', kind: 'open' },
    { key: 'published', label: 'Publicada', kind: 'open' },
    { key: 'won', label: 'Cerrado', kind: 'won' },
    { key: 'lost', label: 'Perdido', kind: 'lost' },
  ],
};

export const LEAD_JOB_KINDS = { followup: 'lead.followup' } as const;

export interface FollowupJobPayload {
  followupId: string;
}

export type FollowupStopReason =
  | 'replied'
  | 'human_takeover'
  | 'do_not_contact'
  | 'stage_closed'
  | 'visit_active'
  | 'window_closed'
  | 'superseded'
  | 'disabled'
  | 'no_phone'
  | 'no_session';

export interface FollowupPolicy {
  enabled: boolean;
  steps: Array<{ afterMinutes: number; kind: 'text' | 'template'; template?: string }>;
  sendWindow: { startMinute: number; endMinute: number };
  listingAlerts: {
    enabled: boolean;
    coldAfterDays: number;
    minDaysBetween: number;
    maxPerOrgPerRun: number;
    template: string;
  };
}

const DEFAULT_FOLLOWUP_POLICY: FollowupPolicy = {
  enabled: true,
  steps: [
    { afterMinutes: 120, kind: 'text' },
    { afterMinutes: 1440, kind: 'template', template: 'seguimiento_lead' },
    { afterMinutes: 4320, kind: 'template', template: 'reactivacion_lead' },
  ],
  sendWindow: { startMinute: 540, endMinute: 1200 }, // 09:00-20:00, org-local
  listingAlerts: {
    enabled: false,
    coldAfterDays: 7,
    minDaysBetween: 7,
    maxPerOrgPerRun: 200,
    template: 'propiedad_nueva',
  },
};

const FollowupStepSchema = z.object({
  afterMinutes: z.number().int().positive(),
  kind: z.enum(['text', 'template']),
  template: z.string().min(1).optional(),
});

export const FollowupPolicySchema: z.ZodType<FollowupPolicy> = z.object({
  enabled: z.boolean(),
  steps: z.array(FollowupStepSchema),
  sendWindow: z.object({ startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1440) }),
  listingAlerts: z.object({
    enabled: z.boolean(),
    coldAfterDays: z.number().int().positive(),
    minDaysBetween: z.number().int().positive(),
    maxPerOrgPerRun: z.number().int().positive(),
    template: z.string().min(1),
  }),
});

/**
 * Parses agent_configs.followup_policy (JSONB, default `{}`). Never throws —
 * an invalid/partial stored value falls back to defaults, merged shallowly
 * per top-level key so a partial override (e.g. only `{enabled:false}`)
 * doesn't wipe the rest.
 */
export function parseFollowupPolicy(raw: unknown): FollowupPolicy {
  const base = DEFAULT_FOLLOWUP_POLICY;
  if (raw == null || typeof raw !== 'object') return base;

  const r = raw as Partial<FollowupPolicy>;
  const merged: FollowupPolicy = {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : base.enabled,
    steps: Array.isArray(r.steps) && r.steps.length > 0 ? (r.steps as FollowupPolicy['steps']) : base.steps,
    sendWindow: {
      startMinute: r.sendWindow?.startMinute ?? base.sendWindow.startMinute,
      endMinute: r.sendWindow?.endMinute ?? base.sendWindow.endMinute,
    },
    listingAlerts: {
      enabled: r.listingAlerts?.enabled ?? base.listingAlerts.enabled,
      coldAfterDays: r.listingAlerts?.coldAfterDays ?? base.listingAlerts.coldAfterDays,
      minDaysBetween: r.listingAlerts?.minDaysBetween ?? base.listingAlerts.minDaysBetween,
      maxPerOrgPerRun: r.listingAlerts?.maxPerOrgPerRun ?? base.listingAlerts.maxPerOrgPerRun,
      template: r.listingAlerts?.template ?? base.listingAlerts.template,
    },
  };

  const parsed = FollowupPolicySchema.safeParse(merged);
  return parsed.success ? parsed.data : base;
}

export type RoutingMode = 'round_robin' | 'weighted' | 'manual';
export type AssignmentMethod = 'round_robin' | 'weighted' | 'manual' | 'visit' | 'reassign';

export interface RoutingMember {
  profileId: string;
  pipeline: Pipeline | 'both';
  weight: number;
  active: boolean;
  maxOpenLeads: number | null;
  assignedCount: number;
  lastAssignedAt: Date | null;
}
