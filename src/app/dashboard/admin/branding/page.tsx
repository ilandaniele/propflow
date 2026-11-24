import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { getOrgBranding } from '@/lib/branding/org-branding';
import { BrandingForm } from './BrandingForm';

export const metadata: Metadata = { title: 'Marca' };

export default async function AdminBrandingPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }
  const branding = await getOrgBranding(ctx.orgId);
  return <BrandingForm initial={branding} />;
}
