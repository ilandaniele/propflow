/**
 * Global vitest setup — runs before each test file.
 *
 * next-auth@beta ships lib/env.js as ESM with a bare `import { NextRequest } from "next/server"`
 * specifier. Node's native ESM resolver requires the .js extension; without it, resolution
 * fails on Windows with hoisted pnpm node_modules.
 *
 * We mock the specific problematic modules so the ESM resolution never triggers.
 * Tests that need auth behavior mock @/lib/auth/guards or @/auth directly.
 */

import { vi } from 'vitest';

vi.mock('next-auth', () => ({
  default: vi.fn(() => ({
    handlers: { GET: vi.fn(), POST: vi.fn() },
    auth:     vi.fn(),
    signIn:   vi.fn(),
    signOut:  vi.fn(),
  })),
}));

vi.mock('next-auth/providers/google', () => ({
  default: vi.fn(() => ({ id: 'google', type: 'oauth' })),
}));

vi.mock('next-auth/providers/credentials', () => ({
  default: vi.fn(() => ({ id: 'credentials', type: 'credentials' })),
}));

vi.mock('next-auth/react', () => ({
  signIn:           vi.fn(),
  signOut:          vi.fn(),
  useSession:       vi.fn(() => ({ data: null, status: 'unauthenticated' })),
  SessionProvider:  vi.fn(({ children }: { children: unknown }) => children),
}));
