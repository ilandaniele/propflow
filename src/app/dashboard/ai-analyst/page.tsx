/**
 * src/app/dashboard/ai-analyst/page.tsx
 *
 * AI Analyst page — AC15 + AC16.
 *
 * Top half: 6 suggested prompt chips that run deterministic TS functions (no LLM).
 * Bottom half: free-form chat that routes through /api/ai/chat (bounded context, no PII).
 *
 * Server Component — requireAdmin() guard, then renders Client components.
 */

import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { PromptChips } from '@/components/analyst/PromptChips';
import { AnalystChat } from '@/components/analyst/AnalystChat';

export const dynamic = 'force-dynamic';

export default async function AiAnalystPage() {
  try {
    await requireAdmin();
  } catch {
    redirect('/login');
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Analista IA</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Análisis determinísticos y preguntas libres sobre tu portfolio.
          </p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700 max-w-xs text-right">
          Los análisis de chips son cálculos determinísticos — sin IA generativa.
          El chat libre usa IA con contexto agregado (sin datos personales de inquilinos).
        </div>
      </div>

      {/* Section 1: Suggested prompt chips */}
      <section aria-labelledby="analyst-chips-heading">
        <h2
          id="analyst-chips-heading"
          className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3"
        >
          Análisis rápidos
        </h2>
        <PromptChips />
      </section>

      {/* Divider */}
      <hr className="border-slate-200" />

      {/* Section 2: Free-form chat */}
      <section aria-labelledby="analyst-chat-heading">
        <div className="mb-3">
          <h2
            id="analyst-chat-heading"
            className="text-sm font-semibold text-slate-700 uppercase tracking-wide"
          >
            Pregunta libre
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            El contexto enviado al modelo se limita a KPIs agregados del portfolio (máx. 8 KB).
            No se incluye ningún dato personal de inquilinos.
          </p>
        </div>
        <AnalystChat />
      </section>
    </div>
  );
}
