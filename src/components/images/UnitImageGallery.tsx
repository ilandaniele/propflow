'use client';

/**
 * UnitImageGallery — read-only image gallery for tenant portal.
 *
 * Simpler than the admin ImageGallery: no cover/delete/reorder controls.
 * Shows cover image prominently first, remaining images as thumbnails.
 * Clicking any image opens the ImagePreviewModal.
 * Renders EmptyImageState when no images exist.
 *
 * This component receives pre-fetched NormalizedImage[] from a Server Component
 * parent (no data fetching here — IDOR is enforced in getUnitImagesTenant).
 */

import { useState } from 'react';
import { ImagePreviewModal } from './ImagePreviewModal';
import { EmptyImageState } from './EmptyImageState';
import type { NormalizedImage } from '@/lib/schemas/image';

interface UnitImageGalleryProps {
  images: NormalizedImage[];
  labels: {
    cover: string;
    empty: string;
  };
}

export function UnitImageGallery({ images, labels }: UnitImageGalleryProps) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  if (images.length === 0) {
    return <EmptyImageState message={labels.empty} />;
  }

  // Sort: cover first, then by sort_order
  const sorted = [...images].sort((a, b) => {
    if (a.isCover && !b.isCover) return -1;
    if (!a.isCover && b.isCover) return 1;
    return a.sortOrder - b.sortOrder;
  });

  const cover = sorted[0];
  const rest = sorted.slice(1);

  return (
    <>
      <div className="space-y-3">
        {/* Cover image — prominent full-width display */}
        <button
          type="button"
          className="w-full rounded-xl overflow-hidden border border-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 relative"
          onClick={() => setPreviewIndex(0)}
          aria-label={cover.caption ?? cover.filename}
          data-testid="cover-image-button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cover.url}
            alt={cover.caption ?? cover.filename}
            className="w-full aspect-video object-cover"
          />
          {cover.isCover && (
            <span className="absolute top-2 left-2 bg-brand-600 text-white text-xs font-medium px-2 py-0.5 rounded-full">
              {labels.cover}
            </span>
          )}
          {cover.caption && (
            <p className="absolute bottom-0 left-0 right-0 bg-black/40 text-white text-xs px-3 py-1.5 text-left truncate">
              {cover.caption}
            </p>
          )}
        </button>

        {/* Thumbnail grid for remaining images */}
        {rest.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {rest.map((image, idx) => (
              <button
                key={image.id}
                type="button"
                className="rounded-lg overflow-hidden border border-slate-200 aspect-square focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                onClick={() => setPreviewIndex(idx + 1)}
                aria-label={image.caption ?? image.filename}
                data-testid={`gallery-thumb-${idx}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt={image.caption ?? image.filename}
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Full-screen preview modal */}
      {previewIndex !== null && (
        <ImagePreviewModal
          images={sorted}
          currentIndex={previewIndex}
          onClose={() => setPreviewIndex(null)}
          onNavigate={setPreviewIndex}
          coverLabel={labels.cover}
        />
      )}
    </>
  );
}
