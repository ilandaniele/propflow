/**
 * tests/e2e/admin-import.spec.ts
 *
 * E2E tests for the Admin Import section (AC19, AC20).
 * Covers:
 *   - Navigation to /dashboard/admin/import redirects to /csv
 *   - All 7 tabs are present in the navigation
 *   - Phantom Rooms tab renders the table
 *   - Property Mapping form is present and usable
 *   - Account Mapping form is present
 *   - Check Files shows lint warning + no-import banner
 *   - Import Logs table renders (AC18)
 *
 * Note: These tests use a running dev server. Full import workflows require a
 * seeded DB — those are covered in integration tests. E2E focuses on navigation,
 * rendering, and form presence.
 */

import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

// Helper to log in as admin (reuse the seed credentials)
async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.fill('[name=email]', 'admin@dev.local');
  await page.fill('[name=password]', 'DevPass1234!');
  await page.click('[type=submit]');
  // Wait for redirect to dashboard
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Navigation tests
// ---------------------------------------------------------------------------

test.describe('Admin Import — navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('navigating to /dashboard/admin/import redirects to /csv', async ({ page }) => {
    await page.goto('/dashboard/admin/import');
    await page.waitForURL(/\/dashboard\/admin\/import\/csv/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/dashboard\/admin\/import\/csv/);
  });

  test('all 7 import tabs are visible', async ({ page }) => {
    await page.goto('/dashboard/admin/import/csv');
    await page.waitForLoadState('networkidle');

    // All 7 tabs should be rendered in the nav
    const tabs = page.locator('nav[aria-label="Import section tabs"] a');
    await expect(tabs).toHaveCount(7);

    // Check specific tab labels (Spanish)
    await expect(page.getByRole('link', { name: 'CSV Mensual' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Rendimiento' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Historial' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cuartos fantasma' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Mapeo propiedades' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Mapeo cuentas' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Verificar archivo' })).toBeVisible();
  });

  test('admin sidebar contains Importacion link', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('link', { name: 'Importación' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// CSV tab
// ---------------------------------------------------------------------------

test.describe('Admin Import — CSV tab', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/admin/import/csv');
    await page.waitForLoadState('networkidle');
  });

  test('CSV page renders import type, year, and month selectors', async ({ page }) => {
    await expect(page.locator('#import-type')).toBeVisible();
    await expect(page.locator('#import-year')).toBeVisible();
    await expect(page.locator('#import-month')).toBeVisible();
  });

  test('Validate button is disabled without a file', async ({ page }) => {
    const button = page.getByRole('button', { name: /Validar y simular/i });
    await expect(button).toBeDisabled();
  });

  test('file drop zone is present and accessible', async ({ page }) => {
    // The drop zone has role="button" and aria-label
    await expect(page.getByRole('button', { name: /Subir archivo CSV/i })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Import Logs tab — AC18 visibility
// ---------------------------------------------------------------------------

test.describe('Admin Import — Logs tab', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/admin/import/logs');
    await page.waitForLoadState('networkidle');
  });

  test('logs table renders with correct column headers', async ({ page }) => {
    const table = page.locator('[data-testid="import-logs-table"]');
    await expect(table).toBeVisible();

    // Check column headers
    await expect(page.getByText('Tipo', { exact: false })).toBeVisible();
    await expect(page.getByText('Archivo', { exact: false })).toBeVisible();
    await expect(page.getByText('Estado', { exact: false })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Phantom Rooms tab — AC19
// ---------------------------------------------------------------------------

test.describe('Admin Import — Phantom Rooms tab (AC19)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/admin/import/phantom-rooms');
    await page.waitForLoadState('networkidle');
  });

  test('phantom rooms page renders info banner', async ({ page }) => {
    await expect(page.getByText('Cuartos fantasma')).toBeVisible();
    await expect(page.getByText(/Mapea cada etiqueta/)).toBeVisible();
  });

  test('phantom rooms table or empty state is rendered', async ({ page }) => {
    // Either the table with pending rooms or the empty state message
    const tableOrEmpty = page.locator('[data-testid="phantom-rooms-table"], :text("No hay cuartos fantasma")');
    await expect(tableOrEmpty.first()).toBeVisible();
  });

  test('mapping form has unit dropdown and action buttons', async ({ page }) => {
    // If there are pending phantom rooms, the form should contain the unit dropdown
    const pendingTable = page.locator('[data-testid="phantom-rooms-table"]');
    const hasPendingRooms = await pendingTable.isVisible();

    if (hasPendingRooms) {
      // Unit dropdown
      await expect(page.locator('select[name="unitId"]').first()).toBeVisible();
      // Resolution toggle buttons
      await expect(page.getByRole('button', { name: 'Mapear' }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Ignorar' }).first()).toBeVisible();
    } else {
      // Empty state
      await expect(page.getByText('No hay cuartos fantasma pendientes.')).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// Property Mapping tab — AC20
// ---------------------------------------------------------------------------

test.describe('Admin Import — Property Mapping tab (AC20)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/admin/import/property-mapping');
    await page.waitForLoadState('networkidle');
  });

  test('property mapping form is visible', async ({ page }) => {
    await expect(page.locator('#externalName')).toBeVisible();
    await expect(page.locator('#internalPropertyId')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Guardar mapeo' })).toBeVisible();
  });

  test('existing mappings table renders', async ({ page }) => {
    // Either the table or empty state
    const tableOrEmpty = page.locator('[data-testid="property-mappings-table"], :text("No hay mapeos de propiedades")');
    await expect(tableOrEmpty.first()).toBeVisible();
  });

  test('Save button is initially enabled', async ({ page }) => {
    // Button is enabled (form submission handles validation)
    const btn = page.getByRole('button', { name: 'Guardar mapeo' });
    await expect(btn).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// Account Mapping tab — AC20
// ---------------------------------------------------------------------------

test.describe('Admin Import — Account Mapping tab (AC20)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/admin/import/account-mapping');
    await page.waitForLoadState('networkidle');
  });

  test('account mapping form has all required fields', async ({ page }) => {
    await expect(page.locator('#externalAccount')).toBeVisible();
    await expect(page.locator('#internalCategory')).toBeVisible();
    await expect(page.locator('input[name="isIncome"]')).toBeVisible();
    await expect(page.locator('input[name="affectsNetProfit"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Guardar mapeo' })).toBeVisible();
  });

  test('internal category dropdown has at least 10 options', async ({ page }) => {
    const options = page.locator('#internalCategory option');
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(10);
  });

  test('existing mappings table renders', async ({ page }) => {
    const tableOrEmpty = page.locator('[data-testid="account-mappings-table"], :text("No hay mapeos de cuentas")');
    await expect(tableOrEmpty.first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Check Files tab — AC20
// ---------------------------------------------------------------------------

test.describe('Admin Import — Check Files tab (AC20)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/admin/import/check-files');
    await page.waitForLoadState('networkidle');
  });

  test('no-import warning banner is visible', async ({ page }) => {
    await expect(page.getByText('Solo verificación — NO importa datos.')).toBeVisible();
  });

  test('file type selector and drop zone are rendered', async ({ page }) => {
    await expect(page.locator('#check-type')).toBeVisible();
    await expect(page.getByRole('button', { name: /Seleccionar archivo CSV/i })).toBeVisible();
  });

  test('check file button is disabled without a file', async ({ page }) => {
    const button = page.getByRole('button', { name: /Verificar archivo/i });
    await expect(button).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Room Performance tab
// ---------------------------------------------------------------------------

test.describe('Admin Import — Room Performance tab', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/admin/import/room-performance');
    await page.waitForLoadState('networkidle');
  });

  test('room performance page renders correctly', async ({ page }) => {
    await expect(page.getByText('Paso 2 — Rendimiento de habitaciones')).toBeVisible();
    await expect(page.locator('#rp-year')).toBeVisible();
    await expect(page.locator('#rp-month')).toBeVisible();
  });

  test('Upload button is disabled without a file', async ({ page }) => {
    const button = page.getByRole('button', { name: /Subir rendimiento/i });
    await expect(button).toBeDisabled();
  });
});
