export const DELIVERY_CHANNELS = ['email', 'whatsapp'] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];
export type DeliveryStatus = 'pending' | 'sent' | 'failed';

export interface RecipientRow {
  tenantId: string;
  email: string | null;
  whatsappPhone: string | null;
  whatsappOptIn: boolean;
  /** null when the tenant has no preferences row (every category on by default). */
  announcementsEmail: boolean | null;
}

export interface PlannedDelivery {
  tenantId: string;
  channel: DeliveryChannel;
}

function reachable(row: RecipientRow, channel: DeliveryChannel): boolean {
  if (channel === 'email') return Boolean(row.email) && row.announcementsEmail !== false;
  return Boolean(row.whatsappPhone) && row.whatsappOptIn;
}

/** One delivery per tenant and requested channel the tenant can and agreed to receive. */
export function planDeliveries(rows: readonly RecipientRow[], channels: readonly DeliveryChannel[]): PlannedDelivery[] {
  const seen = new Set<string>();
  const planned: PlannedDelivery[] = [];
  for (const row of rows) {
    if (seen.has(row.tenantId)) continue;
    seen.add(row.tenantId);
    for (const channel of channels) {
      if (reachable(row, channel)) planned.push({ tenantId: row.tenantId, channel });
    }
  }
  return planned;
}

/** Meta rejects template params with newlines, tabs or 4+ consecutive spaces. */
export function toTemplateParam(text: string, maxLength: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength - 1).trimEnd()}…` : flat;
}

export type ChannelCounts = Record<DeliveryStatus, number>;
export type DeliveryCounts = Partial<Record<DeliveryChannel, ChannelCounts>>;

export function tallyDeliveries(
  rows: readonly { announcementId: string; channel: string; status: string; total: number }[],
): Map<string, DeliveryCounts> {
  const byAnnouncement = new Map<string, DeliveryCounts>();
  for (const row of rows) {
    const counts = byAnnouncement.get(row.announcementId) ?? {};
    const channel = row.channel as DeliveryChannel;
    const channelCounts = counts[channel] ?? { pending: 0, sent: 0, failed: 0 };
    channelCounts[row.status as DeliveryStatus] += row.total;
    counts[channel] = channelCounts;
    byAnnouncement.set(row.announcementId, counts);
  }
  return byAnnouncement;
}
