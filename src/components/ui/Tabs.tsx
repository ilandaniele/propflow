'use client';

import { useState, type ReactNode } from 'react';

export interface Tab {
  id: string;
  label: string;
  badge?: number;
  content: ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
  className?: string;
  /** Accessible label for the tab list. Defaults to "Content tabs". */
  ariaLabel?: string;
}

/**
 * Accessible tab component with keyboard navigation (ARIA tabs pattern).
 * All tabs are rendered but only the active one is visible (no SSR mismatch).
 * Touch targets meet Apple HIG minimum of 44px (min-h-[44px] + py-3).
 */
export function Tabs({ tabs, defaultTab, className = '', ariaLabel = 'Content tabs' }: TabsProps) {
  const [activeId, setActiveId] = useState(defaultTab ?? tabs[0]?.id ?? '');

  return (
    <div className={className}>
      {/* Tab list */}
      <div
        role="tablist"
        className="flex gap-0.5 border-b border-slate-200 overflow-x-auto scrollbar-none"
        aria-label={ariaLabel}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveId(tab.id)}
              style={{ touchAction: 'manipulation' }}
              onKeyDown={(e) => {
                const idx = tabs.findIndex((t) => t.id === activeId);
                if (e.key === 'ArrowRight') {
                  const next = tabs[(idx + 1) % tabs.length];
                  if (next) setActiveId(next.id);
                } else if (e.key === 'ArrowLeft') {
                  const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
                  if (prev) setActiveId(prev.id);
                }
              }}
              className={[
                'flex items-center gap-1.5 px-4 py-3 min-h-[44px] text-sm font-medium whitespace-nowrap',
                'border-b-2 -mb-px transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                isActive
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300',
              ].join(' ')}
            >
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className={[
                  'inline-flex items-center justify-center rounded-full text-xs font-medium min-w-[18px] h-[18px] px-1',
                  isActive ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600',
                ].join(' ')}>
                  {tab.badge > 99 ? '99+' : tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab panels */}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab.id}`}
          hidden={tab.id !== activeId}
          tabIndex={0}
          className="focus-visible:outline-none"
        >
          {tab.id === activeId ? tab.content : null}
        </div>
      ))}
    </div>
  );
}
