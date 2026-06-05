// @vitest-environment jsdom

/**
 * tests/unit/components/ImageGallery.test.tsx
 *
 * Tests:
 *  1. Renders images as thumbnail buttons
 *  2. Cover image shows the "Portada" badge, others do not
 *  3. Renders EmptyImageState comment (null) when images array is empty
 *  4. Set-as-cover button is absent on the cover image
 *  5. Delete button present on all images
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ImageGallery } from '@/components/images/ImageGallery';
import type { NormalizedImage } from '@/lib/schemas/image';

// ---------------------------------------------------------------------------
// Mock window.confirm — ImageGallery uses window.confirm for delete
// ---------------------------------------------------------------------------

vi.stubGlobal('confirm', vi.fn(() => true));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeImage = (overrides: Partial<NormalizedImage> = {}): NormalizedImage => ({
  id: 'img-1',
  url: 'https://example.com/img.jpg',
  filename: 'img.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 1024,
  isCover: false,
  sortOrder: 0,
  createdAt: new Date().toISOString(),
  ...overrides,
});

const COVER = makeImage({ id: 'cover-1', isCover: true, sortOrder: 0 });
const NON_COVER_1 = makeImage({ id: 'nc-1', isCover: false, sortOrder: 1 });
const NON_COVER_2 = makeImage({ id: 'nc-2', isCover: false, sortOrder: 2 });

const LABELS = {
  setCover: 'Usar como portada',
  delete: 'Eliminar imagen',
  deleteConfirm: '¿Eliminar esta imagen?',
  cover: 'Portada',
};

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

function renderGallery(
  images: NormalizedImage[],
  onSetCover = vi.fn().mockResolvedValue({}),
  onDelete = vi.fn().mockResolvedValue({}),
) {
  const root = createRoot(container);
  act(() => {
    root.render(
      <ImageGallery
        images={images}
        onSetCover={onSetCover}
        onDelete={onDelete}
        labels={LABELS}
      />
    );
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImageGallery — rendering', () => {
  it('returns null (renders nothing) when images array is empty', () => {
    renderGallery([]);
    // Component returns null — container should have no meaningful child nodes
    expect(container.children.length).toBe(0);
  });

  it('renders one thumbnail per image', () => {
    renderGallery([COVER, NON_COVER_1, NON_COVER_2]);
    // Each thumbnail is a <button> wrapping an <img>
    const imgs = container.querySelectorAll('img');
    expect(imgs.length).toBe(3);
  });

  it('shows cover badge on the cover image', () => {
    renderGallery([COVER, NON_COVER_1]);
    // The badge text should appear
    const badges = container.querySelectorAll('[class*="bg-brand-600"]');
    const coverBadge = Array.from(badges).find((el) => el.textContent?.includes('Portada'));
    expect(coverBadge).toBeDefined();
  });

  it('does NOT show cover badge on non-cover images', () => {
    renderGallery([NON_COVER_1]);
    const badges = Array.from(container.querySelectorAll('[class*="bg-brand-600"]'));
    const coverBadge = badges.find((el) => el.textContent?.includes('Portada'));
    expect(coverBadge).toBeUndefined();
  });
});

describe('ImageGallery — set cover button', () => {
  it('set-cover button is absent on the cover image', () => {
    renderGallery([COVER]);
    // The set-cover button has aria-label = setCover label
    const btn = container.querySelector(`[aria-label="${LABELS.setCover}"]`);
    expect(btn).toBeNull();
  });

  it('set-cover button is present on non-cover images', () => {
    renderGallery([NON_COVER_1]);
    const btn = container.querySelector(`[aria-label="${LABELS.setCover}"]`);
    expect(btn).not.toBeNull();
  });
});

describe('ImageGallery — delete button', () => {
  it('renders a delete button for every image', () => {
    renderGallery([COVER, NON_COVER_1, NON_COVER_2]);
    const deleteBtns = container.querySelectorAll(`[aria-label="${LABELS.delete}"]`);
    expect(deleteBtns.length).toBe(3);
  });

  it('calls onDelete with the image id after confirm', async () => {
    const onDelete = vi.fn().mockResolvedValue({});
    renderGallery([NON_COVER_1], vi.fn().mockResolvedValue({}), onDelete);
    const btn = container.querySelector(`[aria-label="${LABELS.delete}"]`) as HTMLButtonElement;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onDelete).toHaveBeenCalledWith(NON_COVER_1.id);
  });
});
