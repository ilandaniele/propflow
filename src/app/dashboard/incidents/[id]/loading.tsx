export default function Loading() {
  return (
    <div className="space-y-4 max-w-5xl animate-pulse">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2 flex-1">
            <div className="flex gap-2">
              <div className="h-5 w-16 bg-slate-200 rounded-full" />
              <div className="h-5 w-20 bg-slate-200 rounded-full" />
            </div>
            <div className="h-6 w-72 bg-slate-200 rounded" />
            <div className="h-4 w-48 bg-slate-200 rounded" />
          </div>
          <div className="h-7 w-24 bg-slate-200 rounded-md" />
        </div>
        <div className="space-y-1.5">
          <div className="h-3 w-full bg-slate-200 rounded" />
          <div className="h-3 w-4/5 bg-slate-200 rounded" />
          <div className="h-3 w-3/5 bg-slate-200 rounded" />
        </div>
      </div>
      {/* Actions / comments section */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="h-5 w-24 bg-slate-200 rounded" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="h-8 w-8 bg-slate-200 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-24 bg-slate-200 rounded" />
              <div className="h-12 bg-slate-100 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
