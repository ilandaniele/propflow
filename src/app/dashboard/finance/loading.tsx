export default function Loading() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-7 w-20 bg-slate-200 rounded" />
        <div className="flex gap-4">
          <div className="h-4 w-24 bg-slate-200 rounded" />
          <div className="h-4 w-24 bg-slate-200 rounded" />
        </div>
      </div>
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="h-3 w-24 bg-slate-200 rounded" />
            <div className="h-8 w-28 bg-slate-200 rounded" />
          </div>
        ))}
      </div>
      {/* P&L table skeleton */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="h-5 w-28 bg-slate-200 rounded" />
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex justify-between py-2 border-b border-slate-50">
              <div className="h-3 w-20 bg-slate-200 rounded" />
              <div className="h-3 w-16 bg-slate-200 rounded" />
              <div className="h-3 w-16 bg-slate-200 rounded" />
              <div className="h-3 w-16 bg-slate-200 rounded" />
            </div>
          ))}
        </div>
      </div>
      {/* Cash flow skeleton */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="h-5 w-36 bg-slate-200 rounded" />
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-50">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 bg-slate-200 rounded-full" />
                <div className="h-3 w-20 bg-slate-200 rounded" />
                <div className="h-3 w-24 bg-slate-200 rounded" />
              </div>
              <div className="h-3 w-16 bg-slate-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
