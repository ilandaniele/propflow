import { test, expect } from '@playwright/test';
import { signInAs } from './fixtures/session';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Credentials — match existing E2E pattern
// ---------------------------------------------------------------------------

const TENANT_EMAIL = process.env.E2E_TENANT_EMAIL ?? 'tenant@org-a.demo';

/**
 * TEST_UNIT_ID must be a unit that:
 *   - belongs to Org A
 *   - the admin user has access to manage
 *   - the tenant (tenant@org-a.demo) is assigned to
 */
const TEST_UNIT_ID = process.env.TEST_UNIT_ID;

// Skip all tests in this file if required env vars are not set.
// In CI, set TEST_UNIT_ID + E2E_ADMIN_EMAIL + E2E_TENANT_EMAIL to enable.
const SKIP = !TEST_UNIT_ID;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loginAsAdmin(page: Parameters<Parameters<typeof test>[1]>[0]['page']) {
  await signInAs(page, 'admin');
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

async function loginAsTenant(page: Parameters<Parameters<typeof test>[1]>[0]['page']) {
  await signInAs(page, 'tenant');
  await expect(page).toHaveURL(/\/portal/, { timeout: 15_000 });
}

/** Creates a minimal valid JPEG in the test's output dir (Playwright cleans it up) and returns its path. */
function createTempJpeg(name = 'test-upload.jpg'): string {
  const filePath = test.info().outputPath(name);
  // Valid 1x1 JPEG so the browser can decode and render it after upload
  const jpegBytes = Buffer.from(
    '/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKAA/9k=',
    'base64',
  );
  fs.writeFileSync(filePath, jpegBytes);
  return filePath;
}

// ---------------------------------------------------------------------------
// Scenario 1: Admin uploads a unit image → image appears in gallery
// ---------------------------------------------------------------------------

test.describe('Unit Images — Admin upload flow', () => {
  test.beforeEach(({}, testInfo) => {
    if (SKIP) {
      testInfo.skip(true, 'requires TEST_UNIT_ID env var (set in CI or local .env.test)');
    }
  });

  test('admin uploads a unit image and it appears in the gallery', async ({ page }) => {
    await loginAsAdmin(page);

    // Navigate to the unit detail page
    await page.goto(`/dashboard/units/${TEST_UNIT_ID}`);
    await expect(page).toHaveURL(`/dashboard/units/${TEST_UNIT_ID}`, { timeout: 10_000 });

    // Click the Images tab (label may be translated — try common labels)
    const imagesTab = page
      .getByRole('tab', { name: /images|fotos|photos/i })
      .first();
    await expect(imagesTab).toBeVisible({ timeout: 8_000 });
    await imagesTab.click();

    // Find the file input inside the uploader
    const fileInput = page.locator('input[type="file"][accept*="image"]').first();
    await expect(fileInput).toBeAttached({ timeout: 5_000 });

    const tempFile = createTempJpeg('admin-unit-upload.jpg');
    await fileInput.setInputFiles(tempFile);

    // Wait for the gallery to update — at least one image element should appear
    // The gallery renders <img> tags or role="img" elements
    await expect(
      page.locator('img[src*="unit-images"], img[alt*="unit"], [data-testid="unit-image"]').first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Tenant views their own unit images from the portal
// ---------------------------------------------------------------------------

test.describe('Unit Images — Tenant view in portal', () => {
  test.beforeEach(({}, testInfo) => {
    if (SKIP) {
      testInfo.skip(true, 'requires TEST_UNIT_ID env var (set in CI or local .env.test)');
    }
  });

  test('tenant can see unit images section in portal', async ({ page }) => {
    await loginAsTenant(page);

    // Portal dashboard — look for the unit images section
    await page.goto('/portal');
    await expect(page).toHaveURL(/\/portal/, { timeout: 10_000 });

    // The unit image gallery section should be visible.
    // It may be in a "Unit Images", "Fotos de la unidad", or similar heading/section.
    const gallerySection = page
      .getByRole('heading', { name: /unit images|fotos|gallery|galería/i })
      .or(page.locator('[data-testid="unit-image-gallery"]'))
      .first();

    await expect(gallerySection).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Tenant uploads own avatar from /portal/profile
// ---------------------------------------------------------------------------

test.describe('Tenant Avatar — upload from portal profile', () => {
  test.beforeEach(({}, testInfo) => {
    if (!TENANT_EMAIL) {
      testInfo.skip(true, 'requires E2E_TENANT_EMAIL env var');
    }
  });

  test('tenant can upload avatar photo from portal profile and avatar updates', async ({ page }) => {
    await loginAsTenant(page);

    await page.goto('/portal/profile');
    await expect(page).toHaveURL(/\/portal\/profile/, { timeout: 10_000 });

    // Find the avatar file input
    const avatarInput = page
      .locator('input[type="file"][accept*="image"]')
      .first();
    await expect(avatarInput).toBeAttached({ timeout: 5_000 });

    const tempFile = createTempJpeg('tenant-avatar.jpg');
    const uploadAction = page.waitForResponse(
      (res) => res.request().method() === 'POST' && !!res.request().headers()['next-action'],
      { timeout: 20_000 },
    );
    await avatarInput.setInputFiles(tempFile);
    expect((await uploadAction).ok()).toBe(true);

    await expect(page.getByText(/no se pudo subir la foto|could not upload photo/i)).toBeHidden();

    // The optimistic preview is client-only; after a reload the <img> (initials
    // when there is no avatar) proves the upload was stored and is served back.
    await page.reload();
    const avatar = page.getByRole('main').locator('img').first();
    await expect(avatar).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => avatar.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), { timeout: 20_000 })
      .toBeGreaterThan(0);
  });
});
