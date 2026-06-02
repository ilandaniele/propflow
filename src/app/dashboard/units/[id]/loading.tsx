export default function Loading() {
  return (
    <div className="space-y-4 max-w-5xl animate-pulse">
      {/* Unit header */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-3">
            <div className="h-7 w-40 bg-slate-200 rounded" />
            <div className="h-4 w-52 bg-slate-200 rounded" />
          </div>
          <div className="h-6 w-20 bg-slate-200 rounded-full" />
        </div>
      </div>
      {/* Detail cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="h-3 w-24 bg-slate-200 rounded" />
            <div className="h-6 w-32 bg-slate-200 rounded" />
          </div>
        ))}
      </div>
      {/* Tenant section */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="h-5 w-32 bg-slate-200 rounded" />
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-slate-200 rounded-full" />
          <div className="space-y-2">
            <div className="h-4 w-36 bg-slate-200 rounded" />
            <div className="h-3 w-48 bg-slate-200 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}
