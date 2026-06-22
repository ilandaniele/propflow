import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { getTranslations } from 'next-intl/server';
import { requireTenant } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getSignedUrl } from '@/lib/storage';
import { Card } from '@/components/ui/Card';
import { AvatarUploader } from '@/components/images/AvatarUploader';

export const metadata: Metadata = { title: 'My Profile' };

/**
 * Portal profile page — tenant can view their info and manage their avatar.
 *
 * Data flow:
 * 1. requireTenant() — verifies JWT + tenant role (defense-in-depth over middleware).
 * 2. Fetch tenant row for display info + current photo_url.
 * 3. If photoUrl exists, generate a signed URL via Tigris S3 getSignedUrl().
 *    We resolve server-side to avoid exposing the raw storage path to the client.
 * 4. Pass signed URL to AvatarUploader (client component) — it handles upload/delete
 *    via Server Actions which re-enforce auth + IDOR.
 */
export default async function PortalProfilePage() {
  let ctx;
  try { ctx = await requireTenant(); } catch { redirect('/login'); }

  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'tenants' });

  const tenantRows = await db
    .select({
      id:       tenants.id,
      fullName: tenants.fullName,
      email:    tenants.email,
      phone:    tenants.phone,
      photoUrl: tenants.photoUrl,
    })
    .from(tenants)
    .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
    .limit(1);

  if (!tenantRows.length) {
    redirect('/portal');
  }

  const tenantRow = tenantRows[0];

  // Resolve signed URL for the avatar (server-side to keep storage path off the client)
  let signedAvatarUrl: string | null = null;
  if (tenantRow.photoUrl) {
    try {
      signedAvatarUrl = await getSignedUrl('tenant-avatars', tenantRow.photoUrl, 3600);
    } catch {
      // Non-fatal — avatar just won't show if signing fails
    }
  }

  const displayName = tenantRow.fullName ?? ctx.profile.full_name ?? 'Tenant';

  const avatarLabels = {
    changePhoto: t('avatar.changePhoto'),
    removePhoto: t('avatar.removePhoto'),
    uploadHint:  t('avatar.uploadHint'),
    invalidMime: t('photo.invalidMime'),
    fileTooLarge: t('photo.fileTooLarge'),
    uploadError:  t('photo.uploadError'),
    removeError:  t('photo.removeError'),
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">{t('profile.title')}</h1>

      {/* Avatar section */}
      <Card>
        <div className="flex flex-col items-center py-4">
          <AvatarUploader
            name={displayName}
            currentUrl={signedAvatarUrl}
            labels={avatarLabels}
          />
        </div>
      </Card>

      {/* Profile info */}
      <Card>
        <dl className="divide-y divide-slate-100">
          <div className="py-3 flex justify-between items-center">
            <dt className="text-sm text-slate-500">{t('profile.name')}</dt>
            <dd className="text-sm font-medium text-slate-900">{displayName}</dd>
          </div>
          {tenantRow.email && (
            <div className="py-3 flex justify-between items-center">
              <dt className="text-sm text-slate-500">{t('profile.email')}</dt>
              <dd className="text-sm font-medium text-slate-900">{tenantRow.email}</dd>
            </div>
          )}
          {tenantRow.phone && (
            <div className="py-3 flex justify-between items-center">
              <dt className="text-sm text-slate-500">{t('profile.phone')}</dt>
              <dd className="text-sm font-medium text-slate-900">{tenantRow.phone}</dd>
            </div>
          )}
        </dl>
      </Card>
    </div>
  );
}
