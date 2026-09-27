import type { ReactNode } from 'react';

export interface ChecklistItemData {
  key: string;
  ok: boolean;
  label: string;
  /** Condensed instruction — env var NAMES and flyctl command templates only, never values. Shown only while `ok` is false. */
  instruction?: string;
  /** Extra content shown regardless of `ok` (e.g. a live count, a warning). */
  extra?: ReactNode;
}

export interface ChecklistGroupProps {
  title: string;
  items: ChecklistItemData[];
  /** flyctl command template (var NAMES only, never values) — shown once, below the rows, only while at least one item in the group is unmet. */
  command?: string;
  /** Rendered below the checklist rows — e.g. the WhatsApp channel form or the templates table. */
  children?: ReactNode;
}

/** One checklist section (e.g. "WhatsApp (Meta)") — a title, a list of pass/fail rows, and optional embedded content. */
export function ChecklistGroup({ title, items, command, children }: ChecklistGroupProps) {
  const hasMissing = items.some((item) => !item.ok);
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-2 text-sm">
            <span
              className={item.ok ? 'text-green-600 font-bold shrink-0' : 'text-red-600 font-bold shrink-0'}
              aria-hidden="true"
            >
              {item.ok ? '✔' : '✖'}
            </span>
            <div>
              <p className={item.ok ? 'text-slate-700' : 'text-slate-900 font-medium'}>{item.label}</p>
              {!item.ok && item.instruction && (
                <p className="text-xs text-slate-500 mt-0.5">{item.instruction}</p>
              )}
              {item.extra}
            </div>
          </li>
        ))}
      </ul>
      {hasMissing && command && (
        <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 overflow-x-auto">
          {command}
        </pre>
      )}
      {children}
    </section>
  );
}
