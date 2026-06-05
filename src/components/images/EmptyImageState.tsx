'use client';

/**
 * EmptyImageState — displayed in the unit images tab when no images exist.
 * Accepts an optional onUploadClick callback; if provided renders an upload button.
 */

import { Button } from '@/components/ui/Button';

interface EmptyImageStateProps {
  message: string;
  uploadLabel?: string;
  onUploadClick?: () => void;
}

export function EmptyImageState({ message, uploadLabel, onUploadClick }: EmptyImageStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        {/* Camera / photo icon */}
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
        >
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      </div>
      <p className="text-sm text-slate-500 max-w-sm mb-6">{message}</p>
      {onUploadClick && uploadLabel && (
        <Button size="sm" onClick={onUploadClick}>
          {uploadLabel}
        </Button>
      )}
    </div>
  );
}
