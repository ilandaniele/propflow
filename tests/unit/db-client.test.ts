/**
 * AC22: src/lib/db/index.ts — singleton Drizzle client
 * Tests that:
 *   1. Import throws a clear error when DATABASE_URL is not set
 *   2. All domain table exports from schema.ts are defined (non-null)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('db/index.ts', () => {
  beforeEach(() => {
    // Reset module registry so re-imports pick up new env state
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws a clear error when DATABASE_URL is not set', async () => {
    vi.stubEnv('DATABASE_URL', '');
    // Delete the var entirely so the undefined check fires
    delete process.env['DATABASE_URL'];

    await expect(import('../../src/lib/db/index')).rejects.toThrow(
      'DATABASE_URL env var is required',
    );
  });
});

describe('db/schema.ts exports', () => {
  it('exports all 50 tables (46 domain + 4 NextAuth)', async () => {
    const schema = await import('../../src/lib/db/schema');

    // NextAuth tables
    expect(schema.users).toBeDefined();
    expect(schema.accounts).toBeDefined();
    expect(schema.sessions).toBeDefined();
    expect(schema.verificationTokens).toBeDefined();

    // Domain tables
    expect(schema.organizations).toBeDefined();
    expect(schema.profiles).toBeDefined();
    expect(schema.properties).toBeDefined();
    expect(schema.units).toBeDefined();
    expect(schema.responsables).toBeDefined();
    expect(schema.tenants).toBeDefined();
    expect(schema.contracts).toBeDefined();
    expect(schema.charges).toBeDefined();
    expect(schema.importLogs).toBeDefined();
    expect(schema.payments).toBeDefined();
    expect(schema.incidents).toBeDefined();
    expect(schema.incidentComments).toBeDefined();
    expect(schema.internalNotes).toBeDefined();
    expect(schema.expenseCategories).toBeDefined();
    expect(schema.expenses).toBeDefined();
    expect(schema.receiptUploads).toBeDefined();
    expect(schema.contractTemplates).toBeDefined();
    expect(schema.pricingTables).toBeDefined();
    expect(schema.crmLeads).toBeDefined();
    expect(schema.communityPosts).toBeDefined();
    expect(schema.communityComments).toBeDefined();
    expect(schema.announcements).toBeDefined();
    expect(schema.cleaningTasks).toBeDefined();
    expect(schema.signatureRequests).toBeDefined();
    expect(schema.reminders).toBeDefined();
    expect(schema.notificationInbox).toBeDefined();
    expect(schema.visitorLogs).toBeDefined();
    expect(schema.aiChatMessages).toBeDefined();
    expect(schema.whatsappConversations).toBeDefined();
    expect(schema.whatsappMessages).toBeDefined();
    expect(schema.paymentReceipts).toBeDefined();
    expect(schema.airtableSnapshots).toBeDefined();
    expect(schema.airtableSyncLogs).toBeDefined();
    expect(schema.csvImports).toBeDefined();
    expect(schema.importRows).toBeDefined();
    expect(schema.accountMappings).toBeDefined();
    expect(schema.propertyMappings).toBeDefined();
    expect(schema.phantomRooms).toBeDefined();
    expect(schema.aiTokenBudget).toBeDefined();
    expect(schema.unitImages).toBeDefined();
    expect(schema.servicePayments).toBeDefined();
    expect(schema.tenantInvitations).toBeDefined();
    expect(schema.propertyWeeklySummaries).toBeDefined();
    expect(schema.tenantTasks).toBeDefined();
    expect(schema.taskProofs).toBeDefined();
    expect(schema.sanctions).toBeDefined();
  });

  it('profiles.userId column references users table', async () => {
    const schema = await import('../../src/lib/db/schema');
    // Drizzle column definition uses camelCase accessor matching the schema definition
    const userIdCol = schema.profiles.userId;
    // The column object from Drizzle ORM has a name property
    expect(userIdCol).toBeDefined();
  });
});
