// @vitest-environment jsdom

/**
 * tests/unit/components/TenantAvatar.test.tsx
 *
 * Tests:
 *  1. Renders an <img> when signedUrl is provided
 *  2. Renders initials (no <img>) when signedUrl is null/undefined
 *  3. Initials derived from the tenant name
 *  4. Uses size prop
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { TenantAvatar } from '@/app/dashboard/tenants/_components/TenantAvatar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  document.body.removeChild(container);
});

function renderAvatar(props: { name: string; signedUrl?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const root = createRoot(container);
  act(() => {
    root.render(<TenantAvatar {...props} />);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TenantAvatar — with photo', () => {
  it('renders an <img> element when signedUrl is provided', () => {
    renderAvatar({ name: 'Juan Perez', signedUrl: 'https://example.com/avatar.jpg' });
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.src).toBe('https://example.com/avatar.jpg');
  });

  it('uses the tenant name as alt text on the img', () => {
    renderAvatar({ name: 'Ana López', signedUrl: 'https://example.com/avatar.jpg' });
    const img = container.querySelector('img');
    expect(img?.alt).toContain('Ana López');
  });
});

describe('TenantAvatar — initials fallback', () => {
  it('renders initials when signedUrl is null', () => {
    renderAvatar({ name: 'Juan Perez', signedUrl: null });
    const img = container.querySelector('img');
    expect(img).toBeNull();
    expect(container.textContent).toContain('JP');
  });

  it('renders initials when signedUrl is undefined', () => {
    renderAvatar({ name: 'Maria Garcia' });
    const img = container.querySelector('img');
    expect(img).toBeNull();
    expect(container.textContent).toContain('MG');
  });

  it('renders ? for a tenant with no name', () => {
    renderAvatar({ name: '', signedUrl: null });
    expect(container.textContent).toContain('?');
  });

  it('uses only first two initials for a multi-word name', () => {
    renderAvatar({ name: 'Carlos Eduardo Martinez' });
    // Avatar extracts first 2 words
    expect(container.textContent).toContain('CE');
  });
});

describe('TenantAvatar — size prop', () => {
  it('applies sm size class when size=sm', () => {
    renderAvatar({ name: 'Test User', signedUrl: null, size: 'sm' });
    const el = container.firstElementChild as HTMLElement;
    expect(el?.className).toContain('h-7');
  });

  it('applies lg size class when size=lg', () => {
    renderAvatar({ name: 'Test User', signedUrl: null, size: 'lg' });
    const el = container.firstElementChild as HTMLElement;
    expect(el?.className).toContain('h-11');
  });
});
