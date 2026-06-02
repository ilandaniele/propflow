export default function Loading() {
  return (
    <div className="space-y-6 max-w-4xl animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-28 bg-slate-200 rounded" />
          <div className="h-4 w-20 bg-slate-200 rounded" />
        </div>
        <div className="h-8 w-32 bg-slate-200 rounded-md" />
      </div>
      <div className="grid grid-cols-1 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-4 w-40 bg-slate-200 rounded" />
              <div className="h-3 w-64 bg-slate-200 rounded" />
            </div>
            <div className="h-7 w-24 bg-slate-200 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
