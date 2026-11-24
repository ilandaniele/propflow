import { z } from 'zod';
import { validateImageFile, type AllowedMimeType } from '@/lib/storage/index';

export const MAX_LOGO_BYTES = 1_048_576;
export const LOGO_BUCKET = 'org-branding';

export const AccentColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Accent color must be a hex color like #1d4ed8')
  .transform((value) => value.toLowerCase());

export const SaveBrandingSchema = z.object({
  accent_color: z.preprocess((value) => (value === '' || value === null ? null : value), AccentColorSchema.nullable()),
  remove_logo: z.preprocess((value) => value === 'true', z.boolean()),
});

export type LogoCheck =
  | { ok: true; mime: AllowedMimeType }
  | { ok: false; code: 'IMAGE_TOO_LARGE' | 'IMAGE_INVALID_MIME' };

export function checkLogoFile(buffer: Buffer, declaredMime: string): LogoCheck {
  if (buffer.byteLength > MAX_LOGO_BYTES) return { ok: false, code: 'IMAGE_TOO_LARGE' };
  const result = validateImageFile(buffer, declaredMime, MAX_LOGO_BYTES);
  if (!result.valid) return { ok: false, code: 'IMAGE_INVALID_MIME' };
  return { ok: true, mime: declaredMime as AllowedMimeType };
}
