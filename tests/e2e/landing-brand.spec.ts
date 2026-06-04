import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// AC6 + AC8 — Brand token verification on the public landing page
// Asserts that:
//   1. The hero primary CTA has the bg-brand-600 class (not violet/indigo)
//   2. No element on the page uses a class containing the substring "violet"
//   3. The nav logo mark uses the brand gradient (from-brand-500 / to-brand-700)
//   4. The H1 is present (smoke check)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('AC6 + AC8 — Landing page brand token verification', () => {
  test('hero primary CTA has bg-brand-600 class', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');

    // The hero primary CTA is an <a> rendered by Next.js Link with href="/login"
    // and class "... bg-brand-600 ...". The nav CTA also uses bg-brand-600, so
    // we locate specifically inside the hero section (section[aria-labelledby="hero-heading"]).
    const heroCta = page
      .locator('section[aria-labelledby="hero-heading"]')
      .locator('a.bg-brand-600, button.bg-brand-600')
      .first();

    await expect(heroCta).toBeVisible();

    const cls = await heroCta.getAttribute('class');
    expect(cls).toContain('bg-brand-600');
  });

  test('no element on the page has a class containing "violet"', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');

    // Walk every element in the DOM and collect any className strings that
    // contain the substring "violet". AC5 wiped violet-* from src/; this test
    // confirms nothing leaks back through SSR output.
    const violetClasses = await page.evaluate(() => {
      const all = document.querySelectorAll('*');
      const hits: string[] = [];
      all.forEach((el) => {
        const cls = el.getAttribute('class') ?? '';
        if (cls.includes('violet')) {
          hits.push(`${el.tagName.toLowerCase()}[class="${cls}"]`);
        }
      });
      return hits;
    });

    expect(violetClasses).toHaveLength(0);
  });

  test('nav logo mark uses brand gradient tokens (from-brand-500 and to-brand-700)', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');

    // The nav logo mark is a <div> inside the header <nav> with
    // class="... bg-gradient-to-br from-brand-500 to-brand-700 ..."
    const logoMark = page
      .locator('header')
      .locator('[class*="from-brand-500"]')
      .first();

    await expect(logoMark).toBeVisible();

    const cls = await logoMark.getAttribute('class');
    expect(cls).toContain('from-brand-500');
    expect(cls).toContain('to-brand-700');
  });

  test('landing page h1 is present and visible (smoke check)', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');

    const h1 = page.getByRole('heading', { level: 1 }).first();
    await expect(h1).toBeVisible();

    const text = await h1.innerText();
    expect(text.trim().length).toBeGreaterThan(0);
  });
});
