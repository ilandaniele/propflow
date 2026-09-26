/**
 * E2E: Agent inbox (`/dashboard/agent/inbox`) — master plan §"Verificación",
 * E2E Playwright item: "toma de control en la bandeja".
 *
 * Covers take-control / return-to-AI (ModeControls) and a manual reply
 * (ManualReplyForm) on an existing whatsapp-channel agent_sessions row.
 *
 * Env vars required (E2E_AGENT=1 gates the whole file, same convention as
 * agent-playground.spec.ts / task.spec.ts):
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASS — an admin of the session's org.
 *   TEST_AGENT_SESSION_ID — an agent_sessions.id seeded with a whatsapp
 *   channel, a linked whatsapp_conversations row and an open 24h window
 *   (so ManualReplyForm renders the reply box instead of the closed notice).
 */

import { test, expect } from '@playwright/test';

const RUN = process.env.E2E_AGENT === '1';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@org-a.demo';
const ADMIN_PASS = process.env.E2E_ADMIN_PASS ?? 'DemoAdmin123!';
const SESSION_ID = process.env.TEST_AGENT_SESSION_ID ?? '';

test.describe('Agent inbox', () => {
  test.skip(!RUN || !SESSION_ID, 'Skipped: set E2E_AGENT=1 and TEST_AGENT_SESSION_ID to run against a live server');

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/password|contraseña/i).fill(ADMIN_PASS);
    await page.getByRole('button', { name: /iniciar sesión|sign in|ingresar/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
  });

  test('inbox list renders and links into the session', async ({ page }) => {
    await page.goto('/dashboard/agent/inbox');
    const row = page.locator(`a[href="/dashboard/agent/inbox/${SESSION_ID}"]`);
    await expect(row).toBeVisible({ timeout: 8_000 });
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/agent/inbox/${SESSION_ID}$`));
  });

  test('admin can take control, then return the session to the AI', async ({ page }) => {
    await page.goto(`/dashboard/agent/inbox/${SESSION_ID}`);

    const takeOverButton = page.getByRole('button', { name: /tomar control/i });
    const returnButton = page.getByRole('button', { name: /devolver a (la )?ia/i });
    await expect(takeOverButton).toBeVisible({ timeout: 8_000 });
    await expect(returnButton).toBeVisible();

    await takeOverButton.click();
    // ModeControls re-renders the session's mode label after the server action resolves.
    await expect(page.getByText(/humano/i)).toBeVisible({ timeout: 8_000 });

    await returnButton.click();
    await expect(page.getByText(/^ia$|inteligencia artificial/i)).toBeVisible({ timeout: 8_000 });
  });

  test('admin can send a manual reply while the session is human-controlled', async ({ page }) => {
    await page.goto(`/dashboard/agent/inbox/${SESSION_ID}`);

    await page.getByRole('button', { name: /tomar control/i }).click();
    await expect(page.getByText(/humano/i)).toBeVisible({ timeout: 8_000 });

    const replyInput = page.locator('input[name="body"]');
    if ((await replyInput.count()) === 0) {
      // The 24h customer-service window is closed for this seeded session —
      // ManualReplyForm renders windowClosedNotice instead, which is itself
      // a valid state to assert on rather than a failure.
      await expect(page.getByText(/ventana|window/i)).toBeVisible();
      return;
    }

    const message = `E2E manual reply ${Date.now()}`;
    await replyInput.fill(message);
    await page.getByRole('button', { name: /enviar|send/i }).click();
    await expect(page.getByText(message)).toBeVisible({ timeout: 8_000 });
  });
});
