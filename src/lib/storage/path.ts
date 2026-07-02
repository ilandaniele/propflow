/**
 * Storage-path validation for signed-URL routes.
 *
 * Object keys are `{org_id}/{resource_id}/{filename}`. Even though S3/Tigris keys
 * are opaque (a literal `..` segment is not filesystem traversal), we reject any
 * key that isn't a clean 3+-segment path prefixed by the caller's org id. This
 * gives every file route the same defense as unit-image and blocks prefix tricks
 * like `path.startsWith(orgId)` matching `{orgId}../other`.
 */
export function isSafeOrgScopedPath(path: string | null | undefined, orgId: string): path is string {
  if (!path) return false;
  if (path.includes('..') || path.includes('\0') || /[<>:"|?*]/.test(path)) return false;
  const segments = path.split('/');
  if (segments.length < 3 || segments.some((s) => s.length === 0)) return false;
  return segments[0] === orgId;
}
