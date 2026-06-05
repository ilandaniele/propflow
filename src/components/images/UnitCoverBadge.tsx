/**
 * Small "Portada" badge shown on cover images in the gallery grid.
 * Uses i18n so the label adapts to the admin's locale.
 */

interface UnitCoverBadgeProps {
  label?: string;
}

export function UnitCoverBadge({ label = 'Portada' }: UnitCoverBadgeProps) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold bg-brand-600 text-white leading-none">
      {label}
    </span>
  );
}
