import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { PlaygroundClient } from './PlaygroundClient';

export const metadata: Metadata = { title: 'Agente IA — Playground' };

export default async function AgentPlaygroundPage() {
  try { await requireAdmin(); } catch { redirect('/login'); }
  return <PlaygroundClient />;
}
