export default function Loading() {
  return (
    <div className="space-y-6 max-w-2xl animate-pulse">
      <div className="h-7 w-32 bg-slate-200 rounded" />
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-3 w-24 bg-slate-200 rounded" />
            <div className="h-10 bg-slate-100 rounded-lg" />
          </div>
        ))}
        <div className="flex justify-end gap-2 pt-2">
          <div className="h-9 w-20 bg-slate-200 rounded-md" />
          <div className="h-9 w-24 bg-slate-200 rounded-md" />
        </div>
      </div>
    </div>
  );
}
