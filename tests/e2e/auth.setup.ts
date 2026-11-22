import { test as setup, expect } from '@playwright/test';
import { SEEDED_ACCOUNTS, type SeededRole } from './fixtures/session';

for (const role of Object.keys(SEEDED_ACCOUNTS) as SeededRole[]) {
  const account = SEEDED_ACCOUNTS[role];
  setup(`${role} login redirects to ${account.home}`, async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email|correo/i).fill(account.email);
    await page.getByLabel(/password|contraseña/i).fill(account.password);
    await page.getByRole('button', { name: /sign in|ingresar/i }).click();
    await expect(page).toHaveURL(new RegExp(account.home), { timeout: 10_000 });
    await page.context().storageState({ path: account.storageState });
  });
}
