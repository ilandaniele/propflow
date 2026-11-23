import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createSmokeDb, seedOrg, seedProfile, type SmokeDb } from './setup';
import { closeMessage, insertTenantMessage, listInboxMessages, listSentMessages, replyToMessage } from '@/lib/messages/queries';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

async function seedScenario() {
  const org = await seedOrg(smoke.db);
  const admin = await seedProfile(smoke.db, org.id, { role: 'admin', email: `admin-${crypto.randomUUID()}@example.com` });
  const tenant = await seedProfile(smoke.db, org.id, { role: 'tenant', fullName: 'Resident One', email: `t-${crypto.randomUUID()}@example.com` });
  const neighbour = await seedProfile(smoke.db, org.id, { role: 'tenant', email: `n-${crypto.randomUUID()}@example.com` });
  const messageId = await insertTenantMessage({ orgId: org.id, senderId: tenant.id, kind: 'complaint', subject: 'Noise at night', body: 'Loud music after midnight.' });
  return { org, admin, tenant, neighbour, messageId };
}

describe('tenant messages (real SQL)', () => {
  it('shows a new message as open in the inbox with the sender name', async () => {
    const { org, messageId } = await seedScenario();
    const inbox = await listInboxMessages(org.id);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ id: messageId, status: 'open', kind: 'complaint', senderName: 'Resident One', reply: null });
    expect(await listInboxMessages(org.id, 'answered')).toEqual([]);
  });

  it('lists only the sender own messages in the portal', async () => {
    const { org, tenant, neighbour, messageId } = await seedScenario();
    expect((await listSentMessages(org.id, tenant.id)).map((m) => m.id)).toEqual([messageId]);
    expect(await listSentMessages(org.id, neighbour.id)).toEqual([]);
  });

  it('reply marks the message answered and is visible to the sender', async () => {
    const { org, admin, tenant, messageId } = await seedScenario();
    expect(await replyToMessage({ orgId: org.id, messageId, reply: 'We will talk to them.', repliedBy: admin.id })).toBe(true);
    const [sent] = await listSentMessages(org.id, tenant.id);
    expect(sent.status).toBe('answered');
    expect(sent.reply).toBe('We will talk to them.');
    expect(sent.repliedAt).toBeInstanceOf(Date);
  });

  it('close works once and filters by status', async () => {
    const { org, messageId } = await seedScenario();
    expect(await closeMessage(org.id, messageId)).toBe(true);
    expect(await closeMessage(org.id, messageId)).toBe(false);
    expect((await listInboxMessages(org.id, 'closed')).map((m) => m.id)).toEqual([messageId]);
  });

  it('scopes inbox, reply and close to the caller org', async () => {
    const { admin, messageId } = await seedScenario();
    const otherOrg = await seedOrg(smoke.db, { name: 'Other Org' });
    expect(await listInboxMessages(otherOrg.id)).toEqual([]);
    expect(await replyToMessage({ orgId: otherOrg.id, messageId, reply: 'Hijack', repliedBy: admin.id })).toBe(false);
    expect(await closeMessage(otherOrg.id, messageId)).toBe(false);
  });
});
