export interface AppError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ActionResult is the return type for Server Actions
// Allows: empty initial state {}, success {data: undefined|void}, or error {error: {...}}
export type ActionResult<T = void> = {
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export function ok<T>(data: T): ActionResult<T> {
  return { data };
}

export function err(code: string, message: string, details?: unknown): ActionResult<never> {
  return { error: { code, message, details } };
}

export const Errors = {
  UNAUTHORIZED: () => err('UNAUTHORIZED', 'Authentication required'),
  FORBIDDEN: () => err('FORBIDDEN', 'Access denied'),
  NOT_FOUND: () => err('NOT_FOUND', 'Resource not found'),
  VALIDATION_ERROR: (details: unknown) => err('VALIDATION_ERROR', 'Validation failed', details),
  CONFLICT: (message: string) => err('CONFLICT', message),
  INTERNAL: () => err('INTERNAL_ERROR', 'An unexpected error occurred'),
  RATE_LIMITED: () => err('RATE_LIMITED', 'Too many requests. Please wait before trying again.'),
  OAUTH_FAILED: () => err('OAUTH_FAILED', 'OAuth sign-in failed. Please try again.'),
  PROVISION_FAILED: () => err('PROVISION_FAILED', 'Failed to set up your account. Please contact support.'),

  // Image upload error codes (IC-10)
  /** 400 — MIME type not in allowlist or magic bytes mismatch declared Content-Type */
  IMAGE_INVALID_MIME: () => err('IMAGE_INVALID_MIME', 'File type not allowed. Only JPEG, PNG and WebP are accepted.'),
  /** 413 — File size exceeds the 5 MB server-side cap */
  IMAGE_TOO_LARGE: () => err('IMAGE_TOO_LARGE', 'File is too large. Maximum allowed size is 5 MB.'),
  /** 404 — Image row or storage object not found (or access denied — intentionally ambiguous) */
  IMAGE_NOT_FOUND: () => err('IMAGE_NOT_FOUND', 'Image not found.'),
  /** 422 — Per-unit image quota (20 images per unit) exceeded */
  IMAGE_QUOTA_EXCEEDED: () => err('IMAGE_QUOTA_EXCEEDED', 'Unit image limit reached. Maximum 20 images per unit.'),
  /** 409 — Cannot delete or replace the cover image when other images exist (must reassign cover first) */
  IMAGE_COVER_CONFLICT: () => err('IMAGE_COVER_CONFLICT', 'Cannot delete the cover image while other images exist. Set a different cover first.'),
} as const;
