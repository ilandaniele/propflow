/**
 * Turn cost estimation — used by run-turn.ts (persisted per agent_messages
 * row) and by the metrics dashboard's SQL fallback (COST_SQL_RATES, for
 * legacy rows with cost_usd = NULL). Rates are per-million-tokens (MTOK),
 * overridable via env; the defaults below are assumed and must be confirmed
 * by the owner against their actual Anthropic pricing (blueprint §2.5).
 */

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

function rateFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const RATE_IN_PER_MTOK = rateFromEnv('AGENT_PRICE_IN_PER_MTOK', 5);
const RATE_OUT_PER_MTOK = rateFromEnv('AGENT_PRICE_OUT_PER_MTOK', 25);
const RATE_CACHE_READ_PER_MTOK = rateFromEnv('AGENT_PRICE_CACHE_READ_PER_MTOK', 0.5);
const RATE_CACHE_WRITE_PER_MTOK = rateFromEnv('AGENT_PRICE_CACHE_WRITE_PER_MTOK', 6.25);

/** USD cost of one turn's token usage, at the configured per-MTOK rates. */
export function estimateCostUsd(u: TokenUsage): number {
  const cost =
    (u.input * RATE_IN_PER_MTOK) / 1_000_000 +
    (u.output * RATE_OUT_PER_MTOK) / 1_000_000 +
    ((u.cacheRead ?? 0) * RATE_CACHE_READ_PER_MTOK) / 1_000_000 +
    ((u.cacheWrite ?? 0) * RATE_CACHE_WRITE_PER_MTOK) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/**
 * Same rates, exposed for the metrics dashboard's SQL fallback — legacy
 * agent_messages rows written before the run-turn.ts cost fix have
 * cost_usd = NULL, so `getAgentMetrics` estimates them in SQL from
 * input_tokens/output_tokens (no cache breakdown was ever persisted for
 * those rows, so cache rates don't apply to the fallback).
 */
export const COST_SQL_RATES = {
  inPerMtok: RATE_IN_PER_MTOK,
  outPerMtok: RATE_OUT_PER_MTOK,
  cacheReadPerMtok: RATE_CACHE_READ_PER_MTOK,
  cacheWritePerMtok: RATE_CACHE_WRITE_PER_MTOK,
} as const;
