import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireTenant } from '@/lib/auth/guards';
import { PaymentsClient } from './PaymentsClient';

export const metadata: Metadata = { title: 'Mis Pagos' };

export default async function PortalPaymentsPage() {
  try { await requireTenant(); } catch { redirect('/login'); }
  return <PaymentsClient />;
}
