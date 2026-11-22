import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';

export const SEEDED_ACCOUNTS = {
  admin: {
    email: process.env.E2E_ADMIN_EMAIL ?? 'admin@org-a.demo',
    password: process.env.E2E_ADMIN_PASS ?? 'DemoAdmin123!',
    home: '/dashboard',
    storageState: 'tests/e2e/.auth/admin.json',
  },
  tenant: {
    email: process.env.E2E_TENANT_EMAIL ?? 'tenant@org-a.demo',
    password: process.env.E2E_TENANT_PASS ?? 'DemoTenant123!',
    home: '/portal',
    storageState: 'tests/e2e/.auth/tenant.json',
  },
} as const;

export type SeededRole = keyof typeof SEEDED_ACCOUNTS;

/**
 * Reuses the session that auth.setup.ts created through the real login form, so
 * specs that only need "a signed-in user" do not hammer the rate-limited POST /login.
 */
export async function signInAs(page: Page, role: SeededRole): Promise<void> {
  const account = SEEDED_ACCOUNTS[role];
  const { cookies } = JSON.parse(await readFile(account.storageState, 'utf8'));
  await page.context().addCookies(cookies);
  await page.goto(account.home);
}
