'use client';

import { useEffect, useRef } from 'react';
import { markConversationRead } from '@/app/actions/whatsapp';

/** Fires markConversationRead once when the conversation page is opened. Renders nothing. */
export function MarkReadOnView({ conversationId }: { conversationId: string }) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;

    const formData = new FormData();
    formData.set('conversation_id', conversationId);
    void markConversationRead({}, formData);
  }, [conversationId]);

  return null;
}
