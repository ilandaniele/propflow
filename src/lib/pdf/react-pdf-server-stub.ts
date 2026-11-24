/**
 * Server-side stand-in for @react-pdf/renderer (see turbopack.resolveAlias in
 * next.config.ts). PDFs render in the browser only; this keeps fontkit, pdfkit,
 * brotli and yoga out of the Cloudflare Worker bundle.
 */

function browserOnly(): never {
  throw new Error('@react-pdf/renderer is browser-only');
}

export const Document = browserOnly;
export const Image = browserOnly;
export const Page = browserOnly;
export const Text = browserOnly;
export const View = browserOnly;
export const pdf = browserOnly;
export const StyleSheet = { create: <T>(styles: T): T => styles };
