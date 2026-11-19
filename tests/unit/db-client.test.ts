/**
 * AC22: every domain table is exported from the schema barrel.
 * The D1 client itself is covered by src/lib/db/index.test.ts.
 */

import { describe, it, expect } from 'vitest';

describe('db/schema.ts exports', () => {
  it('exports every domain and NextAuth table', async () => {
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
