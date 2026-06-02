export default function Loading() {
  return (
    <div className="space-y-6 max-w-5xl animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-40 bg-slate-200 rounded" />
          <div className="h-4 w-16 bg-slate-200 rounded" />
        </div>
        <div className="h-8 w-36 bg-slate-200 rounded-md" />
      </div>
      <div className="grid grid-cols-1 gap-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-xl p-5 flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-5 w-48 bg-slate-200 rounded" />
              <div className="h-3 w-32 bg-slate-200 rounded" />
            </div>
            <div className="h-7 w-20 bg-slate-200 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
