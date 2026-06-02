import { SkeletonDetailCard } from '@/components/ui/Skeleton';

export default function IncidentDetailLoading() {
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="h-5 w-32 animate-pulse rounded bg-slate-200" />
      <SkeletonDetailCard />
    </div>
  );
}
