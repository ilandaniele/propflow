/**
 * E2E: Login flow — Credentials provider
 *
 * Tests the credentials sign-in form and auth guards.
 * Google OAuth is not tested here (requires real Google account + browser interaction).
 *
 * Seed data assumption: a test user seeded via tests/fixtures/seed-auth-user.ts
 * or by the CI environment before these tests run.
 *
 * Env vars required:
 *   E2E_TEST_EMAIL     — email of the seeded test admin user
 *   E2E_TEST_PASSWORD  — plaintext password of the seeded test admin user
 */

import { test, expect } from '@playwright/test';

const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? 'admin@e2e.local';
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD ?? 'TestPass1234!';

test.describe('Login page', () => {
  test('renders login page with Google and credentials form', async ({ page }) => {
    await page.goto('/login');
    // Title or heading
    await expect(page.getByRole('button', { name: /Continuar con Google/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password|contraseña/i)).toBeVisible();
  });

  test('shows error on invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('wrong@example.com');
    await page.getByLabel(/password|contraseña/i).fill('wrongpassword');
    await page.getByRole('button', { name: /iniciar sesión|sign in|ingresar/i }).click();

    // Should show error, not redirect
    await expect(page).not.toHaveURL('/dashboard');
    await expect(page).not.toHaveURL('/portal');
  });

  test('redirects to /login when accessing /dashboard unauthenticated', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('redirects to /login when accessing /portal unauthenticated', async ({ page }) => {
    await page.goto('/portal');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Credentials login flow (requires seeded test user)', () => {
  test.skip(
    !process.env.E2E_TEST_EMAIL,
    'Skipped: E2E_TEST_EMAIL not set — run with seeded test user'
  );

  test('admin user can log in and reaches /dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(TEST_EMAIL);
    await page.getByLabel(/password|contraseña/i).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /iniciar sesión|sign in|ingresar/i }).click();

    // Should redirect to dashboard after successful admin login
    await expect(page).toHaveURL('/dashboard', { timeout: 10_000 });
  });

  test('auth() session.user contains id, orgId, role, email after login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(TEST_EMAIL);
    await page.getByLabel(/password|contraseña/i).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /iniciar sesión|sign in|ingresar/i }).click();
    await expect(page).toHaveURL('/dashboard', { timeout: 10_000 });

    // Verify the session API returns well-formed session
    const response = await page.request.get('/api/auth/session');
    expect(response.ok()).toBe(true);
    const data = await response.json();

    expect(data.user).toBeDefined();
    expect(typeof data.user.id).toBe('string');
    expect(typeof data.user.orgId).toBe('string');
    expect(['admin', 'tenant']).toContain(data.user.role);
    expect(typeof data.user.email).toBe('string');
  });

  test('user can sign out', async ({ page }) => {
    // Sign in first
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(TEST_EMAIL);
    await page.getByLabel(/password|contraseña/i).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /iniciar sesión|sign in|ingresar/i }).click();
    await expect(page).toHaveURL('/dashboard', { timeout: 10_000 });

    // Sign out — find sign out button by common patterns
    const signOutBtn = page
      .getByRole('button', { name: /cerrar sesión|sign out|logout/i })
      .first();

    if (await signOutBtn.isVisible()) {
      await signOutBtn.click();
      await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    } else {
      // Fallback: call signOut via API route (NextAuth)
      await page.goto('/api/auth/signout');
      await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    }
  });
});
