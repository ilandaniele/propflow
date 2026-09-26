import { describe, it, expect, vi, beforeEach } from 'vitest';

const { convRows, sendMessageMock, sendImageMock, insertMessageMock, updateActivityMock, getSessionMock, getWhatsAppProviderMock } = vi.hoisted(() => ({
  convRows: [] as unknown[],
  sendMessageMock: vi.fn(),
  sendImageMock: vi.fn(),
  insertMessageMock: vi.fn(),
  updateActivityMock: vi.fn(),
  getSessionMock: vi.fn(),
  getWhatsAppProviderMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => convRows) })),
      })),
    })),
  },
}));

vi.mock('@/lib/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/whatsapp', () => ({
  getWhatsAppProvider: getWhatsAppProviderMock,
}));

vi.mock('@/lib/whatsapp/db', () => ({
  insertMessage: insertMessageMock,
  updateConversationActivity: updateActivityMock,
}));

vi.mock('@/lib/agent/session', () => ({
  getSessionByConversation: getSessionMock,
  isWindowOpen: (session: { windowExpiresAt: Date | null }, now: Date = new Date()) =>
    session.windowExpiresAt != null && session.windowExpiresAt.getTime() > now.getTime(),
}));

import { sendWhatsAppText, sendWhatsAppImage } from '@/lib/agent/outbound';

