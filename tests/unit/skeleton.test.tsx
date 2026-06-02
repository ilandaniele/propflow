/**
 * tests/unit/skeleton.test.tsx
 *
 * Verifies the Skeleton primitive components render without throwing and
 * expose the correct accessibility / loading signals expected by WCAG and
 * the spec (AC1 foundation).
 *
 * Uses renderToStaticMarkup so we never need a DOM or React root — matching
 * the existing tab-fallback.test.tsx pattern in this repo.
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Skeleton,
  SkeletonText,
  SkeletonCard,
  SkeletonLine,
  SkeletonTable,
  SkeletonCardGrid,
  SkeletonStats,
  SkeletonDetailCard,
} from '@/components/ui/Skeleton';

// ---------------------------------------------------------------------------
// Base primitives (pre-existing; confirm they still work after extension)
// ---------------------------------------------------------------------------

describe('Skeleton (base primitive)', () => {
  it('renders without throwing', () => {
    expect(() => renderToStaticMarkup(<Skeleton />)).not.toThrow();
  });

  it('contains animate-pulse class', () => {
    const html = renderToStaticMarkup(<Skeleton />);
    expect(html).toContain('animate-pulse');
  });

  it('accepts a custom className', () => {
    const html = renderToStaticMarkup(<Skeleton className="h-4 w-32" />);
    expect(html).toContain('h-4');
    expect(html).toContain('w-32');
  });
});

describe('SkeletonText', () => {
  it('renders the default 3 lines', () => {
    const html = renderToStaticMarkup(<SkeletonText />);
    const matches = html.match(/animate-pulse/g) ?? [];
    expect(matches.length).toBe(3);
  });

  it('renders a custom number of lines', () => {
    const html = renderToStaticMarkup(<SkeletonText lines={5} />);
    const matches = html.match(/animate-pulse/g) ?? [];
    expect(matches.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// SkeletonLine
// ---------------------------------------------------------------------------

describe('SkeletonLine', () => {
  it('renders without throwing', () => {
    expect(() => renderToStaticMarkup(<SkeletonLine />)).not.toThrow();
  });

  it('contains animate-pulse', () => {
    const html = renderToStaticMarkup(<SkeletonLine />);
    expect(html).toContain('animate-pulse');
  });

  it('accepts a custom className', () => {
    const html = renderToStaticMarkup(<SkeletonLine className="w-1/2" />);
    expect(html).toContain('w-1/2');
  });
});

// ---------------------------------------------------------------------------
// SkeletonTable
// ---------------------------------------------------------------------------

describe('SkeletonTable', () => {
  it('renders without throwing', () => {
    expect(() => renderToStaticMarkup(<SkeletonTable />)).not.toThrow();
  });

  it('has role="status" for screen-reader announcement', () => {
    const html = renderToStaticMarkup(<SkeletonTable />);
    expect(html).toContain('role="status"');
  });

  it('has aria-label describing what is loading', () => {
    const html = renderToStaticMarkup(<SkeletonTable />);
    expect(html).toContain('aria-label="Loading table"');
  });

  it('has aria-busy="true"', () => {
    const html = renderToStaticMarkup(<SkeletonTable />);
    expect(html).toContain('aria-busy="true"');
  });

  it('renders at least (rows × cols) skeleton elements by default (5 rows × 4 cols + 4 header = 24)', () => {
    const html = renderToStaticMarkup(<SkeletonTable rows={5} cols={4} />);
    const matches = html.match(/animate-pulse/g) ?? [];
    // 4 header cols + 5 rows × 4 cols = 24
    expect(matches.length).toBe(24);
  });

  it('respects custom rows and cols props', () => {
    const html = renderToStaticMarkup(<SkeletonTable rows={3} cols={2} />);
    const matches = html.match(/animate-pulse/g) ?? [];
    // 2 header cols + 3 rows × 2 cols = 8
    expect(matches.length).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// SkeletonCardGrid
// ---------------------------------------------------------------------------

describe('SkeletonCardGrid', () => {
  it('renders without throwing', () => {
    expect(() => renderToStaticMarkup(<SkeletonCardGrid />)).not.toThrow();
  });

  it('has role="status"', () => {
    const html = renderToStaticMarkup(<SkeletonCardGrid />);
    expect(html).toContain('role="status"');
  });

  it('has aria-label describing what is loading', () => {
    const html = renderToStaticMarkup(<SkeletonCardGrid />);
    expect(html).toContain('aria-label="Loading cards"');
  });

  it('renders the default 6 cards', () => {
    // Each card has 4 skeleton blocks (title, badge, line1, line2)
    const html = renderToStaticMarkup(<SkeletonCardGrid cards={6} />);
    const matches = html.match(/animate-pulse/g) ?? [];
    // 6 cards × 4 skeletons each = 24
    expect(matches.length).toBe(24);
  });

  it('respects the cards prop', () => {
    const html = renderToStaticMarkup(<SkeletonCardGrid cards={3} />);
    const matches = html.match(/animate-pulse/g) ?? [];
    // 3 × 4 = 12
    expect(matches.length).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// SkeletonStats
// ---------------------------------------------------------------------------

describe('SkeletonStats', () => {
  it('renders without throwing', () => {
    expect(() => renderToStaticMarkup(<SkeletonStats />)).not.toThrow();
  });

  it('has role="status"', () => {
    const html = renderToStaticMarkup(<SkeletonStats />);
    expect(html).toContain('role="status"');
  });

  it('has aria-label describing what is loading', () => {
    const html = renderToStaticMarkup(<SkeletonStats />);
    expect(html).toContain('aria-label="Loading statistics"');
  });

  it('renders 4 stat cards by default', () => {
    // Each stat card has 4 skeleton blocks (label, icon, value, sub-label)
    const html = renderToStaticMarkup(<SkeletonStats count={4} />);
    const matches = html.match(/animate-pulse/g) ?? [];
    // 4 cards × 4 skeletons = 16
    expect(matches.length).toBe(16);
  });

  it('respects a custom count', () => {
    const html = renderToStaticMarkup(<SkeletonStats count={2} />);
    const matches = html.match(/animate-pulse/g) ?? [];
    // 2 × 4 = 8
    expect(matches.length).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// SkeletonDetailCard
// ---------------------------------------------------------------------------

describe('SkeletonDetailCard', () => {
  it('renders without throwing', () => {
    expect(() => renderToStaticMarkup(<SkeletonDetailCard />)).not.toThrow();
  });

  it('has role="status"', () => {
    const html = renderToStaticMarkup(<SkeletonDetailCard />);
    expect(html).toContain('role="status"');
  });

  it('has aria-label describing what is loading', () => {
    const html = renderToStaticMarkup(<SkeletonDetailCard />);
    expect(html).toContain('aria-label="Loading detail"');
  });

  it('renders multiple skeleton blocks for visual loading fidelity', () => {
    const html = renderToStaticMarkup(<SkeletonDetailCard />);
    const matches = html.match(/animate-pulse/g) ?? [];
    // header (2) + 5 field rows × 2 each = 12
    expect(matches.length).toBeGreaterThanOrEqual(8);
  });
});
