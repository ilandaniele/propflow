interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      className={[
        'animate-pulse rounded-md bg-slate-200',
        className,
      ].join(' ')}
    />
  );
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={['h-4', i === lines - 1 ? 'w-3/4' : 'w-full'].join(' ')}
        />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
      <SkeletonText lines={2} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkeletonLine — single shimmer line, useful as a row within custom layouts
// ---------------------------------------------------------------------------
export function SkeletonLine({ className }: { className?: string }) {
  return <Skeleton className={['h-4 w-full', className ?? ''].join(' ').trim()} />;
}

// ---------------------------------------------------------------------------
// SkeletonTable — mimics a data table: one header row + N body rows × M cols
// ---------------------------------------------------------------------------
export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading table"
      aria-busy="true"
      className="bg-white rounded-xl border border-slate-200 overflow-hidden"
    >
      {/* thead */}
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 flex gap-4">
        {Array.from({ length: cols }).map((_, c) => (
          <Skeleton key={c} className="h-3 flex-1 rounded" />
        ))}
      </div>
      {/* tbody rows */}
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="px-5 py-4 flex items-center gap-4">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton
                key={c}
                className={[
                  'h-4 rounded',
                  c === 0 ? 'w-1/4' : c === cols - 1 ? 'w-16 ml-auto' : 'flex-1',
                ].join(' ')}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkeletonCardGrid — N card-shaped skeletons in a responsive grid
// ---------------------------------------------------------------------------
export function SkeletonCardGrid({ cards = 6 }: { cards?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading cards"
      aria-busy="true"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
    >
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-6 w-14 rounded-full" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkeletonStats — N KPI stat-card skeletons in a 4-column grid
// ---------------------------------------------------------------------------
export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading statistics"
      aria-busy="true"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkeletonDetailCard — a single card skeleton for a detail/profile page
// ---------------------------------------------------------------------------
export function SkeletonDetailCard() {
  return (
    <div
      role="status"
      aria-label="Loading detail"
      aria-busy="true"
      className="bg-white rounded-xl border border-slate-200 p-6 space-y-6"
    >
      {/* Card header */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      {/* Field rows */}
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-4 w-28 shrink-0" />
            <Skeleton className={['h-4 rounded', i % 2 === 0 ? 'w-1/2' : 'w-1/3'].join(' ')} />
          </div>
        ))}
      </div>
    </div>
  );
}
