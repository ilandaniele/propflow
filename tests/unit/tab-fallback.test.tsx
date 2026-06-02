/**
 * tests/unit/tab-fallback.test.tsx
 *
 * AC4 a11y test — verifies that <TabFallback /> renders a container with
 * role="status" and aria-label for screen readers, and does not throw.
 *
 * Uses jsdom environment so React.createElement / renderToStaticMarkup can run.
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TabFallback } from '@/components/ui/TabFallback';

describe('TabFallback — a11y attributes (AC4)', () => {
  it('renders without throwing', () => {
    expect(() => renderToStaticMarkup(<TabFallback />)).not.toThrow();
  });

  it('root element has role="status"', () => {
    const html = renderToStaticMarkup(<TabFallback />);
    expect(html).toContain('role="status"');
  });

  it('root element has aria-label="Loading tab content"', () => {
    const html = renderToStaticMarkup(<TabFallback />);
    expect(html).toContain('aria-label="Loading tab content"');
  });

  it('contains skeleton elements (animate-pulse)', () => {
    const html = renderToStaticMarkup(<TabFallback />);
    expect(html).toContain('animate-pulse');
  });

  it('renders multiple skeleton blocks for visual loading fidelity', () => {
    const html = renderToStaticMarkup(<TabFallback />);
    // At least 3 skeleton elements (card header + a few rows)
    const matches = html.match(/animate-pulse/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });
});
