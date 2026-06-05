/**
 * TenantAvatar — wrapper around the shared Avatar component.
 *
 * Shows tenant photo if a signed URL is supplied, otherwise falls back to
 * initials with a deterministic colour derived from the tenant name.
 * This component is a Server Component — it receives an already-resolved
 * signed URL (or null) from the parent page/list.
 */

import { Avatar } from '@/components/ui/Avatar';

interface TenantAvatarProps {
  name: string;
  /** Pre-resolved signed URL for the tenant's photo, or null for initials fallback */
  signedUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function TenantAvatar({ name, signedUrl, size = 'md', className }: TenantAvatarProps) {
  return (
    <Avatar
      name={name}
      size={size}
      src={signedUrl ?? undefined}
      className={className}
    />
  );
}
