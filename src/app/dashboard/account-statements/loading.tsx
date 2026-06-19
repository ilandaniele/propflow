import { SkeletonStats } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div className="space-y-6 max-w-5xl">
      <SkeletonStats count={3} />
    </div>
  );
}
