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
} as const;
