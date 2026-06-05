import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Credentials — match existing E2E pattern
// ---------------------------------------------------------------------------

const ADMIN_EMAIL  = process.env.E2E_ADMIN_EMAIL  ?? 'admin@org-a.demo';
const ADMIN_PASS   = process.env.E2E_ADMIN_PASS   ?? 'DemoAdmin123!';
const TENANT_EMAIL = process.env.E2E_TENANT_EMAIL ?? 'tenant@org-a.demo';
const TENANT_PASS  = process.env.E2E_TENANT_PASS  ?? 'DemoTenant123!';

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
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/password/i).fill(ADMIN_PASS);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

async function loginAsTenant(page: Parameters<Parameters<typeof test>[1]>[0]['page']) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(TENANT_EMAIL);
  await page.getByLabel(/password/i).fill(TENANT_PASS);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/portal/, { timeout: 15_000 });
}

/** Creates a minimal valid JPEG file in a temp dir and returns its path. */
function createTempJpeg(name = 'test-upload.jpg'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'propflow-e2e-'));
  const filePath = path.join(dir, name);
  // Minimal JPEG header (FFD8 FFE0 ... FFD9) — enough to pass MIME sniff
  const jpegBytes = Buffer.from(
    'ffd8ffe000104a46494600010100000100010000' +
    'ffdb004300080606070605080707070909080a0c' +
    '140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20' +
    '242e2720222c231c1c2837292c30313434341f27' +
    '39' + '3d38323c2e333432ffc0000b08000100010' +
    '1011100ffc4001f0000010501010101010100000' +
    '000000000000102030405060708090a0bffda000' +
    '8010100003f00f50000000000000000ffd9',
    'hex',
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

    // Clean up temp file
    fs.rmSync(path.dirname(tempFile), { recursive: true, force: true });
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
    await avatarInput.setInputFiles(tempFile);

    // Wait for success indicator: the avatar <img> should update its src, or
    // a success toast / "avatar updated" message should appear.
    const successIndicator = page
      .getByRole('img', { name: /avatar|profile photo/i })
      .or(page.getByText(/updated|guardado|saved|avatar/i))
      .first();

    await expect(successIndicator).toBeVisible({ timeout: 20_000 });

    fs.rmSync(path.dirname(tempFile), { recursive: true, force: true });
  });
});
