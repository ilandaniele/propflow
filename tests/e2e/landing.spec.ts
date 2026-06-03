import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Existing landing page smoke tests (preserved)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Public Landing Page', () => {
  test('unauthenticated visitor loads landing page (200, no redirect)', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    expect(page.url()).not.toContain('/login');
  });

  test('landing page renders hero CTA linking to /login', async ({ page }) => {
    await page.goto('/');
    const signInLinks = await page.getByRole('link', { name: /iniciar sesión|sign in|entrar/i }).all();
    expect(signInLinks.length).toBeGreaterThan(0);
    let hasLoginHref = false;
    for (const link of signInLinks) {
      const href = await link.getAttribute('href');
      if (href?.includes('/login')) { hasLoginHref = true; break; }
    }
    expect(hasLoginHref).toBe(true);
  });

  test('no public signup form on the landing page', async ({ page }) => {
    await page.goto('/');
    const signupForms = await page.getByRole('button', { name: /sign up|register|create account|registrar/i }).all();
    expect(signupForms).toHaveLength(0);
  });

  test('"Sign in" CTA navigates to /login', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /iniciar sesión|sign in|entrar/i }).first().click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('landing is responsive on mobile viewport (no horizontal overflow)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(documentWidth).toBeLessThanOrEqual(viewportWidth + 5);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('landing page has required meta tags for SEO', async ({ page }) => {
    await page.goto('/');
    const title = await page.title();
    expect(title).toBeTruthy();
    expect(title).not.toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC9 — Landing renders Spanish hero by default (lang='es')
// ─────────────────────────────────────────────────────────────────────────────

test.describe('AC9 — Spanish hero by default', () => {
  test('HTML lang attribute is "es" by default (no locale cookie)', async ({ page }) => {
    // Clear any locale cookie to ensure default locale is used
    await page.context().clearCookies();
    await page.goto('/');
    const lang = await page.locator('html').getAttribute('lang');
    expect(lang).toBe('es');
  });

  test('renders Spanish hero headline from es.json', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    // AC9 requires t('landing.hero.headline') from es.json renders in HTML
    const headline =
      'Gestionar propiedades compartidas es complejo. Tus datos no deberían serlo.';
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Gestionar propiedades compartidas'
    );
    const body = await page.content();
    expect(body).toContain(headline);
  });

  test('hero subtitle is in Spanish', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    const body = await page.content();
    expect(body).toContain('Centralizá contratos');
  });

  test('primary CTA renders "Ver demo"', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    const ctaLinks = await page.getByRole('link', { name: /ver demo/i }).all();
    expect(ctaLinks.length).toBeGreaterThan(0);
  });

  test('secondary CTA renders "Conocer precios" linking to #pricing', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    const ctaLink = page.getByRole('link', { name: /conocer precios/i });
    await expect(ctaLink).toBeVisible();
    const href = await ctaLink.getAttribute('href');
    expect(href).toContain('#pricing');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC10 — Pricing section renders 3 tiers + monthly/annual toggle
// ─────────────────────────────────────────────────────────────────────────────

test.describe('AC10 — Pricing section with 3 tiers and toggle', () => {
  test('pricing section is present (#pricing anchor)', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    const section = page.locator('#pricing');
    await expect(section).toBeVisible();
  });

  test('renders exactly 3 pricing tier cards', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    const tiers = await page.locator('[data-testid="pricing-tier"]').all();
    expect(tiers).toHaveLength(3);
  });

  test('pricing tiers have Spanish names: Starter, Pro, Enterprise', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await expect(page.getByText('Starter')).toBeVisible();
    await expect(page.getByText('Pro')).toBeVisible();
    await expect(page.getByText('Enterprise')).toBeVisible();
  });

  test('each pricing tier has at least 4 bullet points', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    const tiers = page.locator('[data-testid="pricing-tier"]');
    const tierCount = await tiers.count();
    for (let i = 0; i < tierCount; i++) {
      const bullets = await tiers.nth(i).locator('li').count();
      expect(bullets).toBeGreaterThanOrEqual(4);
    }
  });

  test('monthly/annual toggle exists and is interactive', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    const toggle = page.getByRole('switch');
    await expect(toggle).toBeVisible();

    // Initially monthly (unchecked)
    const initialState = await toggle.getAttribute('aria-checked');
    expect(initialState).toBe('false');

    // Click to switch to annual
    await toggle.click();
    const afterClickState = await toggle.getAttribute('aria-checked');
    expect(afterClickState).toBe('true');
  });

  test('annual toggle shows discount badge', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    const toggle = page.getByRole('switch');
    await toggle.click();
    // Discount badge appears when annual is active
    await expect(page.getByText(/Ahorrá 20%/i)).toBeVisible();
  });

  test('Starter tier has Spanish CTA "Ver demo"', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    // The Starter pricing tier card contains a "Ver demo" CTA
    const starterCard = page.locator('[data-testid="pricing-tier"]').first();
    await expect(starterCard.getByText('Ver demo')).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC11 — At least 4 problem cards + dashboard preview + no hardcoded English
// ─────────────────────────────────────────────────────────────────────────────

test.describe('AC11 — Problem cards, dashboard preview, no hardcoded English', () => {
  test('renders at least 4 problem cards', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    const cards = await page.locator('[data-testid="problem-card"]').all();
    expect(cards.length).toBeGreaterThanOrEqual(4);
  });

  test('problem cards contain Spanish headings and body text', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    const body = await page.content();
    // Check for Spanish problem card headings
    expect(body).toContain('Puntos ciegos en pagos');
    expect(body).toContain('Costos ocultos de rotación');
    expect(body).toContain('Herramientas por propiedad');
    expect(body).toContain('Problemas operativos dispersos');
  });

  test('dashboard preview block is rendered', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    const preview = page.locator('[data-testid="dashboard-preview"]');
    await expect(preview).toBeVisible();
  });

  test('dashboard preview shows mock KPI labels in Spanish', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    const body = await page.content();
    // Spanish KPI label names from es.json
    expect(body).toContain('Ganancia Neta Real');
    expect(body).toContain('Ocupación');
    expect(body).toContain('Incidentes Abiertos');
    expect(body).toContain('Balance Vencido');
  });

  test('features section has 14 chips', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    const chips = await page.locator('[data-testid="feature-chip"]').all();
    expect(chips.length).toBe(14);
  });

  test('page.tsx has no hardcoded English strings in rendered output', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    const body = await page.content();

    // These hardcoded English phrases were in the OLD page.tsx — must not appear
    const forbiddenStrings = [
      'Property management, built right',
      'Everything your team needs',
      'From portfolio overview to tenant incidents',
      'Multi-property Management',
      'Contracts &amp; Tenants',
      'Payments &amp; Account Statements',
      'Incident Tracking',
      'PropFlow gives property managers',
      'Ready to get started?',
      'PropFlow is currently in private access',
    ];
    for (const forbidden of forbiddenStrings) {
      expect(body).not.toContain(forbidden);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Login Page (preserved)
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Accessibility — Landing & Login (preserved)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Accessibility — Landing & Login', () => {
  test('landing page passes basic a11y checks', async ({ page }) => {
    await page.goto('/');
    const h1 = page.getByRole('heading', { level: 1 }).first();
    await expect(h1).toBeVisible();
    const nav = page.getByRole('navigation').first();
    await expect(nav).toBeVisible();
  });

  test('login form has proper labels', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });
});
