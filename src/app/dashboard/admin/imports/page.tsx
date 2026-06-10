import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { ImportsClient } from './ImportsClient';

export const metadata: Metadata = { title: 'Historial de Importaciones' };

export default async function AdminImportsPage() {
  try { await requireAdmin(); } catch { redirect('/login'); }
  return <ImportsClient />;
}
