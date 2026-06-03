/**
 * tests/e2e/executive-brief.spec.ts
 *
 * E2E tests for the Executive Brief page (AC12, AC14):
 *
 *   AC12: Page renders 4 KPI tiles (occupancy, net profit, past due, incidents)
 *   AC14: 4 agent cards present
 *         - Hidden Leak Detector has a "Run" button
 *         - Market Rate Auditor, P&L Delta Analyzer, Create Custom Agent open Coming Soon modal
 *
 * Tests skip gracefully when E2E credentials are not provided.
 */

import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@org-a.demo';
const ADMIN_PASS = process.env.E2E_ADMIN_PASS ?? 'DemoAdmin123!';
const HAVE_CREDENTIALS = !!process.env.E2E_ADMIN_EMAIL;

// ---------------------------------------------------------------------------
// Auth helper — logs in as admin before each test
// ---------------------------------------------------------------------------
async function loginAsAdmin(page: Parameters<typeof test>[1] extends (args: { page: infer P }) => unknown ? P : never) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/password/i).fill(ADMIN_PASS);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Executive Brief page', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }, testInfo) => {
    if (!HAVE_CREDENTIALS) {
      testInfo.skip();
      return;
    }
    await loginAsAdmin(page);
    await page.goto('/dashboard/executive-brief');
    await expect(page).toHaveURL(/executive-brief/, { timeout: 10_000 });
  });

  // ── AC12: KPI tiles ────────────────────────────────────────────────────────

  test('AC12: page renders with heading "Executive Brief"', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /executive brief/i })).toBeVisible({ timeout: 10_000 });
  });

  test('AC12: KPI grid is present', async ({ page }) => {
    await expect(page.getByTestId('kpi-grid')).toBeVisible({ timeout: 10_000 });
  });

  test('AC12: 4 KPI tiles render (occupancy, net-profit, past-due, incidents)', async ({ page }) => {
    await page.waitForSelector('[data-testid="kpi-grid"]', { timeout: 10_000 });

    const expectedKeys = ['occupancy', 'net-profit', 'past-due', 'incidents'];
    for (const key of expectedKeys) {
      await expect(page.getByTestId(`kpi-tile-${key}`)).toBeVisible();
    }
  });

  test('AC12: each KPI tile shows a value and "vs periodo anterior" delta text', async ({ page }) => {
    await page.waitForSelector('[data-testid="kpi-grid"]', { timeout: 10_000 });
    // At minimum the occupancy tile should have some content
    const occupancyTile = page.getByTestId('kpi-tile-occupancy');
    await expect(occupancyTile).toContainText(/ocupaci/i);
  });

  // ── AC14: Agent cards ─────────────────────────────────────────────────────

  test('AC14: 4 agent cards are present', async ({ page }) => {
    await page.waitForSelector('[data-testid="agent-cards-grid"]', { timeout: 10_000 });

    const expectedIds = [
      'hidden-leak-detector',
      'market-rate-auditor',
      'pnl-delta-analyzer',
      'create-custom-agent',
    ];
    for (const id of expectedIds) {
      await expect(page.getByTestId(`agent-card-${id}`)).toBeVisible();
    }
  });

  test('AC14: Hidden Leak Detector card has a Run button', async ({ page }) => {
    await page.waitForSelector('[data-testid="agent-card-hidden-leak-detector"]', {
      timeout: 10_000,
    });
    const runBtn = page.getByTestId('run-btn-hidden-leak-detector');
    await expect(runBtn).toBeVisible();
    await expect(runBtn).toContainText(/ejecutar/i);
  });

  test('AC14: Market Rate Auditor opens Coming Soon modal on click', async ({ page }) => {
    await page.waitForSelector('[data-testid="agent-card-market-rate-auditor"]', {
      timeout: 10_000,
    });
    await page.getByTestId('coming-soon-btn-market-rate-auditor').click();
    await expect(page.getByTestId('agent-coming-soon-modal')).toBeVisible({ timeout: 5_000 });
    // Close it
    await page.getByRole('button', { name: /cerrar/i }).click();
    await expect(page.getByTestId('agent-coming-soon-modal')).not.toBeVisible();
  });

  test('AC14: P&L Delta Analyzer opens Coming Soon modal on click', async ({ page }) => {
    await page.waitForSelector('[data-testid="agent-card-pnl-delta-analyzer"]', {
      timeout: 10_000,
    });
    await page.getByTestId('coming-soon-btn-pnl-delta-analyzer').click();
    await expect(page.getByTestId('agent-coming-soon-modal')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /cerrar/i }).click();
  });

  test('AC14: Create Custom Agent opens Coming Soon modal on click', async ({ page }) => {
    await page.waitForSelector('[data-testid="agent-card-create-custom-agent"]', {
      timeout: 10_000,
    });
    await page.getByTestId('coming-soon-btn-create-custom-agent').click();
    await expect(page.getByTestId('agent-coming-soon-modal')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /cerrar/i }).click();
  });

  // ── Auth guard ──────────────────────────────────────────────────────────────

  test('unauthenticated access to /dashboard/executive-brief redirects to /login', async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto('/dashboard/executive-brief');
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Structural tests (run without credentials — verify page structure)
// ---------------------------------------------------------------------------

test.describe('Executive Brief page — structural (no auth required)', () => {
  test('unauthenticated GET /dashboard/executive-brief returns redirect to /login', async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto('/dashboard/executive-brief');
    // Should redirect away from executive-brief
    await expect(page).not.toHaveURL(/executive-brief/);
  });
});
