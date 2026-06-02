export default function Loading() {
  return (
    <div className="max-w-4xl space-y-4 animate-pulse">
      {/* Conversation header */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
        <div className="h-10 w-10 bg-slate-200 rounded-full" />
        <div className="space-y-1.5">
          <div className="h-4 w-36 bg-slate-200 rounded" />
          <div className="h-3 w-24 bg-slate-200 rounded" />
        </div>
      </div>
      {/* Message area */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 space-y-3 min-h-80">
          {/* Incoming messages */}
          {[80, 64, 96].map((w, i) => (
            <div key={`in-${i}`} className="flex items-start gap-2">
              <div className="h-7 w-7 bg-slate-200 rounded-full shrink-0" />
              <div className="h-10 bg-slate-200 rounded-xl" style={{ width: `${w * 4}px` }} />
            </div>
          ))}
          {/* Outgoing messages */}
          {[72, 56].map((w, i) => (
            <div key={`out-${i}`} className="flex items-start gap-2 flex-row-reverse">
              <div className="h-8 bg-slate-200 rounded-xl" style={{ width: `${w * 4}px` }} />
            </div>
          ))}
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
