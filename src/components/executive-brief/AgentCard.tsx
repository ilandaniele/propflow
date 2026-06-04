'use client';

/**
 * AgentCard — individual AI agent card (AC14).
 *
 * For status='available' → clicking "Ejecutar" calls onRun().
 * For status='coming_soon' → clicking opens the AgentModal "Coming soon" dialog.
 */

import { useState } from 'react';
import { AgentModal } from './AgentModal';

export interface AgentCardProps {
  /** Unique identifier for data-testid attributes */
  id: string;
  /** Display title of the agent */
  title: string;
  /** One-line description */
  description: string;
  /** Icon element rendered in the card header */
  icon: React.ReactNode;
  /** 'available' → Run button wired; 'coming_soon' → opens Coming soon modal */
  status: 'available' | 'coming_soon';
  /** Called when Run is clicked on an available agent */
  onRun?: () => void;
  /** Whether the agent is currently running (shows loading state) */
  isRunning?: boolean;
}

export function AgentCard({
  id,
  title,
  description,
  icon,
  status,
  onRun,
  isRunning = false,
}: AgentCardProps) {
  const [modalOpen, setModalOpen] = useState(false);

  function handleCta() {
    if (status === 'coming_soon') {
      setModalOpen(true);
    } else if (onRun) {
      onRun();
    }
  }

  return (
    <>
      <article
        data-testid={`agent-card-${id}`}
        className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col gap-4 hover:shadow-md transition-shadow"
      >
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-lg bg-brand-50 text-brand-600 shrink-0">
            {icon}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 leading-snug">{title}</h3>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{description}</p>
          </div>
        </div>

        {/* Status badge */}
        {status === 'coming_soon' ? (
          <span className="self-start text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">
            Próximamente
          </span>
        ) : (
          <span className="self-start text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5">
            Disponible
          </span>
        )}

        {/* CTA button */}
        <button
          type="button"
          onClick={handleCta}
          disabled={isRunning}
          data-testid={status === 'available' ? `run-btn-${id}` : `coming-soon-btn-${id}`}
          className={[
            'mt-auto w-full py-2 px-4 rounded-lg text-sm font-medium transition-colors',
            isRunning
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
              : status === 'available'
              ? 'bg-brand-600 text-white hover:bg-brand-700'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
          ].join(' ')}
          aria-label={status === 'available' ? `Ejecutar ${title}` : `Ver detalles de ${title}`}
        >
          {isRunning ? 'Ejecutando...' : status === 'available' ? 'Ejecutar' : 'Ver detalles'}
        </button>
      </article>

      {/* Coming soon modal — only rendered when needed */}
      {status === 'coming_soon' && (
        <AgentModal
          open={modalOpen}
          agentName={title}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}
