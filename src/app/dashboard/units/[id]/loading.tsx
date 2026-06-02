import { SkeletonDetailCard } from '@/components/ui/Skeleton';

export default function UnitDetailLoading() {
  return (
    <div className="space-y-4 max-w-2xl">
      {/* Back link placeholder */}
      <div className="h-5 w-32 animate-pulse rounded bg-slate-200" />
      <SkeletonDetailCard />
    </div>
  );
}
