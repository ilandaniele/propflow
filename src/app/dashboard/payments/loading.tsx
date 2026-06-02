import { SkeletonTable } from '@/components/ui/Skeleton';

export default function PaymentsLoading() {
  return (
    <div className="space-y-6 max-w-5xl">
      <SkeletonTable rows={8} cols={5} />
    </div>
  );
}
