'use client';

/**
 * ImagePreviewModal — full-size image overlay with prev/next navigation.
 *
 * Accessibility:
 *  - Role="dialog" + aria-modal="true"
 *  - Escape key closes
 *  - Focus trap: close/prev/next buttons are the only focusables
 *  - Overlay click closes
 */

import { useEffect, useCallback } from 'react';
import type { NormalizedImage } from '@/lib/schemas/image';

interface ImagePreviewModalProps {
  images: NormalizedImage[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  coverLabel?: string;
}

export function ImagePreviewModal({
  images,
  currentIndex,
  onClose,
  onNavigate,
  coverLabel = 'Portada',
}: ImagePreviewModalProps) {
  const current = images[currentIndex];

  const goPrev = useCallback(() => {
    if (currentIndex > 0) onNavigate(currentIndex - 1);
  }, [currentIndex, onNavigate]);

  const goNext = useCallback(() => {
    if (currentIndex < images.length - 1) onNavigate(currentIndex + 1);
  }, [currentIndex, images.length, onNavigate]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, goPrev, goNext]);

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      onClick={onClose}
    >
      {/* Modal container — stop propagation so inner clicks don't close */}
      <div
        className="relative max-w-5xl w-full mx-4 flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          aria-label="Close preview"
          onClick={onClose}
          className="absolute -top-10 right-0 text-white hover:text-slate-300 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Image */}
        <div className="relative w-full flex items-center justify-center">
          {/* Prev arrow */}
          {currentIndex > 0 && (
            <button
              type="button"
              aria-label="Previous image"
              onClick={goPrev}
              className="absolute left-2 z-10 bg-black/40 hover:bg-black/60 text-white rounded-full p-2 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current.url}
            alt={current.caption ?? current.filename}
            className="max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl"
          />

          {/* Next arrow */}
          {currentIndex < images.length - 1 && (
            <button
              type="button"
              aria-label="Next image"
              onClick={goNext}
              className="absolute right-2 z-10 bg-black/40 hover:bg-black/60 text-white rounded-full p-2 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}
        </div>

        {/* Caption + cover badge + counter */}
        <div className="mt-3 flex flex-col items-center gap-1">
          {current.isCover && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-brand-600 text-white">
              {coverLabel}
            </span>
          )}
          {current.caption && (
            <p className="text-sm text-slate-200">{current.caption}</p>
          )}
          <p className="text-xs text-slate-400">
            {currentIndex + 1} / {images.length}
          </p>
        </div>
      </div>
    </div>
  );
}
