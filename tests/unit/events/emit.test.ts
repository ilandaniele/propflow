import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emit, on, off, clearHandlers, handlerCount } from '@/lib/events/emit';

describe('EventBus - emit', () => {
  beforeEach(() => {
    clearHandlers();
  });

  it('calls all registered handlers for an event', async () => {
    const h1 = vi.fn().mockResolvedValue(undefined);
    const h2 = vi.fn().mockResolvedValue(undefined);

    on('task.expired', h1);
    on('task.expired', h2);

    emit('task.expired', { orgId: 'org-1', taskId: 't-1', tenantId: 'ten-1' });

    // Wait for fire-and-forget handlers
    await new Promise((r) => setTimeout(r, 50));

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('does not await handler completion (fire-and-forget)', () => {
    let handlerCompleted = false;
    on('task.expired', async () => {
      await new Promise((r) => setTimeout(r, 100));
      handlerCompleted = true;
    });

    const start = Date.now();
    emit('task.expired', { orgId: 'org-1', taskId: 't-2', tenantId: 'ten-1' });
    const elapsed = Date.now() - start;

    // emit() should return synchronously (well under 100ms handler delay)
    expect(elapsed).toBeLessThan(50);
    expect(handlerCompleted).toBe(false);
  });

  it('failure in one handler does not prevent other handlers from running', async () => {
    const h1 = vi.fn().mockRejectedValue(new Error('handler error'));
    const h2 = vi.fn().mockResolvedValue(undefined);

    on('task.expired', h1);
    on('task.expired', h2);

    emit('task.expired', { orgId: 'org-1', taskId: 't-3', tenantId: 'ten-1' });

    await new Promise((r) => setTimeout(r, 50));

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('deduplicates events with the same idempotency key within 60s', async () => {
    const h1 = vi.fn().mockResolvedValue(undefined);
    on('sanction.proposed', h1);

    const key = 'sanction.proposed:sanction-abc';
    emit('sanction.proposed', { orgId: 'org-1', sanctionId: 'sanction-abc', tenantId: 'ten-1', kind: 'monetary' }, key);
    emit('sanction.proposed', { orgId: 'org-1', sanctionId: 'sanction-abc', tenantId: 'ten-1', kind: 'monetary' }, key);

    await new Promise((r) => setTimeout(r, 50));

    // Handler should only be called once (second emit is deduplicated)
    expect(h1).toHaveBeenCalledOnce();
  });

  it('off() removes handler', async () => {
    const h1 = vi.fn().mockResolvedValue(undefined);
    on('task.expired', h1);
    off('task.expired', h1);

    expect(handlerCount('task.expired')).toBe(0);

    emit('task.expired', { orgId: 'org-1', taskId: 't-4', tenantId: 'ten-1' });
    await new Promise((r) => setTimeout(r, 50));

    expect(h1).not.toHaveBeenCalled();
  });
});
