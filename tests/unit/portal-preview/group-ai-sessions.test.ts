/**
 * Unit tests: src/lib/portal-preview/group-ai-sessions.ts
 *
 * Tests verify:
 *   AC10 — groupAISessions groups by session_id correctly
 *   AC10 — started_at = earliest message in session
 *   AC10 — message_count is accurate per session
 *   AC10 — last_user_preview = first 80 chars of last user message
 *   AC10 — sessions sorted by started_at DESC
 *   AC10 — capped at 10 sessions
 *   AC10 — empty input returns []
 *   IC5  — empty array behavior (null profileId short-circuit is in queries.test.ts)
 */

import { describe, it, expect } from 'vitest';
import { groupAISessions } from '@/lib/portal-preview/group-ai-sessions';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

interface Msg {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  profile_id?: string;
  org_id?: string;
}

function msg(
  id: string,
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  createdAt: string
): Msg {
  return { id, session_id: sessionId, role, content, created_at: createdAt };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('groupAISessions', () => {

  // ── Empty input ─────────────────────────────────────────────────────────────

  it('returns [] for empty messages array', () => {
    expect(groupAISessions([])).toEqual([]);
  });

  // ── Single session ───────────────────────────────────────────────────────────

  it('groups a single session correctly', () => {
    const messages = [
      msg('m1', 'sess-1', 'user', 'Hello', '2026-06-01T10:00:00Z'),
      msg('m2', 'sess-1', 'assistant', 'Hi!', '2026-06-01T10:01:00Z'),
    ];
    const result = groupAISessions(messages);
    expect(result).toHaveLength(1);
    expect(result[0].session_id).toBe('sess-1');
    expect(result[0].message_count).toBe(2);
  });

  it('sets started_at to earliest message in session', () => {
    const messages = [
      msg('m2', 'sess-1', 'assistant', 'Hi!', '2026-06-01T10:01:00Z'),
      msg('m1', 'sess-1', 'user', 'Hello', '2026-06-01T10:00:00Z'),  // earlier
    ];
    const result = groupAISessions(messages);
    expect(result[0].started_at).toBe('2026-06-01T10:00:00Z');
  });

  it('last_user_preview = content of last user message (chronologically)', () => {
    const messages = [
      msg('m1', 'sess-1', 'user', 'First question', '2026-06-01T10:00:00Z'),
      msg('m2', 'sess-1', 'assistant', 'Answer', '2026-06-01T10:01:00Z'),
      msg('m3', 'sess-1', 'user', 'Second question — this is the last user message', '2026-06-01T10:02:00Z'),
      msg('m4', 'sess-1', 'assistant', 'Answer 2', '2026-06-01T10:03:00Z'),
    ];
    const result = groupAISessions(messages);
    expect(result[0].last_user_preview).toBe('Second question — this is the last user message');
  });

  it('last_user_preview is empty string when session has no user messages', () => {
    const messages = [
      msg('m1', 'sess-1', 'assistant', 'Welcome!', '2026-06-01T10:00:00Z'),
    ];
    const result = groupAISessions(messages);
    expect(result[0].last_user_preview).toBe('');
  });

  it('truncates last_user_preview to 80 characters', () => {
    const longContent = 'A'.repeat(200);
    const messages = [
      msg('m1', 'sess-1', 'user', longContent, '2026-06-01T10:00:00Z'),
    ];
    const result = groupAISessions(messages);
    expect(result[0].last_user_preview).toHaveLength(80);
    expect(result[0].last_user_preview).toBe('A'.repeat(80));
  });

  it('does NOT truncate last_user_preview when content is ≤80 chars', () => {
    const content = 'Short message';
    const messages = [
      msg('m1', 'sess-1', 'user', content, '2026-06-01T10:00:00Z'),
    ];
    const result = groupAISessions(messages);
    expect(result[0].last_user_preview).toBe(content);
  });

  // ── Multiple sessions ────────────────────────────────────────────────────────

  it('groups 12 messages across 3 sessions correctly (AC10 core scenario)', () => {
    const sess1 = 'sess-aaaa';
    const sess2 = 'sess-bbbb';
    const sess3 = 'sess-cccc';

    const messages: Msg[] = [
      // Session 1 — 5 messages — started June 1
      msg('m01', sess1, 'user', 'Q1', '2026-06-01T10:00:00Z'),
      msg('m02', sess1, 'assistant', 'A1', '2026-06-01T10:01:00Z'),
      msg('m03', sess1, 'user', 'Q2', '2026-06-01T10:02:00Z'),
      msg('m04', sess1, 'assistant', 'A2', '2026-06-01T10:03:00Z'),
      msg('m05', sess1, 'user', 'Q3 last user msg', '2026-06-01T10:04:00Z'),
      // Session 2 — 4 messages — started June 2
      msg('m06', sess2, 'user', 'Hello session 2', '2026-06-02T09:00:00Z'),
      msg('m07', sess2, 'assistant', 'Response 2-1', '2026-06-02T09:01:00Z'),
      msg('m08', sess2, 'user', 'Follow-up 2', '2026-06-02T09:02:00Z'),
      msg('m09', sess2, 'assistant', 'Response 2-2', '2026-06-02T09:03:00Z'),
      // Session 3 — 3 messages — started June 3
      msg('m10', sess3, 'user', 'Only question', '2026-06-03T08:00:00Z'),
      msg('m11', sess3, 'assistant', 'Answer', '2026-06-03T08:01:00Z'),
      msg('m12', sess3, 'user', 'Thanks', '2026-06-03T08:02:00Z'),
    ];

    const result = groupAISessions(messages);

    expect(result).toHaveLength(3);

    // Sorted by started_at DESC: sess3 (June 3) > sess2 (June 2) > sess1 (June 1)
    expect(result[0].session_id).toBe(sess3);
    expect(result[0].message_count).toBe(3);
    expect(result[0].last_user_preview).toBe('Thanks');

    expect(result[1].session_id).toBe(sess2);
    expect(result[1].message_count).toBe(4);
    expect(result[1].last_user_preview).toBe('Follow-up 2');

    expect(result[2].session_id).toBe(sess1);
    expect(result[2].message_count).toBe(5);
    expect(result[2].last_user_preview).toBe('Q3 last user msg');
  });

  it('sorts sessions by started_at DESC (newest first)', () => {
    const messages = [
      msg('m1', 'sess-old', 'user', 'Old', '2026-05-01T10:00:00Z'),
      msg('m2', 'sess-new', 'user', 'New', '2026-06-01T10:00:00Z'),
      msg('m3', 'sess-mid', 'user', 'Mid', '2026-05-15T10:00:00Z'),
    ];
    const result = groupAISessions(messages);
    expect(result[0].session_id).toBe('sess-new');
    expect(result[1].session_id).toBe('sess-mid');
    expect(result[2].session_id).toBe('sess-old');
  });

  it('counts messages accurately per session', () => {
    const messages = [
      msg('m1', 'sess-a', 'user', 'msg', '2026-06-01T10:00:00Z'),
      msg('m2', 'sess-a', 'assistant', 'msg', '2026-06-01T10:01:00Z'),
      msg('m3', 'sess-a', 'user', 'msg', '2026-06-01T10:02:00Z'),
      msg('m4', 'sess-b', 'user', 'msg', '2026-06-02T10:00:00Z'),
    ];
    const result = groupAISessions(messages);
    const sessA = result.find(s => s.session_id === 'sess-a');
    const sessB = result.find(s => s.session_id === 'sess-b');
    expect(sessA?.message_count).toBe(3);
    expect(sessB?.message_count).toBe(1);
  });

  // ── SESSION_LIMIT cap (10) ───────────────────────────────────────────────────

  it('caps output at 10 sessions when there are more than 10', () => {
    // Create 15 sessions with 1 message each
    const messages = Array.from({ length: 15 }, (_, i) => {
      const sessionId = `sess-${String(i).padStart(2, '0')}`;
      const hour = String(i).padStart(2, '0');
      return msg(`m${i}`, sessionId, 'user', `Question ${i}`, `2026-06-01T${hour}:00:00Z`);
    });
    const result = groupAISessions(messages);
    expect(result.length).toBe(10);
  });

  it('capped sessions are the 10 NEWEST by started_at', () => {
    // Sessions 00–04 are old (May), sessions 05–14 are new (June)
    const messages = [
      ...Array.from({ length: 5 }, (_, i) =>
        msg(`old-m${i}`, `sess-old-${i}`, 'user', `Old ${i}`, `2026-05-01T0${i}:00:00Z`)
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        msg(`new-m${i}`, `sess-new-${i}`, 'user', `New ${i}`, `2026-06-01T${String(i).padStart(2, '0')}:00:00Z`)
      ),
    ];
    const result = groupAISessions(messages);
    expect(result.length).toBe(10);
    // All 10 returned sessions should be the "new" ones (June)
    for (const s of result) {
      expect(s.session_id).toMatch(/^sess-new-/);
    }
  });

  // ── started_at accuracy ──────────────────────────────────────────────────────

  it('started_at reflects the EARLIEST message in the session regardless of array order', () => {
    const messages = [
      msg('m3', 'sess-1', 'user', 'Third', '2026-06-01T10:02:00Z'),
      msg('m1', 'sess-1', 'user', 'First', '2026-06-01T09:00:00Z'),   // earliest
      msg('m2', 'sess-1', 'assistant', 'Second', '2026-06-01T09:30:00Z'),
    ];
    const result = groupAISessions(messages);
    expect(result[0].started_at).toBe('2026-06-01T09:00:00Z');
  });
});
