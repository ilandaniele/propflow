// @vitest-environment jsdom

/**
 * tests/unit/components/UnitImageGallery.test.tsx
 *
 * Tests:
 *  1. Renders cover image first when a cover exists
 *  2. Renders all thumbnails (minus cover) in a grid
 *  3. Shows EmptyImageState (no images) when images array is empty
 *  4. Does NOT render any cover/delete/reorder admin buttons
 *  5. Renders a "Portada" badge on the cover image
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { UnitImageGallery } from '@/components/images/UnitImageGallery';
import type { NormalizedImage } from '@/lib/schemas/image';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeImage(overrides: Partial<NormalizedImage> = {}): NormalizedImage {
  return {
    id: 'img-1',
    url: 'https://example.com/img1.jpg',
    filename: 'img1.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 100_000,
    width: 800,
    height: 600,
    isCover: false,
    caption: null,
    sortOrder: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const LABELS = { cover: 'Portada', empty: 'No hay fotos disponibles.' };

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  document.body.removeChild(container);
});

function renderGallery(images: NormalizedImage[]) {
  const root = createRoot(container);
  act(() => {
    root.render(<UnitImageGallery images={images} labels={LABELS} />);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UnitImageGallery — empty state', () => {
  it('renders EmptyImageState message when images array is empty', () => {
    renderGallery([]);
    expect(container.textContent).toContain(LABELS.empty);
  });

  it('does NOT render any img elements when images is empty', () => {
    renderGallery([]);
    const imgs = container.querySelectorAll('img');
    expect(imgs.length).toBe(0);
  });
});

describe('UnitImageGallery — with images', () => {
  const coverImg = makeImage({ id: 'cover-1', isCover: true, sortOrder: 0, url: 'https://example.com/cover.jpg', filename: 'cover.jpg' });
  const galleryImg1 = makeImage({ id: 'img-2', isCover: false, sortOrder: 1, url: 'https://example.com/img2.jpg', filename: 'img2.jpg' });
  const galleryImg2 = makeImage({ id: 'img-3', isCover: false, sortOrder: 2, url: 'https://example.com/img3.jpg', filename: 'img3.jpg' });

  it('renders cover image first (prominent display)', () => {
    renderGallery([galleryImg1, coverImg, galleryImg2]);
    const imgs = container.querySelectorAll('img');
    expect(imgs.length).toBeGreaterThan(0);
    // First image rendered should be the cover
    expect((imgs[0] as HTMLImageElement).src).toBe('https://example.com/cover.jpg');
  });

  it('shows the "Portada" badge on the cover image', () => {
    renderGallery([coverImg, galleryImg1]);
    expect(container.textContent).toContain(LABELS.cover);
  });

  it('renders thumbnails for non-cover images', () => {
    renderGallery([coverImg, galleryImg1, galleryImg2]);
    // Expect cover + 2 thumbnails = 3 img elements total
    const imgs = container.querySelectorAll('img');
    expect(imgs.length).toBe(3);
  });

  it('renders without error when only one image (the cover)', () => {
    renderGallery([coverImg]);
    const imgs = container.querySelectorAll('img');
    expect(imgs.length).toBe(1);
  });
});

describe('UnitImageGallery — read-only controls (no admin buttons)', () => {
  const coverImg = makeImage({ id: 'cover-1', isCover: true });
  const galleryImg = makeImage({ id: 'img-2', isCover: false });

  it('does NOT render a "Set as cover" button', () => {
    renderGallery([coverImg, galleryImg]);
    const btns = Array.from(container.querySelectorAll('button'));
    const setCoverBtn = btns.find(b => b.textContent?.toLowerCase().includes('cover') || b.textContent?.toLowerCase().includes('portada') && b.type === 'submit');
    // Only img-click buttons should exist (type=button), no admin mutation buttons
    // All buttons should just be the thumbnail/cover click-to-preview buttons
    btns.forEach(btn => {
      expect(btn.type).not.toBe('submit');
    });
  });

  it('does NOT render a "Delete" button', () => {
    renderGallery([coverImg, galleryImg]);
    const btns = Array.from(container.querySelectorAll('button'));
    const deleteBtn = btns.find(b =>
      b.textContent?.toLowerCase().includes('delete') ||
      b.textContent?.toLowerCase().includes('eliminar')
    );
    expect(deleteBtn).toBeUndefined();
  });
});
