interface AvatarProps {
  name?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Optional photo URL (signed Tigris storage URL). Falls back to initials. */
  src?: string | null;
}

const sizeClasses = {
  sm: 'h-7 w-7 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-11 w-11 text-base',
};

function getInitials(name?: string | null): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function getColorFromName(name?: string | null): string {
  if (!name) return 'bg-slate-200 text-slate-600';
  const colors = [
    'bg-brand-100 text-brand-700',
    'bg-blue-100 text-blue-700',
    'bg-green-100 text-green-700',
    'bg-amber-100 text-amber-700',
    'bg-rose-100 text-rose-700',
    'bg-cyan-100 text-cyan-700',
  ];
  const idx = name.charCodeAt(0) % colors.length;
  return colors[idx];
}

export function Avatar({ name, size = 'md', className = '', src }: AvatarProps) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name ?? 'User avatar'}
        className={[
          'inline-flex rounded-full object-cover shrink-0',
          sizeClasses[size],
          className,
        ].join(' ')}
        onError={(e) => {
          // Fallback: hide img on load error (parent can show initials fallback)
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }

  return (
    <div
      className={[
        'inline-flex items-center justify-center rounded-full font-semibold select-none shrink-0',
        sizeClasses[size],
        getColorFromName(name),
        className,
      ].join(' ')}
      aria-label={name ?? 'User avatar'}
    >
      {getInitials(name)}
    </div>
  );
}
