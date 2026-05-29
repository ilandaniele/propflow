import { test, expect } from '@playwright/test';

test.describe('Public Landing Page', () => {
  test('unauthenticated visitor loads landing page (200, no redirect)', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    // Should NOT be on /login
    expect(page.url()).not.toContain('/login');
  });

  test('landing page renders hero with "Sign in" CTA linking to /login', async ({ page }) => {
    await page.goto('/');
    const signInLinks = await page.getByRole('link', { name: /sign in/i }).all();
    expect(signInLinks.length).toBeGreaterThan(0);
    // At least one CTA points to /login
    let hasLoginHref = false;
    for (const link of signInLinks) {
      const href = await link.getAttribute('href');
      if (href?.includes('/login')) { hasLoginHref = true; break; }
    }
    expect(hasLoginHref).toBe(true);
  });

  test('no public signup form on the landing page', async ({ page }) => {
    await page.goto('/');
    // There should be no registration/signup form
    const signupForms = await page.getByRole('button', { name: /sign up|register|create account/i }).all();
    expect(signupForms).toHaveLength(0);
  });

  test('"Sign in" CTA navigates to /login', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /sign in/i }).first().click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('landing is responsive on mobile viewport (no horizontal overflow)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(documentWidth).toBeLessThanOrEqual(viewportWidth + 5); // 5px tolerance

    // Hero and CTA should be visible
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /sign in/i }).first()).toBeVisible();
  });

  test('landing page has required meta tags for SEO', async ({ page }) => {
    await page.goto('/');
    const title = await page.title();
    expect(title).toBeTruthy();
    expect(title).not.toBe('');
  });
});

test.describe('Login Page', () => {
  test('loads the login page', async ({ page }) => {
    const response = await page.goto('/login');
    expect(response?.status()).toBe(200);
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
  });

  test('redirects unauthenticated users to login from dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('redirects unauthenticated users to login from portal', async ({ page }) => {
    await page.goto('/portal');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Accessibility — Landing & Login', () => {
  test('landing page passes basic a11y checks', async ({ page }) => {
    await page.goto('/');
    // Check for basic accessibility: skip-to-main, alt text, etc.
    const h1 = await page.getByRole('heading', { level: 1 }).first();
    await expect(h1).toBeVisible();

    // Navigation landmark should be present
    const nav = await page.getByRole('navigation').first();
    await expect(nav).toBeVisible();
  });

  test('login form has proper labels', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });
});
