'use client';

/**
 * AvatarUploader — compact tenant self-service avatar uploader.
 *
 * Shows current photo (or initials fallback) as a circle.
 * Provides "Cambiar foto" / "Eliminar foto" buttons.
 * Validates MIME type + 5 MB cap client-side before calling Server Actions.
 * Calls updateOwnTenantAvatar / deleteOwnTenantAvatar Server Actions.
 *
 * Security: the actual auth + IDOR enforcement is in the Server Actions.
 * This component only does client-side pre-flight validation (UX, not security boundary).
 */

import { useRef, useState, useTransition } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { updateOwnTenantAvatar, deleteOwnTenantAvatar } from '@/app/actions/tenants';
import type { ActionResult } from '@/lib/errors';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_SIZE_BYTES = 5_242_880; // 5 MB

interface AvatarUploaderProps {
  /** Tenant's display name — used for initials fallback */
  name: string;
  /** Current signed URL for the avatar, or null if no photo */
  currentUrl?: string | null;
  labels: {
    changePhoto: string;
    removePhoto: string;
    uploadHint: string;
    invalidMime: string;
    fileTooLarge: string;
    uploadError: string;
    removeError: string;
  };
}

export function AvatarUploader({ name, currentUrl, labels }: AvatarUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const [isUploading, startUpload] = useTransition();
  const [isRemoving, startRemove] = useTransition();

  // Effective displayed URL: preview > currentUrl
  const displayUrl = preview ?? currentUrl ?? null;
  const hasPhoto = displayUrl !== null;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!e.target.files) return;
    // Reset input so the same file can be re-selected after an error
    e.target.value = '';

    if (!file) return;

    setClientError(null);
    setServerError(null);

    // Client-side pre-flight validation (mirrors server-side checks)
    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
      setClientError(labels.invalidMime);
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setClientError(labels.fileTooLarge);
      return;
    }

    // Show optimistic preview
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);

    const formData = new FormData();
    formData.append('file', file);

    startUpload(async () => {
      const result: ActionResult = await updateOwnTenantAvatar({}, formData);
      if (result.error) {
        // Revert optimistic preview
        setPreview(null);
        URL.revokeObjectURL(objectUrl);
        setServerError(labels.uploadError);
      }
      // On success the page revalidates via revalidatePath in the action;
      // the preview stays until the Server Component refreshes with the real signed URL.
    });
  }

  function handleRemove() {
    setClientError(null);
    setServerError(null);

    startRemove(async () => {
      const result: ActionResult = await deleteOwnTenantAvatar({});
      if (result.error) {
        setServerError(labels.removeError);
      } else {
        setPreview(null);
      }
    });
  }

  const isPending = isUploading || isRemoving;

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Avatar circle */}
      <div className="relative">
        <Avatar
          name={name}
          src={displayUrl ?? undefined}
          size="lg"
          className={[
            'h-20 w-20 text-xl',
            isPending ? 'opacity-60' : '',
          ].join(' ')}
        />
        {isPending && (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-full bg-white/50"
            aria-label="Cargando…"
          >
            <svg
              className="h-5 w-5 animate-spin text-brand-600"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          </div>
        )}
      </div>

      {/* Hint */}
      <p className="text-xs text-slate-400 text-center">{labels.uploadHint}</p>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => fileInputRef.current?.click()}
          className="text-sm font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50 px-3 py-1.5 rounded-md border border-brand-200 hover:bg-brand-50 transition-colors"
        >
          {labels.changePhoto}
        </button>

        {hasPhoto && (
          <button
            type="button"
            disabled={isPending}
            onClick={handleRemove}
            className="text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50 px-3 py-1.5 rounded-md border border-red-200 hover:bg-red-50 transition-colors"
          >
            {labels.removePhoto}
          </button>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        aria-hidden="true"
        onChange={handleFileChange}
        data-testid="avatar-file-input"
      />

      {/* Error messages */}
      {(clientError ?? serverError) && (
        <p
          role="alert"
          className="text-xs text-red-600 text-center max-w-xs"
        >
          {clientError ?? serverError}
        </p>
      )}
    </div>
  );
}
