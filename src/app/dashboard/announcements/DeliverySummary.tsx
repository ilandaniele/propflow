import { getTranslations } from 'next-intl/server';
import { DELIVERY_CHANNELS, type DeliveryCounts } from '@/lib/announcements/recipients';

const CHANNEL_LABEL = { email: 'deliveryEmail', whatsapp: 'deliveryWhatsapp' } as const;

export async function DeliverySummary({ announcementId, counts }: { announcementId: string; counts: DeliveryCounts }) {
  const t = await getTranslations('announcements');
  const channels = DELIVERY_CHANNELS.filter((channel) => counts[channel]);
  const hasPending = channels.some((channel) => counts[channel]!.pending > 0);

  return (
    <div className="mt-3 flex items-center gap-4 flex-wrap text-xs text-slate-600">
      {channels.map((channel) => (
        <span key={channel}>
          <span className="font-medium text-slate-800">{t(CHANNEL_LABEL[channel])}:</span>{' '}
          {t('deliveryCounts', counts[channel]!)}
        </span>
      ))}
      {hasPending && (
        <form action={async (formData) => {
          'use server';
          const { continueAnnouncementDelivery } = await import('@/app/actions/ops');
          await continueAnnouncementDelivery({}, formData);
        }}>
          <input type="hidden" name="id" value={announcementId} />
          <button type="submit" className="text-brand-600 hover:underline font-medium">
            {t('continueSending')}
          </button>
        </form>
      )}
    </div>
  );
}
