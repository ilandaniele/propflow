import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { getLinkForProfile } from '@/lib/owner-assistant/links';
import { listAssistantActivity } from '@/lib/owner-assistant/activity';
import { transcriptionEnabled } from '@/lib/owner-assistant/transcribe';
import { Card } from '@/components/ui/Card';
import { OwnerAssistant } from './OwnerAssistant';

export default async function WhatsAppAssistantPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [link, activity] = await Promise.all([getLinkForProfile(ctx.profile.id), listAssistantActivity(ctx.orgId)]);

  return (
    <div className="space-y-6 max-w-3xl">
      <Card padding="md">
        <OwnerAssistant
          linkedPhone={link?.verifiedAt ? link.phoneE164 : null}
          activity={activity}
          voiceEnabled={transcriptionEnabled()}
        />
      </Card>
    </div>
  );
}
