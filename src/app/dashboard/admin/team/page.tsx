import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { listTeam } from '@/lib/team/queries';
import { Card } from '@/components/ui/Card';
import { TeamRoles } from './TeamRoles';

export default async function TeamPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const members = await listTeam(ctx.orgId);

  return (
    <div className="space-y-6 max-w-3xl">
      <Card padding="md">
        <TeamRoles members={members} selfProfileId={ctx.profile.id} />
      </Card>
    </div>
  );
}
