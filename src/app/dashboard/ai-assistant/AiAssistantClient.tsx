'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/Button';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

const QUICK_PROMPTS = [
  "What is my current occupancy rate?",
  "How many tenants are overdue?",
  "What is the net income this month?",
  "How many open incidents are there?",
];

function generateSessionId(): string {
  return crypto.randomUUID();
}

export function AiAssistantClient() {
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
    if (!messageText.trim() || isLoading) return;

    const userMsg: Message = { role: 'user', content: messageText.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    setError('');

    // Add streaming placeholder
    setMessages(prev => [...prev, { role: 'assistant', content: '', isStreaming: true }]);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, message: messageText.trim() }),
      });

      if (res.status === 429) {
        setMessages(prev => prev.filter(m => !m.isStreaming));
        setError('Daily message limit reached. Please try again tomorrow.');
        setIsLoading(false);
        return;
      }

      if (!res.ok || !res.body) {
        setMessages(prev => prev.filter(m => !m.isStreaming));
        setError('Failed to get a response. Please try again.');
        setIsLoading(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const accumulatedContent = { current: '' }; // use object to avoid react-compiler immutability constraint

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const parsed = JSON.parse(data) as any;
              if (parsed.text) {
                accumulatedContent.current += String(parsed.text);
                const snapshot = accumulatedContent.current;
                setMessages(prev =>
                  prev.map((m, i) =>
                    i === prev.length - 1 && m.isStreaming
                      ? { ...m, content: snapshot }
                      : m
                  )
                );
              }
            } catch { /* partial chunk */ }
          }
        }
      }

      // Finalize
      const finalContent = accumulatedContent.current;
      setMessages(prev =>
        prev.map((m, i) =>
          i === prev.length - 1 && m.isStreaming
            ? { role: 'assistant', content: finalContent, isStreaming: false }
            : m
        )
      );
    } catch {
      setMessages(prev => prev.filter(m => !m.isStreaming));
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="p-6 flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">AI Property Insights</h1>
          <p className="text-sm text-slate-500 mt-0.5">Ask questions about your portfolio KPIs and metrics.</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700 max-w-xs">
          Read-only insights — verify before acting. AI answers may not be perfectly accurate.
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto border border-slate-200 rounded-xl bg-slate-50 p-4 space-y-4 mb-4">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <p className="text-slate-400 text-sm">Ask a question about your portfolio</p>
            <div className="flex flex-wrap gap-2 justify-center mt-4">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => sendMessage(p)}
                  className="text-xs bg-white border border-slate-200 text-slate-600 px-3 py-1.5 rounded-full hover:bg-slate-100 transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                msg.role === 'user'
                  ? 'bg-brand-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-800'
              }`}
            >
              {/* Plain text rendering — no dangerouslySetInnerHTML (LLM02) */}
              <p className="whitespace-pre-wrap">{msg.content}</p>
              {msg.isStreaming && (
                <span className="inline-block w-1.5 h-3.5 bg-slate-400 ml-0.5 animate-pulse rounded-sm" aria-hidden="true" />
              )}
            </div>
          </div>
        ))}

        {error && (
          <p className="text-center text-sm text-red-600" role="alert">{error}</p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
          placeholder="Ask about occupancy, overdue payments, incidents…"
          disabled={isLoading}
          className="flex-1 border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
          aria-label="Chat message input"
        />
        <Button onClick={() => sendMessage(input)} disabled={isLoading || !input.trim()}>
          {isLoading ? '…' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
