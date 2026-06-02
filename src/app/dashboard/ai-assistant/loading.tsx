export default function Loading() {
  return (
    <div className="space-y-4 max-w-5xl animate-pulse">
      <div className="h-7 w-32 bg-slate-200 rounded" />
      {/* Chat area */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <div className="h-5 w-48 bg-slate-200 rounded" />
        </div>
        <div className="p-4 space-y-4 min-h-64">
          {/* Assistant bubble */}
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 bg-slate-200 rounded-full shrink-0" />
            <div className="space-y-1.5 max-w-xs">
              <div className="h-3 w-56 bg-slate-200 rounded" />
              <div className="h-3 w-40 bg-slate-200 rounded" />
            </div>
          </div>
          {/* User bubble */}
          <div className="flex items-start gap-3 flex-row-reverse">
            <div className="h-8 w-8 bg-slate-200 rounded-full shrink-0" />
            <div className="space-y-1.5 max-w-xs">
              <div className="h-3 w-48 bg-slate-200 rounded" />
            </div>
          </div>
        </div>
        {/* Input bar */}
        <div className="p-4 border-t border-slate-200 flex gap-2">
          <div className="flex-1 h-10 bg-slate-200 rounded-lg" />
          <div className="h-10 w-16 bg-slate-200 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
