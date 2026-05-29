import { requireAdmin } from '@/lib/auth/guards';
import { AiAssistantClient } from './AiAssistantClient';

export default async function AiAssistantPage() {
  await requireAdmin();
  return <AiAssistantClient />;
}
