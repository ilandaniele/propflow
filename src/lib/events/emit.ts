/**
 * In-process event bus with LRU idempotency.
 * IC7: fire-and-forget — emit() does not await handler completion.
 * Each handler is independently testable, idempotent, and catches own errors.
 *
 * Idempotency: in-memory LRU keyed on (eventName + entityId), 60s TTL.
 * DB-level unique constraints are the source of truth for persistence.
 */

import { log } from '@/lib/log';
import type { EventName, EventPayload, EventHandler } from './types';

const IDEMPOTENCY_TTL_MS = 60_000;
const MAX_IDEMPOTENCY_ENTRIES = 1_000;

interface IdempotencyEntry {
  key: string;
  expiresAt: number;
}

// Simple LRU-style in-memory idempotency cache (per serverless instance)
const idempotencyCache = new Map<string, IdempotencyEntry>();

function isIdempotent(key: string): boolean {
  const entry = idempotencyCache.get(key);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    idempotencyCache.delete(key);
    return false;
  }
  return true;
}

function markIdempotent(key: string): void {
  // Evict oldest entry if at capacity
  if (idempotencyCache.size >= MAX_IDEMPOTENCY_ENTRIES) {
    const oldest = idempotencyCache.keys().next().value;
    if (oldest) idempotencyCache.delete(oldest);
  }
  idempotencyCache.set(key, {
    key,
    expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
  });
}

// ─── Handler registry ─────────────────────────────────────────────────────────

const handlers = new Map<EventName, Array<EventHandler>>();

export function on<T extends EventPayload>(
  eventName: EventName,
  handler: EventHandler<T>
): void {
  const existing = handlers.get(eventName) ?? [];
  existing.push(handler as EventHandler);
  handlers.set(eventName, existing);
}

export function off(eventName: EventName, handler: EventHandler): void {
  const existing = handlers.get(eventName) ?? [];
  handlers.set(eventName, existing.filter((h) => h !== handler));
}

/**
 * Emit an event fire-and-forget.
 * @param eventName  Event name
 * @param payload  Event payload (must include orgId)
 * @param idempotencyKey  Dedup key — typically `{eventName}:{entityId}`. Defaults to a UUID.
 */
export function emit<T extends EventPayload>(
  eventName: EventName,
  payload: T,
  idempotencyKey?: string
): void {
  const key = idempotencyKey ?? `${eventName}:${JSON.stringify(payload)}`;

  if (isIdempotent(key)) {
    log.debug('[events] idempotent skip', { eventName, key: key.slice(0, 40) });
    return;
  }

  markIdempotent(key);

  const eventHandlers = handlers.get(eventName) ?? [];
  if (eventHandlers.length === 0) return;

  // Fire all handlers in parallel — failures in one don't affect others
  void Promise.all(
    eventHandlers.map(async (handler) => {
      try {
        await handler(payload, key);
      } catch (e) {
        // Handler error never propagates to caller (fire-and-forget)
        log.error('[events] handler error', {
          eventName,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })
  );
}

/** Return count of registered handlers for a given event (for testing). */
export function handlerCount(eventName: EventName): number {
  return handlers.get(eventName)?.length ?? 0;
}

/** Clear all handlers (for testing only). */
export function clearHandlers(): void {
  handlers.clear();
}
