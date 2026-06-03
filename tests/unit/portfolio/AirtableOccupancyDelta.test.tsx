/**
 * tests/unit/portfolio/AirtableOccupancyDelta.test.tsx
 *
 * Unit tests for the AirtableOccupancyDelta client component.
 *
 * Uses jsdom + React createRoot (no @testing-library/react needed) —
 * matching the existing project pattern in tests/unit/clickable-row.test.tsx.
 *
 * Key assertions:
 * - Renders nothing when snapshot is null (graceful empty state)
 * - Renders the delta card when snapshot is present
 * - Shows positive/negative delta pp values
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import {
  AirtableOccupancyDelta,
  type OccupancySnapshot,
} from '@/components/portfolio/AirtableOccupancyDelta';

const BASE_SNAPSHOT: OccupancySnapshot = {
  occupancyRate: 0.8,
  syncedAt: '2026-05-01T03:00:00Z',
};

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  document.body.removeChild(container);
});

function renderComponent(liveRate: number, snapshot: OccupancySnapshot | null) {
  act(() => {
    createRoot(container).render(
      <AirtableOccupancyDelta liveRate={liveRate} snapshot={snapshot} />
    );
  });
}

describe('AirtableOccupancyDelta', () => {
  describe('graceful empty state', () => {
    it('renders nothing when snapshot is null', () => {
      renderComponent(0.85, null);
      // Component should return null — container should have no children
      expect(container.querySelector('[data-testid="airtable-occupancy-delta"]')).toBeNull();
    });

    it('renders nothing regardless of liveRate when snapshot is null', () => {
      renderComponent(0, null);
      expect(container.querySelector('[data-testid="airtable-occupancy-delta"]')).toBeNull();
    });
  });

  describe('renders delta when snapshot is provided', () => {
    it('renders the delta card with correct data-testid', () => {
      renderComponent(0.85, BASE_SNAPSHOT);
      expect(
        container.querySelector('[data-testid="airtable-occupancy-delta"]')
      ).not.toBeNull();
    });

    it('shows positive delta when live > snapshot (0.85 − 0.80 = +5.0 pp)', () => {
      renderComponent(0.85, BASE_SNAPSHOT);
      const text = container.textContent ?? '';
      expect(text).toContain('+5.0 pp');
    });

    it('shows negative delta when live < snapshot (0.75 − 0.80 = -5.0 pp)', () => {
      renderComponent(0.75, BASE_SNAPSHOT);
      const text = container.textContent ?? '';
      expect(text).toContain('-5.0 pp');
    });

    it('shows zero delta as +0.0 pp when live equals snapshot', () => {
      renderComponent(0.8, BASE_SNAPSHOT);
      const text = container.textContent ?? '';
      expect(text).toContain('+0.0 pp');
    });

    it('includes both Airtable and Portal percentages in sub-label', () => {
      renderComponent(0.85, BASE_SNAPSHOT);
      const text = container.textContent ?? '';
      // snapshot.occupancyRate 0.80 → 80.0%; liveRate 0.85 → 85.0%
      expect(text).toContain('80.0%');
      expect(text).toContain('85.0%');
    });
  });
});