describe('agent/outbound sendWhatsAppText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    convRows.length = 0;
    convRows.push({ id: 'conv-1', externalPhone: '+51999888777' });
    getWhatsAppProviderMock.mockReturnValue({ sendMessage: sendMessageMock, sendImage: sendImageMock });
  });

  it('returns NOT_FOUND when the conversation does not belong to the org', async () => {
    convRows.length = 0;
    const result = await sendWhatsAppText({ orgId: 'org-1', conversationId: 'conv-x', body: 'hola', senderKind: 'agent' });
    expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('window closed: no provider call, returns WINDOW_CLOSED', async () => {
    getSessionMock.mockResolvedValue({ windowExpiresAt: new Date(Date.now() - 1000) });

    const result = await sendWhatsAppText({ orgId: 'org-1', conversationId: 'conv-1', body: 'hola', senderKind: 'agent' });

    expect(result).toEqual({ ok: false, code: 'WINDOW_CLOSED' });
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(insertMessageMock).not.toHaveBeenCalled();
  });

  it('no linked agent session (tenant conversation): skips the window check entirely', async () => {
    getSessionMock.mockResolvedValue(null);
    sendMessageMock.mockResolvedValue({ success: true, providerMessageId: 'wamid-1' });
    insertMessageMock.mockResolvedValue('msg-1');

    const result = await sendWhatsAppText({ orgId: 'org-1', conversationId: 'conv-1', body: 'hola', senderKind: 'human' });

    expect(result).toEqual({ ok: true, messageId: 'msg-1' });
    expect(sendMessageMock).toHaveBeenCalledOnce();
  });

  it('success: calls the provider, persists sender_kind, and updates conversation activity', async () => {
    getSessionMock.mockResolvedValue({ windowExpiresAt: new Date(Date.now() + 60_000) });
    sendMessageMock.mockResolvedValue({ success: true, providerMessageId: 'wamid-2' });
    insertMessageMock.mockResolvedValue('msg-2');

    const result = await sendWhatsAppText({
      orgId: 'org-1',
      conversationId: 'conv-1',
      body: 'Hola, ¿en qué te ayudo?',
      senderKind: 'human',
      sentByProfileId: 'profile-9',
    });

    expect(result).toEqual({ ok: true, messageId: 'msg-2' });
    expect(insertMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      senderKind: 'human',
      sentByProfileId: 'profile-9',
      status: 'sent',
    }));
    expect(updateActivityMock).toHaveBeenCalledWith('conv-1', false);
  });

  it('provider failure: still persists the message (status failed), returns PROVIDER_ERROR', async () => {
    getSessionMock.mockResolvedValue({ windowExpiresAt: new Date(Date.now() + 60_000) });
    sendMessageMock.mockResolvedValue({ success: false, error: 'boom' });
    insertMessageMock.mockResolvedValue('msg-3');

    const result = await sendWhatsAppText({ orgId: 'org-1', conversationId: 'conv-1', body: 'hola', senderKind: 'agent' });

    expect(result).toEqual({ ok: false, code: 'PROVIDER_ERROR', error: 'boom' });
    expect(insertMessageMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('enforceWindow: false skips the window check even with a linked session', async () => {
    getSessionMock.mockResolvedValue({ windowExpiresAt: new Date(Date.now() - 60_000) });
    sendMessageMock.mockResolvedValue({ success: true, providerMessageId: 'wamid-4' });
    insertMessageMock.mockResolvedValue('msg-4');

    const result = await sendWhatsAppText({
      orgId: 'org-1',
      conversationId: 'conv-1',
      body: 'plantilla',
      senderKind: 'system',
      enforceWindow: false,
    });

    expect(result).toEqual({ ok: true, messageId: 'msg-4' });
    expect(getSessionMock).not.toHaveBeenCalled();
  });
});

describe('agent/outbound sendWhatsAppImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    convRows.length = 0;
    convRows.push({ id: 'conv-1', externalPhone: '+51999888777' });
    getWhatsAppProviderMock.mockReturnValue({ sendMessage: sendMessageMock, sendImage: sendImageMock });
  });

  it('returns NOT_FOUND when the conversation does not belong to the org', async () => {
    convRows.length = 0;
    const result = await sendWhatsAppImage({ orgId: 'org-1', conversationId: 'conv-x', imageUrl: 'https://signed.example/x.jpg', senderKind: 'agent' });
    expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(sendImageMock).not.toHaveBeenCalled();
  });

  it('window closed: no provider call, returns WINDOW_CLOSED', async () => {
    getSessionMock.mockResolvedValue({ windowExpiresAt: new Date(Date.now() - 1000) });
    const result = await sendWhatsAppImage({ orgId: 'org-1', conversationId: 'conv-1', imageUrl: 'https://signed.example/x.jpg', senderKind: 'agent' });
    expect(result).toEqual({ ok: false, code: 'WINDOW_CLOSED' });
    expect(sendImageMock).not.toHaveBeenCalled();
  });

  it('success: sends the signed URL to the provider, but never persists it — body is the caption only', async () => {
    getSessionMock.mockResolvedValue({ windowExpiresAt: new Date(Date.now() + 60_000) });
    sendImageMock.mockResolvedValue({ success: true, providerMessageId: 'wamid-9' });
    insertMessageMock.mockResolvedValue('msg-9');

    const result = await sendWhatsAppImage({
      orgId: 'org-1',
      conversationId: 'conv-1',
      imageUrl: 'https://signed.example/secret-path.jpg',
      caption: 'Depa Sol · PEN 1500',
      senderKind: 'agent',
      meta: { kind: 'listing_photos', listingId: 'l1' },
    });

    expect(result).toEqual({ ok: true, messageId: 'msg-9' });
    expect(sendImageMock).toHaveBeenCalledWith('org-1', expect.objectContaining({ imageUrl: 'https://signed.example/secret-path.jpg' }));
    expect(insertMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      attachmentKind: 'image',
      body: 'Depa Sol · PEN 1500',
      meta: { kind: 'listing_photos', listingId: 'l1' },
    }));
    const insertedArgs = insertMessageMock.mock.calls[0][0];
    expect(JSON.stringify(insertedArgs)).not.toContain('secret-path.jpg');
  });

  it('missing provider.sendImage capability returns PROVIDER_ERROR without throwing', async () => {
    getSessionMock.mockResolvedValue(null);
    getWhatsAppProviderMock.mockReturnValue({ sendMessage: sendMessageMock }); // no sendImage — e.g. MockWhatsAppProvider gap
    const result = await sendWhatsAppImage({ orgId: 'org-1', conversationId: 'conv-1', imageUrl: 'https://signed.example/x.jpg', senderKind: 'agent' });
    expect(result).toEqual({ ok: false, code: 'PROVIDER_ERROR', error: 'sendImage not supported' });
    expect(insertMessageMock).not.toHaveBeenCalled();
  });

  it('provider failure: still persists status failed, returns PROVIDER_ERROR', async () => {
    getSessionMock.mockResolvedValue({ windowExpiresAt: new Date(Date.now() + 60_000) });
    sendImageMock.mockResolvedValue({ success: false, error: 'boom' });
    insertMessageMock.mockResolvedValue('msg-10');

    const result = await sendWhatsAppImage({ orgId: 'org-1', conversationId: 'conv-1', imageUrl: 'https://signed.example/x.jpg', senderKind: 'agent' });

    expect(result).toEqual({ ok: false, code: 'PROVIDER_ERROR', error: 'boom' });
    expect(insertMessageMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });
});
