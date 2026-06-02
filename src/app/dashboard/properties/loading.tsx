import { SkeletonCardGrid } from '@/components/ui/Skeleton';

export default function PropertiesLoading() {
  return (
    <div className="space-y-6 max-w-5xl">
      <SkeletonCardGrid cards={6} />
    </div>
  );
}
