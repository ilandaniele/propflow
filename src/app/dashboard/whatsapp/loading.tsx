export default function Loading() {
  return (
    <div className="max-w-4xl space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-6 w-36 bg-slate-200 rounded" />
      </div>
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-4 w-36 bg-slate-200 rounded" />
                <div className="h-5 w-16 bg-slate-200 rounded-full" />
              </div>
              <div className="h-3 w-32 bg-slate-200 rounded" />
            </div>
            <div className="h-4 w-4 bg-slate-200 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
