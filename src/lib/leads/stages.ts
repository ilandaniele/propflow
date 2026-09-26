/**
 * lead_pipeline_stages read helpers. Every org gets its SYSTEM_STAGES rows
 * lazily, on first read, via ON CONFLICT DO NOTHING — a fresh org with zero
 * leads never gets rows it doesn't need, and a concurrent double-seed is
 * harmless.
 */

import { db } from '@/lib/db';
import { leadPipelineStages } from '@/lib/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { SYSTEM_STAGES, STAGE_KEY_RE, type Pipeline, type PipelineStage, type StageKind } from './types';

function toStage(row: typeof leadPipelineStages.$inferSelect): PipelineStage {
  return {
    id: row.id,
    orgId: row.orgId,
    pipeline: row.pipeline as Pipeline,
    key: row.key,
    label: row.label,
    position: row.position,
    kind: row.kind as StageKind,
    color: row.color,
    isSystem: row.isSystem,
    archived: row.archived,
  };
}

async function seedSystemStages(orgId: string, pipeline: Pipeline): Promise<void> {
  const defaults = SYSTEM_STAGES[pipeline];
  await db
    .insert(leadPipelineStages)
    .values(defaults.map((s, i) => ({
      orgId,
      pipeline,
      key: s.key,
      label: s.label,
      position: i,
      kind: s.kind,
      isSystem: true,
    })))
    .onConflictDoNothing({ target: [leadPipelineStages.orgId, leadPipelineStages.pipeline, leadPipelineStages.key] });
}

export async function getPipelineStages(
  orgId: string,
  pipeline: Pipeline,
  opts: { includeArchived?: boolean } = {},
): Promise<PipelineStage[]> {
  await seedSystemStages(orgId, pipeline);

  const rows = await db
    .select()
    .from(leadPipelineStages)
    .where(opts.includeArchived
      ? and(eq(leadPipelineStages.orgId, orgId), eq(leadPipelineStages.pipeline, pipeline))
      : and(eq(leadPipelineStages.orgId, orgId), eq(leadPipelineStages.pipeline, pipeline), eq(leadPipelineStages.archived, false)))
    .orderBy(asc(leadPipelineStages.position));

  return rows.map(toStage);
}

export async function getStage(orgId: string, pipeline: Pipeline, key: string): Promise<PipelineStage | null> {
  const rows = await db
    .select()
    .from(leadPipelineStages)
    .where(and(eq(leadPipelineStages.orgId, orgId), eq(leadPipelineStages.pipeline, pipeline), eq(leadPipelineStages.key, key)))
    .limit(1);

  return rows[0] ? toStage(rows[0]) : null;
}

const ACCENTS_RE = /[̀-ͯ]/g;

/**
 * Pure. Derives a stage key from a human label: strip accents, lowercase,
 * collapse everything non-[a-z0-9] into single underscores, cap at 40 chars,
 * and prefix 's_' if the result would otherwise not start with a letter
 * (STAGE_KEY_RE requires it).
 */
export function slugifyStageKey(label: string): string {
  let key = label
    .normalize('NFD')
    .replace(ACCENTS_RE, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

  if (!/^[a-z]/.test(key)) key = `s_${key}`.slice(0, 40);
  if (key.length < 2) key = `${key}_stage`.slice(0, 40);

  return STAGE_KEY_RE.test(key) ? key : 's_stage';
}
