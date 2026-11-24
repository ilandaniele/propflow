export const DOCUMENT_ENTITIES = ['tenant', 'contract', 'property'] as const;
export type DocumentEntity = (typeof DOCUMENT_ENTITIES)[number];

export const DOCUMENT_CATEGORIES = ['identity', 'contract', 'insurance', 'certificate', 'invoice', 'other'] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_MIME_EXTENSIONS = {
  'application/pdf': 'pdf',
  'image/jpeg':      'jpg',
  'image/png':       'png',
  'image/webp':      'webp',
} as const;
export type DocumentMime = keyof typeof DOCUMENT_MIME_EXTENSIONS;

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_UPLOAD = 10;
export const EXPIRING_SOON_DAYS = 30;

export function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function expiryState(expiresOn: string | null, today: string): 'expired' | 'soon' | null {
  if (!expiresOn) return null;
  if (expiresOn < today) return 'expired';
  return expiresOn <= addDays(today, EXPIRING_SOON_DAYS) ? 'soon' : null;
}
