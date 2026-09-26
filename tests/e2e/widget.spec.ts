/**
 * End-to-end smoke test for the embeddable widget (§5 "C").
 *
 * Serves tests/e2e/fixtures/widget-host.html on a second, throwaway HTTP
 * server (a different origin/port than the Next app under test) so the
 * loader's cross-origin embedding and the iframe's origin/CSP checks are
 * exercised for real, not just same-origin.
 *
 * NOTE (handoff): this spec needs a real org with public_pages_enabled /
 * channels_enabled.web=true and a known publicKey + allowed origin seeded
 * in the DB the Playwright webServer boots against (see the blueprint's
 * "Live checks" §5). This sandbox has no such seeded org/DB, so this file
 * is written but not executed here — see the handback report.
 */

import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const HOST_PORT = 4173;

// Set these to a real org's web-channel publicKey + allowed origin before running
// against a seeded environment (see NOTE above).
const PUBLIC_KEY = process.env.E2E_WIDGET_PUBLIC_KEY ?? 'pk_TESTTESTTESTTESTTESTTEST';
const ALLOWED_HOST_ORIGIN = `http://localhost:${HOST_PORT}`;

let hostServer: Server;

test.beforeAll(async () => {
  const template = readFileSync(path.join(__dirname, 'fixtures', 'widget-host.html'), 'utf8');
  const html = template
    .replace('{{WIDGET_JS_URL}}', `${process.env.BASE_URL ?? 'http://localhost:3000'}/widget.js`)
    .replace('{{PUBLIC_KEY}}', PUBLIC_KEY);

  hostServer = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((resolve) => hostServer.listen(HOST_PORT, resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => hostServer.close(() => resolve()));
});

test.describe('widget embed', () => {
  test('the launcher opens the iframe and a mocked turn renders a reply', async ({ page }) => {
    // Mock the two JSON endpoints so the test doesn't depend on a seeded DB/model.
    await page.route('**/api/agent/web/session', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'wst_e2efaketoken', expiresAt: new Date(Date.now() + 3600_000).toISOString(), greeting: 'Hola!', orgName: 'Acme', whatsappAvailable: true }),
      });
    });
    await page.route('**/api/agent/web/messages', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ reply: 'Hola, ¿en qué te ayudo?', mode: 'ai', cta: null }),
      });
    });

    await page.goto(`${ALLOWED_HOST_ORIGIN}/widget-host.html`).catch(() => {});
    await page.goto('about:blank');
    await page.setContent(readFileSync(path.join(__dirname, 'fixtures', 'widget-host.html'), 'utf8')
      .replace('{{WIDGET_JS_URL}}', `${process.env.BASE_URL ?? 'http://localhost:3000'}/widget.js`)
      .replace('{{PUBLIC_KEY}}', PUBLIC_KEY));

    const launcher = page.getByRole('button', { name: /abrir chat/i });
    await expect(launcher).toBeVisible({ timeout: 15_000 });
    await launcher.click();

    const iframe = page.frameLocator('iframe[title="Chat"]');
    await iframe.locator('#pf-input').fill('Hola, busco un depa');
    await iframe.locator('#pf-form button[type="submit"]').click();
    await expect(iframe.locator('.pf-bubble-assistant').last()).toContainText('¿en qué te ayudo?', { timeout: 15_000 });
  });

  test('a host whose origin is not in the org allow-list gets a blocked frame (CSP frame-ancestors)', async ({ page }) => {
    const cspErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /content security policy|frame-ancestors/i.test(msg.text())) cspErrors.push(msg.text());
    });

    await page.setContent(`<!DOCTYPE html><html><body>
      <iframe title="Chat" src="${process.env.BASE_URL ?? 'http://localhost:3000'}/widget/${PUBLIC_KEY}"></iframe>
    </body></html>`, { baseURL: 'http://not-an-allowed-origin.invalid' });

    // The iframe never gets a document from the app (frame-ancestors blocks it) —
    // its contentDocument stays about:blank/empty rather than the widget UI.
    const frameEl = page.locator('iframe[title="Chat"]');
    await expect(frameEl).toBeAttached();
    const frame = await frameEl.elementHandle().then((h) => h?.contentFrame());
    const hasForm = await frame?.locator('#pf-form').count().catch(() => 0);
    expect(hasForm ?? 0).toBe(0);
  });
});
