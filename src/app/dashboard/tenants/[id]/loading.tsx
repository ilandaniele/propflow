export default function Loading() {
  return (
    <div className="space-y-4 max-w-5xl animate-pulse">
      {/* Profile header */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="h-16 w-16 bg-slate-200 rounded-full shrink-0" />
          <div className="flex-1 space-y-3">
            <div className="h-6 w-48 bg-slate-200 rounded" />
            <div className="h-4 w-36 bg-slate-200 rounded" />
            <div className="h-3 w-56 bg-slate-200 rounded" />
          </div>
        </div>
      </div>
      {/* Quick actions */}
      <div className="flex gap-2 flex-wrap">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-8 w-28 bg-slate-200 rounded-md" />
        ))}
      </div>
      {/* Tabs + content */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="border-b border-slate-200 flex gap-0.5 px-2 py-1">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-9 w-20 bg-slate-200 rounded mx-1" />
          ))}
        </div>
        <div className="p-6 space-y-4">
          <div className="h-24 bg-slate-100 rounded-xl" />
          <div className="h-24 bg-slate-100 rounded-xl" />
          <div className="grid grid-cols-2 gap-4">
            <div className="h-16 bg-slate-100 rounded-xl" />
            <div className="h-16 bg-slate-100 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
