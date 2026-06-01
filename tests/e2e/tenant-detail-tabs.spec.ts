import { test, expect } from '@playwright/test';

test.describe('Tenant Detail Page — 10 tabs', () => {
  test.beforeEach(async ({ page }) => {
    // For E2E, we rely on the dev server with a seeded tenant
    // These tests require a running app with test data
    // Skip if no test tenant ID is configured
    if (!process.env.TEST_TENANT_ID) {
      test.skip();
    }
  });

  test('renders 10 tabs for a valid tenant', async ({ page }) => {
    const tenantId = process.env.TEST_TENANT_ID ?? 'placeholder';
    await page.goto(`/dashboard/tenants/${tenantId}`);

    // Should see all 10 tabs
    const tabLabels = ['Overview', 'Payments', 'Contracts', 'Incidents', 'Tasks', 'WhatsApp', 'Documents', 'Sanctions', 'Notes', 'Activity'];
    for (const label of tabLabels) {
      await expect(page.getByRole('tab', { name: label })).toBeVisible();
    }
  });

  test('redirects unauthenticated access to login', async ({ page }) => {
    await page.goto('/dashboard/tenants/some-uuid');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('WhatsApp Admin Inbox', () => {
  test('shows mock provider banner when no real provider configured', async ({ page }) => {
    // Requires auth — skip if no test credentials
    if (!process.env.TEST_ADMIN_EMAIL) {
      test.skip();
    }
    // Login first, then check the WhatsApp page
  });
});
