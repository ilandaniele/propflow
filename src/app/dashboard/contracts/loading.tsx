import { SkeletonTable } from '@/components/ui/Skeleton';

export default function ContractsLoading() {
  return (
    <div className="space-y-6 max-w-5xl">
      <SkeletonTable rows={6} cols={5} />
    </div>
  );
}
