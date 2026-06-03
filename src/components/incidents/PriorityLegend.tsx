/**
 * PriorityLegend — static colour-coded legend for incident priority levels.
 * Displays low=green, medium=amber, high=red, urgent=purple.
 * Server Component — no client JS needed.
 */
interface LegendItem {
  priority: string;
  label: string;
  description: string;
  dotClass: string;
  pillClass: string;
}

const LEGEND_ITEMS: LegendItem[] = [
  {
    priority: 'low',
    label: 'Bajo',
    description: 'Seguimiento rutinario',
    dotClass: 'bg-green-500',
    pillClass: 'bg-green-50 text-green-700 border-green-200',
  },
  {
    priority: 'medium',
    label: 'Medio',
    description: 'Atender esta semana',
    dotClass: 'bg-amber-500',
    pillClass: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  {
    priority: 'high',
    label: 'Alto',
    description: 'Atender en 24–48 hs',
    dotClass: 'bg-red-500',
    pillClass: 'bg-red-50 text-red-700 border-red-200',
  },
  {
    priority: 'urgent',
    label: 'Urgente',
    description: 'Acción inmediata',
    dotClass: 'bg-purple-500',
    pillClass: 'bg-purple-50 text-purple-700 border-purple-200',
  },
];

interface PriorityLegendProps {
  className?: string;
}

export function PriorityLegend({ className = '' }: PriorityLegendProps) {
  return (
    <div
      className={['bg-white rounded-xl border border-slate-200 px-5 py-4', className].join(' ')}
      aria-label="Priority legend"
      role="note"
    >
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
        Prioridad
      </p>
      <div className="flex flex-wrap gap-3">
        {LEGEND_ITEMS.map(({ priority, label, description, dotClass, pillClass }) => (
          <div key={priority} className="flex items-center gap-2" data-priority={priority}>
            <span
              className={['inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border', pillClass].join(' ')}
              aria-label={`${label}: ${description}`}
            >
              <span className={['w-2 h-2 rounded-full flex-shrink-0', dotClass].join(' ')} aria-hidden="true" />
              {label}
            </span>
            <span className="text-xs text-slate-400 hidden sm:inline">{description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
