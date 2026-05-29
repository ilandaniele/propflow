import { requireTenant } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { RegisterVisitorForm } from './RegisterVisitorForm';

export default async function RegisterVisitorPage() {
  await requireTenant();
  return (
    <div className="p-4 pb-20 sm:pb-4 space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Register a Visitor</h1>
      <p className="text-sm text-slate-500">Log an expected or arriving visitor for your unit.</p>
      <Card padding="md">
        <RegisterVisitorForm />
      </Card>
    </div>
  );
}
