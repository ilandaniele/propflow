import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createSmokeDb, seedOrg, seedProfile, type SmokeDb } from './setup';
import { closeMessage, findMessageAttachment, insertTenantMessage, listInboxMessages, listSentMessages, replyToMessage } from '@/lib/messages/queries';

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

  describe('attachments', () => {
    async function seedWithAttachment() {
      const scenario = await seedScenario();
      const attachmentKey = `${scenario.org.id}/tenant-messages/${crypto.randomUUID()}.pdf`;
      const messageId = await insertTenantMessage({
        orgId: scenario.org.id,
        senderId: scenario.tenant.id,
        kind: 'request',
        subject: 'Broken heater',
        body: 'See the attached invoice.',
        attachment: { key: attachmentKey, name: 'invoice.pdf', mime: 'application/pdf', size: 2048 },
      });
      return { ...scenario, messageId, attachmentKey };
    }

    it('stores the attachment and shows its metadata (not the key) to the admin inbox and the sender', async () => {
      const { org, tenant, messageId } = await seedWithAttachment();
      const inboxRow = (await listInboxMessages(org.id)).find((m) => m.id === messageId);
      expect(inboxRow).toMatchObject({ attachmentName: 'invoice.pdf', attachmentMime: 'application/pdf', attachmentSize: 2048 });
      expect(inboxRow).not.toHaveProperty('attachmentKey');
      const sentRow = (await listSentMessages(org.id, tenant.id)).find((m) => m.id === messageId);
      expect(sentRow).toMatchObject({ attachmentName: 'invoice.pdf' });
    });

    it('leaves attachment columns null when none is sent', async () => {
      const { org, messageId } = await seedScenario();
      const [row] = await listInboxMessages(org.id);
      expect(row).toMatchObject({ id: messageId, attachmentName: null, attachmentMime: null, attachmentSize: null });
      expect(await findMessageAttachment({ orgId: org.id, messageId })).toBeNull();
    });

    it('resolves the key for an admin of the same org and for the sending tenant', async () => {
      const { org, tenant, messageId, attachmentKey } = await seedWithAttachment();
      expect(await findMessageAttachment({ orgId: org.id, messageId })).toEqual({ key: attachmentKey, name: 'invoice.pdf', mime: 'application/pdf' });
      expect(await findMessageAttachment({ orgId: org.id, messageId, senderId: tenant.id })).toMatchObject({ key: attachmentKey });
    });

    it('returns not-found for another org admin', async () => {
      const { messageId } = await seedWithAttachment();
      const otherOrg = await seedOrg(smoke.db, { name: 'Other Org' });
      expect(await findMessageAttachment({ orgId: otherOrg.id, messageId })).toBeNull();
    });

    it('returns not-found for another tenant of the same org', async () => {
      const { org, neighbour, messageId } = await seedWithAttachment();
      expect(await findMessageAttachment({ orgId: org.id, messageId, senderId: neighbour.id })).toBeNull();
    });
  });
});
