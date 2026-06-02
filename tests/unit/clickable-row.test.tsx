/**
 * tests/unit/clickable-row.test.tsx
 *
 * Verifies the ClickableRow client component:
 *  1. Renders its children inside a <tr>.
 *  2. Calls router.push(href) when the row itself is clicked.
 *  3. Does NOT call router.push when the click originates inside a nested
 *     <button> or <a> element (inner-control suppression).
 *  4. Calls router.push on keyboard Enter / Space.
 *  5. Does NOT navigate on other keys.
 *
 * Uses jsdom + React createRoot (no @testing-library/react needed) and
 * mocks next/navigation via vi.mock() — matching the existing pattern in
 * tests/unit/auth-callback.test.ts.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ClickableRow } from '@/components/ui/ClickableRow';

// ---------------------------------------------------------------------------
// Mock next/navigation — must use factory so hoisting works correctly
// ---------------------------------------------------------------------------

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let container: HTMLElement;

beforeEach(() => {
  mockPush.mockClear();
  container = document.createElement('table');
  document.body.appendChild(container);
});

afterEach(() => {
  document.body.removeChild(container);
});

function renderRow(
  href: string,
  children: React.ReactNode,
  className?: string,
) {
  const tbody = document.createElement('tbody');
  container.appendChild(tbody);
  const root = createRoot(tbody);
  act(() => {
    root.render(
      <ClickableRow href={href} className={className}>
        {children}
      </ClickableRow>,
    );
  });
  return tbody.querySelector('tr') as HTMLTableRowElement;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClickableRow — rendering', () => {
  it('renders a <tr> element', () => {
    const tr = renderRow('/dashboard/tenants/1', <td>Cell</td>);
    expect(tr.tagName).toBe('TR');
  });

  it('renders children inside the <tr>', () => {
    const tr = renderRow('/dashboard/tenants/1', <td data-testid="cell">Hello</td>);
    expect(tr.querySelector('[data-testid="cell"]')).not.toBeNull();
  });

  it('has tabIndex=0 for keyboard focus', () => {
    const tr = renderRow('/dashboard/tenants/1', <td>Cell</td>);
    expect(tr.tabIndex).toBe(0);
  });

  it('has cursor-pointer class', () => {
    const tr = renderRow('/dashboard/tenants/1', <td>Cell</td>);
    expect(tr.className).toContain('cursor-pointer');
  });

  it('merges a custom className', () => {
    const tr = renderRow('/dashboard/tenants/1', <td>Cell</td>, 'my-custom-class');
    expect(tr.className).toContain('my-custom-class');
  });
});

describe('ClickableRow — mouse click navigation', () => {
  it('calls router.push(href) when the row is clicked directly', () => {
    const tr = renderRow('/dashboard/tenants/42', <td>Name</td>);
    act(() => {
      tr.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(mockPush).toHaveBeenCalledOnce();
    expect(mockPush).toHaveBeenCalledWith('/dashboard/tenants/42');
  });

  it('calls router.push when a <td> (non-interactive) is clicked', () => {
    const tr = renderRow(
      '/dashboard/units/99',
      <td data-testid="td-cell">Unit label</td>,
    );
    const td = tr.querySelector('[data-testid="td-cell"]') as HTMLElement;
    act(() => {
      td.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(mockPush).toHaveBeenCalledOnce();
    expect(mockPush).toHaveBeenCalledWith('/dashboard/units/99');
  });

  it('does NOT call router.push when a <button> inside the row is clicked', () => {
    const tr = renderRow(
      '/dashboard/tenants/42',
      <td>
        <button data-testid="view-btn" type="button">View</button>
      </td>,
    );
    const btn = tr.querySelector('[data-testid="view-btn"]') as HTMLButtonElement;
    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does NOT call router.push when an <a> inside the row is clicked', () => {
    const tr = renderRow(
      '/dashboard/tenants/42',
      <td>
        <a href="/dashboard/tenants/42" data-testid="view-link">View</a>
      </td>,
    );
    const link = tr.querySelector('[data-testid="view-link"]') as HTMLAnchorElement;
    act(() => {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('ClickableRow — keyboard navigation', () => {
  it('calls router.push on Enter key', () => {
    const tr = renderRow('/dashboard/tenants/7', <td>Name</td>);
    act(() => {
      tr.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(mockPush).toHaveBeenCalledOnce();
    expect(mockPush).toHaveBeenCalledWith('/dashboard/tenants/7');
  });

  it('calls router.push on Space key', () => {
    const tr = renderRow('/dashboard/tenants/7', <td>Name</td>);
    act(() => {
      tr.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    expect(mockPush).toHaveBeenCalledOnce();
    expect(mockPush).toHaveBeenCalledWith('/dashboard/tenants/7');
  });

  it('does NOT call router.push on Tab key', () => {
    const tr = renderRow('/dashboard/tenants/7', <td>Name</td>);
    act(() => {
      tr.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does NOT call router.push on Escape key', () => {
    const tr = renderRow('/dashboard/tenants/7', <td>Name</td>);
    act(() => {
      tr.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});
