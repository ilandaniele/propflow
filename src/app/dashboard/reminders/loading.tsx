export default function Loading() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-7 w-28 bg-slate-200 rounded" />
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 flex gap-6">
          {[32, 40, 36, 44, 32, 28].map((w, i) => (
            <div key={i} className="h-3 bg-slate-200 rounded" style={{ width: `${w * 4}px` }} />
          ))}
        </div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="border-b border-slate-100 px-5 py-4 flex items-center gap-4">
            <div className="h-4 w-24 bg-slate-200 rounded" />
            <div className="h-3 w-32 bg-slate-200 rounded" />
            <div className="h-3 w-20 bg-slate-200 rounded" />
            <div className="h-3 w-36 bg-slate-200 rounded" />
            <div className="h-6 w-20 bg-slate-200 rounded-full ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}
