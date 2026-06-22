/**
 * Portal preview isolation tests — Drizzle / app-layer.
 * Replaces Supabase RLS portal-preview tests.
 */

import { describe, it, expect } from 'vitest';
import { visitorLogs, notificationInbox, announcements } from '@/lib/db/schema';
import { getTableColumns } from 'drizzle-orm';

describe('Portal preview tables — schema audit (AC8)', () => {
  const tables = [
    { name: 'visitor_logs', table: visitorLogs },
    { name: 'notification_inbox', table: notificationInbox },
    { name: 'announcements', table: announcements },
  ];

  for (const { name, table } of tables) {
    it(`${name} has orgId column for app-layer isolation`, () => {
      const cols = getTableColumns(table);
      expect(Object.keys(cols)).toContain('orgId');
    });
  }
});
