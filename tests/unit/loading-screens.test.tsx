/**
 * tests/unit/loading-screens.test.tsx
 *
 * Verifies that each loading.tsx screen component renders without throwing
 * and exposes at least one role="status" element (from SkeletonTable,
 * SkeletonStats, SkeletonCardGrid, or SkeletonDetailCard).
 *
 * Uses renderToStaticMarkup — no DOM / React root needed.
 * Pattern matches skeleton.test.tsx in this repo.
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import DashboardLoading from '@/app/dashboard/loading';
import TenantsLoading from '@/app/dashboard/tenants/loading';
import TenantDetailLoading from '@/app/dashboard/tenants/[id]/loading';
import UnitsLoading from '@/app/dashboard/units/loading';
import UnitDetailLoading from '@/app/dashboard/units/[id]/loading';
import ContractsLoading from '@/app/dashboard/contracts/loading';
import ContractTemplatesLoading from '@/app/dashboard/contracts/templates/loading';
import PaymentsLoading from '@/app/dashboard/payments/loading';
import IncidentsLoading from '@/app/dashboard/incidents/loading';
import IncidentDetailLoading from '@/app/dashboard/incidents/[id]/loading';
import TasksLoading from '@/app/dashboard/tasks/loading';
import SanctionsLoading from '@/app/dashboard/sanctions/loading';
import RemindersLoading from '@/app/dashboard/reminders/loading';
import VisitorsLoading from '@/app/dashboard/visitors/loading';
import LeadsLoading from '@/app/dashboard/leads/loading';
import CleaningLoading from '@/app/dashboard/cleaning/loading';
import AnnouncementsLoading from '@/app/dashboard/announcements/loading';
import CommunityLoading from '@/app/dashboard/community/loading';
import WhatsAppLoading from '@/app/dashboard/whatsapp/loading';
import PropertiesLoading from '@/app/dashboard/properties/loading';
import FinanceLoading from '@/app/dashboard/finance/loading';
import ReceiptsLoading from '@/app/dashboard/finance/receipts/loading';
import ExpenseCategoriesLoading from '@/app/dashboard/finance/expenses/categories/loading';
import PricingLoading from '@/app/dashboard/pricing/loading';
import AiAssistantLoading from '@/app/dashboard/ai-assistant/loading';

// ---------------------------------------------------------------------------
// Helper: asserts a loading component renders role="status" without throwing
// ---------------------------------------------------------------------------
function expectLoadsStatus(component: React.ReactElement) {
  let html = '';
  expect(() => { html = renderToStaticMarkup(component); }).not.toThrow();
  expect(html).toContain('role="status"');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('animate-pulse');
}

// ---------------------------------------------------------------------------
// Required 5 representative screens (spec minimum)
// ---------------------------------------------------------------------------

describe('TenantsLoading (SkeletonTable)', () => {
  it('renders role="status" without throwing', () => {
    expectLoadsStatus(<TenantsLoading />);
  });

  it('wraps in space-y-6 max-w-5xl container', () => {
    const html = renderToStaticMarkup(<TenantsLoading />);
    expect(html).toContain('space-y-6');
    expect(html).toContain('max-w-5xl');
  });
});

describe('DashboardLoading (SkeletonStats)', () => {
  it('renders role="status" without throwing', () => {
    expectLoadsStatus(<DashboardLoading />);
  });

  it('contains aria-label for statistics', () => {
    const html = renderToStaticMarkup(<DashboardLoading />);
    expect(html).toContain('aria-label="Loading statistics"');
  });
});

describe('FinanceLoading (SkeletonStats)', () => {
  it('renders role="status" without throwing', () => {
    expectLoadsStatus(<FinanceLoading />);
  });

  it('renders 4 stat card skeletons (16 animate-pulse blocks)', () => {
    const html = renderToStaticMarkup(<FinanceLoading />);
    const matches = html.match(/animate-pulse/g) ?? [];
    // SkeletonStats count=4: 4 cards × 4 skeletons each = 16
    expect(matches.length).toBe(16);
  });
});

describe('IncidentDetailLoading (SkeletonDetailCard)', () => {
  it('renders role="status" without throwing', () => {
    expectLoadsStatus(<IncidentDetailLoading />);
  });

  it('contains aria-label for detail', () => {
    const html = renderToStaticMarkup(<IncidentDetailLoading />);
    expect(html).toContain('aria-label="Loading detail"');
  });

  it('renders back-link placeholder bar', () => {
    const html = renderToStaticMarkup(<IncidentDetailLoading />);
    expect(html).toContain('h-5');
    expect(html).toContain('w-32');
  });
});

describe('PropertiesLoading (SkeletonCardGrid)', () => {
  it('renders role="status" without throwing', () => {
    expectLoadsStatus(<PropertiesLoading />);
  });

  it('contains aria-label for cards', () => {
    const html = renderToStaticMarkup(<PropertiesLoading />);
    expect(html).toContain('aria-label="Loading cards"');
  });

  it('renders 6 card skeletons (24 animate-pulse blocks)', () => {
    const html = renderToStaticMarkup(<PropertiesLoading />);
    const matches = html.match(/animate-pulse/g) ?? [];
    // SkeletonCardGrid cards=6: 6 × 4 = 24
    expect(matches.length).toBe(24);
  });
});

// ---------------------------------------------------------------------------
// All remaining loading screens — smoke-test for no-throw + role="status"
// ---------------------------------------------------------------------------

const allLoadingComponents: Array<[string, React.ReactElement]> = [
  ['TenantDetailLoading', <TenantDetailLoading />],
  ['UnitsLoading', <UnitsLoading />],
  ['UnitDetailLoading', <UnitDetailLoading />],
  ['ContractsLoading', <ContractsLoading />],
  ['ContractTemplatesLoading', <ContractTemplatesLoading />],
  ['PaymentsLoading', <PaymentsLoading />],
  ['IncidentsLoading', <IncidentsLoading />],
  ['TasksLoading', <TasksLoading />],
  ['SanctionsLoading', <SanctionsLoading />],
  ['RemindersLoading', <RemindersLoading />],
  ['VisitorsLoading', <VisitorsLoading />],
  ['LeadsLoading', <LeadsLoading />],
  ['CleaningLoading', <CleaningLoading />],
  ['AnnouncementsLoading', <AnnouncementsLoading />],
  ['CommunityLoading', <CommunityLoading />],
  ['WhatsAppLoading', <WhatsAppLoading />],
  ['ReceiptsLoading', <ReceiptsLoading />],
  ['ExpenseCategoriesLoading', <ExpenseCategoriesLoading />],
  ['PricingLoading', <PricingLoading />],
  ['AiAssistantLoading', <AiAssistantLoading />],
];

describe('All remaining loading screens — smoke tests', () => {
  for (const [name, element] of allLoadingComponents) {
    it(`${name} renders role="status" without throwing`, () => {
      expectLoadsStatus(element);
    });
  }
});
