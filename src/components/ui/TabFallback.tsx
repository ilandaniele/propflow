import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Loading skeleton shown inside a <Suspense> boundary while a tab's
 * async Server Component is still resolving its data fetch.
 *
 * Must be wrapped in a <div role="tabpanel"> by the caller (Tabs component)
 * or match the dimensions of the resolved tab content to prevent CLS.
 *
 * aria-label tells screen readers that content is loading.
 * role="status" announces the loading state without interrupting the flow.
 */
export function TabFallback() {
  return (
    <div
      role="status"
      aria-label="Loading tab content"
      className="p-4 space-y-4"
    >
      {/* Mimic a typical card header + a few rows */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
        <Skeleton className="h-5 w-40" />
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
      </div>
      {/* Second card skeleton */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  );
}
