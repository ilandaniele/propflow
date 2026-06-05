'use client';

/**
 * ImageUploader — file picker with client-side validation + upload progress.
 *
 * Validation before hitting the Server Action:
 *  - MIME type: image/jpeg, image/png, image/webp (client-side guard; server re-validates)
 *  - File size: ≤ 5 MB (5_242_880 bytes)
 *
 * On valid file selection the component calls the onUpload callback, which
 * should call the uploadUnitImage Server Action.  The parent component is
 * responsible for refreshing the gallery after upload.
 */

import { useRef, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/Button';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_FILE_SIZE_BYTES = 5_242_880; // 5 MB

interface ImageUploaderProps {
  /** Label for the upload button */
  uploadLabel: string;
  /** Error message shown when mime type is invalid */
  invalidMimeMessage: string;
  /** Error message shown when file is too large */
  fileTooLargeMessage: string;
  /** Generic server upload error message */
  uploadErrorMessage: string;
  /** Called with valid File to perform the actual upload */
  onUpload: (file: File) => Promise<{ error?: { code: string; message: string } } | void>;
}

type UploadState = 'idle' | 'uploading' | 'error';

export function ImageUploader({
  uploadLabel,
  invalidMimeMessage,
  fileTooLargeMessage,
  uploadErrorMessage,
  onUpload,
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  async function handleFile(file: File) {
    setErrorMsg(null);

    // Client-side validation
    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
      setErrorMsg(invalidMimeMessage);
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setErrorMsg(fileTooLargeMessage);
      return;
    }

    setState('uploading');
    try {
      const result = await onUpload(file);
      if (result && 'error' in result && result.error) {
        setErrorMsg(uploadErrorMessage);
        setState('error');
      } else {
        setState('idle');
      }
    } catch {
      setErrorMsg(uploadErrorMessage);
      setState('error');
    }

    // Reset the file input so the same file can be re-selected after error
    if (inputRef.current) inputRef.current.value = '';
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file).catch(() => undefined);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file).catch(() => undefined);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave() {
    setIsDragging(false);
  }

  const isUploading = state === 'uploading';

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={[
          'border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-3 transition-colors',
          isDragging
            ? 'border-brand-400 bg-brand-50'
            : 'border-slate-200 hover:border-slate-300 bg-slate-50',
        ].join(' ')}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="text-slate-400"
        >
          <polyline points="16 16 12 12 8 16" />
          <line x1="12" y1="12" x2="12" y2="21" />
          <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
        </svg>

        {isUploading ? (
          <p className="text-sm text-slate-500">Subiendo...</p>
        ) : (
          <Button
            type="button"
            size="sm"
            loading={isUploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploadLabel}
          </Button>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          aria-label={uploadLabel}
          onChange={handleChange}
          disabled={isUploading}
        />
      </div>

      {/* Error display */}
      {errorMsg && (
        <p role="alert" className="text-sm text-red-600">
          {errorMsg}
        </p>
      )}
    </div>
  );
}
