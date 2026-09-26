import { getTranslations } from 'next-intl/server';

export interface TimelineMessageItem {
  type: 'message';
  id: string;
  createdAt: Date;
  direction: 'inbound' | 'outbound';
  senderKind: string | null;
  body: string | null;
  attachmentKind: string | null;
}

export interface TimelineEventItem {
  type: 'event';
  id: string;
  createdAt: Date;
  kind: string;
}

export type TimelineItem = TimelineMessageItem | TimelineEventItem;

function senderLabel(item: TimelineMessageItem, t: Awaited<ReturnType<typeof getTranslations>>): string {
  if (item.direction === 'inbound') return t('sender.contact');
  switch (item.senderKind) {
    case 'agent': return t('sender.agent');
    case 'system': return t('sender.system');
    case 'human':
    default:
      return t('sender.human');
  }
}

/** whatsapp_messages merged with agent_events by createdAt, labelled by sender. */
export async function EventTimeline({ items }: { items: TimelineItem[] }) {
  const t = await getTranslations('agentInbox');

  if (items.length === 0) {
    return <p className="text-sm text-slate-400">{t('noMessages')}</p>;
  }

  return (
    <div className="space-y-3 max-h-[32rem] overflow-y-auto">
      {items.map((item) => {
        if (item.type === 'event') {
          return (
            <div key={`event-${item.id}`} className="text-xs text-center text-slate-400 py-1">
              {t(`event.${item.kind}` as Parameters<typeof t>[0])} · {item.createdAt.toLocaleString()}
            </div>
          );
        }

        const isOutbound = item.direction === 'outbound';
        return (
          <div key={`msg-${item.id}`} className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
            <div
              className={[
                'max-w-md px-3 py-2 rounded-lg text-sm',
                isOutbound ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-900',
              ].join(' ')}
            >
              <p className={`text-xs font-medium mb-0.5 ${isOutbound ? 'text-brand-100' : 'text-slate-500'}`}>
                {senderLabel(item, t)}
              </p>
              <p className="whitespace-pre-wrap break-words">{item.body ?? `[${item.attachmentKind ?? 'attachment'}]`}</p>
              <p className={`text-xs mt-1 ${isOutbound ? 'text-brand-200' : 'text-slate-400'}`}>
                {item.createdAt.toLocaleString()}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
