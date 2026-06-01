'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { sendWhatsappMessage } from '@/app/actions/whatsapp';
import type { ActionResult } from '@/lib/errors';

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50 transition-colors"
    >
      {pending ? 'Sending...' : 'Send'}
    </button>
  );
}

// Client component since it needs the form action for send
export default function ConversationPage() {
  const params = useParams();
  const conversationId = params.conversationId as string;
  const [state, action] = useActionState<ActionResult, FormData>(sendWhatsappMessage, {});

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/dashboard/whatsapp" className="text-sm text-brand-600 hover:text-brand-800">
          Back to Inbox
        </Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <p className="text-sm text-slate-500 mb-4">Messages are loaded dynamically. See the WhatsApp tab on tenant detail for message history.</p>

        {/* Send message form */}
        <form action={action} className="flex gap-2">
          <input type="hidden" name="conversation_id" value={conversationId} />
          <input
            name="body"
            type="text"
            placeholder="Type a message..."
            required
            className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <SendButton />
        </form>
        {state.error && (
          <p className="text-xs text-red-600 mt-2">{state.error.message}</p>
        )}
        {!state.error && state.data !== undefined && (
          <p className="text-xs text-green-600 mt-2">Message sent.</p>
        )}
      </div>
    </div>
  );
}
