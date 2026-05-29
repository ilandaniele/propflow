import { type ReactNode } from 'react';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'pending' | 'active';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-slate-100 text-slate-700 border-slate-200',
  success: 'bg-green-50 text-green-700 border-green-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  danger: 'bg-red-50 text-red-700 border-red-200',
  info: 'bg-blue-50 text-blue-700 border-blue-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  active: 'bg-green-50 text-green-700 border-green-200',
};

export function Badge({ variant = 'default', children, className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border',
        variantClasses[variant],
        className,
      ].join(' ')}
    >
      {children}
    </span>
  );
}

// Semantic status pills
export function StatusPill({ status }: { status: string }) {
  const config: Record<string, { variant: BadgeVariant; label: string }> = {
    active: { variant: 'success', label: 'Active' },
    expired: { variant: 'default', label: 'Expired' },
    terminated: { variant: 'danger', label: 'Terminated' },
    pending: { variant: 'pending', label: 'Pending' },
    approved: { variant: 'success', label: 'Approved' },
    in_progress: { variant: 'info', label: 'In Progress' },
    solved: { variant: 'success', label: 'Solved' },
    vacant: { variant: 'default', label: 'Vacant' },
    occupied: { variant: 'active', label: 'Occupied' },
  };

  const c = config[status] ?? { variant: 'default' as BadgeVariant, label: status };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

export function PriorityPill({ priority }: { priority: string }) {
  const config: Record<string, { variant: BadgeVariant; label: string }> = {
    low: { variant: 'default', label: 'Low' },
    medium: { variant: 'info', label: 'Medium' },
    high: { variant: 'warning', label: 'High' },
    urgent: { variant: 'danger', label: 'Urgent' },
  };

  const c = config[priority] ?? { variant: 'default' as BadgeVariant, label: priority };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}
