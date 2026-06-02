import { SkeletonTable } from '@/components/ui/Skeleton';

export default function ContractTemplatesLoading() {
  return (
    <div className="space-y-6 max-w-5xl">
      <SkeletonTable rows={5} cols={3} />
    </div>
  );
}
