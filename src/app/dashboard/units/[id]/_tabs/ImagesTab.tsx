'use client';

/**
 * ImagesTab — full image management tab for a unit.
 *
 * Rendered as a Client Component so it can:
 *  - Hold upload/gallery state
 *  - Re-fetch images after mutation via router.refresh()
 *
 * Server-side data is fetched by the parent page (UnitDetailPage) and
 * passed in as the initial `images` prop to avoid an extra round-trip.
 * After mutations, router.refresh() triggers a full RSC re-render which
 * re-fetches and passes fresh data to this component.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ImageUploader } from '@/components/images/ImageUploader';
import { ImageGallery } from '@/components/images/ImageGallery';
import { EmptyImageState } from '@/components/images/EmptyImageState';
import {
  uploadUnitImage,
  setUnitCoverImage,
  deleteUnitImage,
} from '@/app/actions/unit-images';
import type { NormalizedImage } from '@/lib/schemas/image';

interface ImagesTabProps {
  unitId: string;
  initialImages: NormalizedImage[];
  labels: {
    upload: string;
    empty: string;
    setCover: string;
    delete: string;
    deleteConfirm: string;
    cover: string;
    invalidMime: string;
    fileTooLarge: string;
    uploadError: string;
  };
}

export function ImagesTab({ unitId, initialImages, labels }: ImagesTabProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [images, setImages] = useState<NormalizedImage[]>(initialImages);

  /** Sync local state from prop updates (after router.refresh()) */
  // Using a ref-based comparison would be over-engineering here; the page re-render
  // will re-mount this component with fresh initialImages after router.refresh().

  async function handleUpload(file: File) {
    const formData = new FormData();
    formData.append('unit_id', unitId);
    formData.append('file', file);
    formData.append('is_cover', images.length === 0 ? 'true' : 'false');

    const result = await uploadUnitImage({} as Parameters<typeof uploadUnitImage>[0], formData);

    if (!result.error) {
      // Optimistic: refresh RSC tree so initialImages updates
      startTransition(() => router.refresh());
    }
    return result;
  }

  async function handleSetCover(imageId: string) {
    const formData = new FormData();
    formData.append('id', imageId);

    const result = await setUnitCoverImage({} as Parameters<typeof setUnitCoverImage>[0], formData);

    if (!result.error) {
      // Optimistically update local state
      setImages((prev) =>
        prev.map((img) => ({ ...img, isCover: img.id === imageId }))
      );
      startTransition(() => router.refresh());
    }
    return result;
  }

  async function handleDelete(imageId: string) {
    const formData = new FormData();
    formData.append('id', imageId);

    const result = await deleteUnitImage({} as Parameters<typeof deleteUnitImage>[0], formData);

    if (!result.error) {
      // Optimistically remove from local state
      setImages((prev) => prev.filter((img) => img.id !== imageId));
      startTransition(() => router.refresh());
    }
    return result;
  }

  return (
    <div className="p-4 space-y-4">
      {/* Upload area */}
      <ImageUploader
        uploadLabel={labels.upload}
        invalidMimeMessage={labels.invalidMime}
        fileTooLargeMessage={labels.fileTooLarge}
        uploadErrorMessage={labels.uploadError}
        onUpload={handleUpload}
      />

      {/* Gallery or empty state */}
      {images.length === 0 ? (
        <EmptyImageState message={labels.empty} />
      ) : (
        <ImageGallery
          images={images}
          onSetCover={handleSetCover}
          onDelete={handleDelete}
          labels={{
            setCover: labels.setCover,
            delete: labels.delete,
            deleteConfirm: labels.deleteConfirm,
            cover: labels.cover,
          }}
        />
      )}
    </div>
  );
}
