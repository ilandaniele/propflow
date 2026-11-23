interface OrgLogoProps {
  src: string;
  alt: string;
  className: string;
}

export function OrgLogo({ src, alt, className }: OrgLogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={`object-contain ${className}`} decoding="async" />
  );
}
