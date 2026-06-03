import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { TabFallback } from '@/components/ui/TabFallback';
import { PortalHomeSection } from './PortalHomeSection';
import { VisitorsSection } from './VisitorsSection';
import { NotificationsSection } from './NotificationsSection';
import { AnnouncementsSection } from './AnnouncementsSection';
import { AISessionsSection } from './AISessionsSection';

/**
 * Minimal shape of the tenant row used by this tab.
 * Matches what TenantDetailPage fetches: `tenants.*` joined with `units(label, properties(name))`.
 * AC11: this file and all sub-components are kept free of the notes-only column (see guards.ts).
 */
interface TenantRow {
  id: string;
  full_name: string;
  email?: string | null;
  profile_id?: string | null;
  unit_id?: string | null;
  property_id?: string | null;
  org_id: string;
  units?: { label: string; properties?: { name: string } | null } | null;
}

interface Props {
  tenant: TenantRow;
}

/**
 * PortalPreviewTab — async Server Component.
 *
 * Renders 5 independent Suspense-wrapped sections that stream in parallel (AC6):
 *   a. PortalHomeSection   — summary card (tenant name, unit, rent, visitor stat)
 *   b. VisitorsSection     — visitor_logs scoped to host_tenant_id (AC7)
 *   c. NotificationsSection — notification_inbox scoped to profile_id (AC8)
 *   d. AnnouncementsSection — announcements matching audience rules (AC9)
 *   e. AISessionsSection   — ai_chat_messages grouped by session (AC10)
 *
 * When tenant.profile_id is null (IC5):
 *   - Yellow banner shown at the top of the tab (AC2)
 *   - Visitors + Announcements still render (keyed off unit_id/host_tenant_id)
 *   - Notifications + AI Sessions sub-components render empty-state via their
 *     own profileId=null guard — no extra conditional needed here.
 *
 * Security:
 *   - Strictly read-only — no mutation forms, no Server Actions, no write buttons (AC5).
 *   - All data-fetching is done in sub-components, each calling requireAdmin()
 *     independently so auth is enforced even if sections are rendered standalone.
 *   - AC11: admin-only columns are excluded; see notes-only guards in the Notes tab.
 */
export async function PortalPreviewTab({ tenant }: Props) {
  const t = await getTranslations('tenants');

  const hasPortalAccount = tenant.profile_id != null;

  return (
    <div className="p-4 space-y-6" data-testid="portal-preview-tab">
      {/* AC2 — yellow banner when tenant has no linked portal account */}
      {!hasPortalAccount && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3"
        >
          <svg
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0 text-yellow-500"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
          <p className="text-sm font-medium text-yellow-800">
            {t('portalPreview.noLinkedAccount')}
          </p>
        </div>
      )}

      {/* Section a — AC6: independent Suspense boundary */}
      <Suspense fallback={<TabFallback />}>
        <PortalHomeSection tenant={tenant} />
      </Suspense>

      {/* Section b — AC6: independent Suspense boundary */}
      <Suspense fallback={<TabFallback />}>
        <VisitorsSection tenantId={tenant.id} orgId={tenant.org_id} />
      </Suspense>

      {/* Section c — AC6: independent Suspense boundary
          NotificationsSection handles profileId=null with empty-state internally */}
      <Suspense fallback={<TabFallback />}>
        <NotificationsSection profileId={tenant.profile_id ?? null} orgId={tenant.org_id} />
      </Suspense>

      {/* Section d — AC6: independent Suspense boundary */}
      <Suspense fallback={<TabFallback />}>
        <AnnouncementsSection
          unitId={tenant.unit_id ?? null}
          propertyId={tenant.property_id ?? null}
          orgId={tenant.org_id}
        />
      </Suspense>

      {/* Section e — AC6: independent Suspense boundary
          AISessionsSection handles profileId=null with empty-state internally */}
      <Suspense fallback={<TabFallback />}>
        <AISessionsSection profileId={tenant.profile_id ?? null} orgId={tenant.org_id} />
      </Suspense>
    </div>
  );
}
