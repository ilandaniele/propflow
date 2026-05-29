import { test, expect } from '@playwright/test';

// These tests require the seed to have been run
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@org-a.demo';
const ADMIN_PASS = process.env.E2E_ADMIN_PASS ?? 'DemoAdmin123!';
const TENANT_EMAIL = process.env.E2E_TENANT_EMAIL ?? 'tenant@org-a.demo';
const TENANT_PASS = process.env.E2E_TENANT_PASS ?? 'DemoTenant123!';

const HAVE_CREDENTIALS = !!process.env.E2E_ADMIN_EMAIL || ADMIN_EMAIL !== '';

test.describe.configure({ mode: 'serial' });

test.describe.skipIf(!HAVE_CREDENTIALS)('Authentication flows', () => {
  test('admin login redirects to /dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/password/i).fill(ADMIN_PASS);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
  });

  test('tenant login redirects to /portal', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(TENANT_EMAIL);
    await page.getByLabel(/password/i).fill(TENANT_PASS);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/portal/, { timeout: 10_000 });
  });

  test('unauthenticated access to /dashboard redirects to /login', async ({ page }) => {
    // Clear any existing session
    await page.context().clearCookies();
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('signed-in admin can sign out', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/password/i).fill(ADMIN_PASS);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });

    const logoutBtn = page.getByTestId('logout-button');
    await logoutBtn.click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });
});

// Standalone test that always runs
test('login page renders correctly without JavaScript errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/login');
  await expect(page.getByRole('heading')).toBeVisible();
  // Filter out known non-critical errors
  const criticalErrors = errors.filter((e) => !e.includes('favicon') && !e.includes('ads'));
  expect(criticalErrors).toHaveLength(0);
});
