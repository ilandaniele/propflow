import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import Link from 'next/link';

interface Message {
  id: string;
  direction: string;
  body: string | null;
  classification: string | null;
  status: string;
  created_at: string;
}

interface Conversation {
  id: string;
  external_phone: string;
}

interface WhatsAppTabProps {
  conversation: Conversation | null;
  messages: Message[];
}

export function WhatsAppTab({ conversation, messages }: WhatsAppTabProps) {
  if (!conversation) {
    return (
      <div className="p-4">
        <Card>
          <CardHeader><CardTitle>WhatsApp</CardTitle></CardHeader>
          <p className="text-sm text-slate-400">No WhatsApp conversation for this tenant yet.</p>
          <p className="text-xs text-slate-400 mt-1">Add a WhatsApp phone number to the tenant profile to start receiving messages.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center">
        <div className="text-sm text-slate-500">
          Conversation with <span className="font-medium text-slate-700">{conversation.external_phone.slice(0, 4)}****</span>
        </div>
        <Link
          href={`/dashboard/whatsapp/${conversation.id}`}
          className="text-xs text-brand-600 hover:text-brand-800 font-medium"
        >
          Open full conversation →
        </Link>
      </div>

      <Card>
        {messages.length === 0 ? (
          <p className="text-sm text-slate-400">No messages yet</p>
        ) : (
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={[
                  'max-w-xs px-3 py-2 rounded-lg text-sm',
                  m.direction === 'outbound'
                    ? 'bg-brand-600 text-white'
                    : 'bg-slate-100 text-slate-900',
                ].join(' ')}>
                  <p>{m.body ?? '(attachment)'}</p>
                  {m.classification && m.classification !== 'other' && (
                    <p className={`text-xs mt-1 ${m.direction === 'outbound' ? 'text-brand-200' : 'text-slate-400'}`}>
                      [{m.classification}]
                    </p>
                  )}
                  <p className={`text-xs mt-1 ${m.direction === 'outbound' ? 'text-brand-200' : 'text-slate-400'}`}>
                    {new Date(m.created_at).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
