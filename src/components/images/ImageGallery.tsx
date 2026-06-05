'use client';

/**
 * ImageGallery — responsive grid of thumbnail cards.
 *
 * Each card shows:
 *  - Thumbnail image
 *  - "Portada" badge if is_cover
 *  - Caption (if any)
 *  - Set as cover button
 *  - Delete button (with confirm dialog)
 *
 * Clicking a thumbnail opens the ImagePreviewModal.
 */

import { useState } from 'react';
import { ImagePreviewModal } from './ImagePreviewModal';
import { UnitCoverBadge } from './UnitCoverBadge';
import type { NormalizedImage } from '@/lib/schemas/image';

interface ImageGalleryProps {
  images: NormalizedImage[];
  /** Called when admin clicks "Set as cover" — returns Server Action result */
  onSetCover: (imageId: string) => Promise<{ error?: { code: string; message: string } } | void>;
  /** Called when admin confirms delete */
  onDelete: (imageId: string) => Promise<{ error?: { code: string; message: string } } | void>;
  /** i18n labels */
  labels: {
    setCover: string;
    delete: string;
    deleteConfirm: string;
    cover: string;
  };
}

export function ImageGallery({ images, onSetCover, onDelete, labels }: ImageGalleryProps) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null); // imageId of in-flight action

  async function handleSetCover(imageId: string) {
    setPendingAction(imageId);
    await onSetCover(imageId).catch(() => undefined);
    setPendingAction(null);
  }

  async function handleDelete(imageId: string) {
    if (!window.confirm(labels.deleteConfirm)) return;
    setPendingAction(imageId);
    await onDelete(imageId).catch(() => undefined);
    setPendingAction(null);
  }

  if (images.length === 0) return null;

  // Sort: cover first, then by sort_order
  const sorted = [...images].sort((a, b) => {
    if (a.isCover && !b.isCover) return -1;
    if (!a.isCover && b.isCover) return 1;
    return a.sortOrder - b.sortOrder;
  });

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {sorted.map((image, idx) => {
          const isLoading = pendingAction === image.id;
          return (
            <div
              key={image.id}
              className="relative group rounded-lg overflow-hidden border border-slate-200 bg-slate-50"
            >
              {/* Thumbnail */}
              <button
                type="button"
                className="w-full aspect-square relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                aria-label={image.caption ?? image.filename}
                onClick={() => setPreviewIndex(idx)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt={image.caption ?? image.filename}
                  className="w-full h-full object-cover"
                />
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
              </button>

              {/* Cover badge */}
              {image.isCover && (
                <div className="absolute top-2 left-2">
                  <UnitCoverBadge label={labels.cover} />
                </div>
              )}

              {/* Actions — visible on hover */}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-2 flex items-center justify-between gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {!image.isCover && (
                  <button
                    type="button"
                    disabled={isLoading}
                    aria-label={labels.setCover}
                    title={labels.setCover}
                    onClick={() => handleSetCover(image.id)}
                    className="flex items-center justify-center rounded bg-white/20 hover:bg-white/40 text-white p-1 transition-colors disabled:opacity-50"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                    </svg>
                  </button>
                )}
                <button
                  type="button"
                  disabled={isLoading}
                  aria-label={labels.delete}
                  title={labels.delete}
                  onClick={() => handleDelete(image.id)}
                  className="ml-auto flex items-center justify-center rounded bg-red-500/80 hover:bg-red-600 text-white p-1 transition-colors disabled:opacity-50"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              </div>

              {/* Loading overlay */}
              {isLoading && (
                <div className="absolute inset-0 bg-white/50 flex items-center justify-center">
                  <svg
                    className="animate-spin h-5 w-5 text-brand-600"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              )}

              {/* Caption */}
              {image.caption && (
                <p className="px-2 py-1 text-xs text-slate-500 truncate">{image.caption}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Preview modal */}
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
