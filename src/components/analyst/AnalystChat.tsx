'use client';

/**
 * src/components/analyst/AnalystChat.tsx
 *
 * Free-form analyst chat — AC16.
 *
 * Routes user questions to POST /api/ai/chat.
 * The server builds org-scoped aggregate context (<= 8 KB) and calls Anthropic.
 * No per-tenant PII is included in the prompt (enforced server-side via buildOrgContext).
 *
 * Rendering: plain-text whitespace-preserved paragraphs — no dangerouslySetInnerHTML (LLM02).
 */

import { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

function generateSessionId(): string {
  return `analyst-${crypto.randomUUID()}`;
}

export function AnalystChat() {
  const [sessionId] = useState(() => generateSessionId());
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(messageText: string) {
    const trimmed = messageText.trim();
    if (!trimmed || isLoading) return;

    const userMsg: Message = { role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    setError('');

    // Add streaming placeholder
    setMessages((prev) => [...prev, { role: 'assistant', content: '', isStreaming: true }]);

    try {
      // AC16: POST /api/ai/chat — server enforces <= 8 KB context + no PII
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, message: trimmed }),
      });

      if (res.status === 429) {
        setMessages((prev) => prev.filter((m) => !m.isStreaming));
        setError('Límite de mensajes alcanzado. Inténtalo mañana.');
        setIsLoading(false);
        return;
      }

      if (!res.ok || !res.body) {
        setMessages((prev) => prev.filter((m) => !m.isStreaming));
        setError('No se pudo obtener respuesta. Inténtalo de nuevo.');
        setIsLoading(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const accumulated = { current: '' };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') break;
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const parsed = JSON.parse(data) as any;
            if (parsed.text) {
              accumulated.current += String(parsed.text);
              const snapshot = accumulated.current;
              setMessages((prev) =>
                prev.map((m, i) =>
                  i === prev.length - 1 && m.isStreaming
                    ? { ...m, content: snapshot }
                    : m,
                ),
              );
            }
          } catch {
            /* partial chunk — ignore */
          }
        }
      }

      // Finalize streaming message
      const finalContent = accumulated.current;
      setMessages((prev) =>
        prev.map((m, i) =>
          i === prev.length - 1 && m.isStreaming
            ? { role: 'assistant', content: finalContent, isStreaming: false }
            : m,
        ),
      );
    } catch {
      setMessages((prev) => prev.filter((m) => !m.isStreaming));
      setError('Ocurrió un error. Inténtalo de nuevo.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-96">
      {/* Chat area */}
      <div className="flex-1 overflow-y-auto border border-slate-200 rounded-xl bg-slate-50 p-4 space-y-3 mb-3">
        {messages.length === 0 && (
          <div className="text-center py-6">
            <p className="text-slate-400 text-sm">
              Haz una pregunta libre sobre tu portfolio. El contexto se limita a KPIs agregados.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={[
                'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm',
                msg.role === 'user'
                  ? 'bg-brand-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-800',
              ].join(' ')}
            >
              {/* Plain text — no dangerouslySetInnerHTML (LLM02) */}
              <p className="whitespace-pre-wrap">{msg.content}</p>
              {msg.isStreaming && (
                <span
                  className="inline-block w-1.5 h-3.5 bg-slate-400 ml-0.5 animate-pulse rounded-sm"
                  aria-hidden="true"
                />
              )}
            </div>
          </div>
        ))}

        {error && (
          <p className="text-center text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage(input);
            }
          }}
          placeholder="Pregunta sobre ingresos, gastos, ocupación…"
          disabled={isLoading}
          className="flex-1 border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
          aria-label="Mensaje para el analista IA"
        />
        <button
          type="button"
          onClick={() => sendMessage(input)}
          disabled={isLoading || !input.trim()}
          className="px-4 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? '…' : 'Enviar'}
        </button>
      </div>
    </div>
  );
}
