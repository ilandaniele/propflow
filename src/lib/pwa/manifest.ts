export const THEME_COLOR = '#3d4ed8';

const ICONS = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

const START_URL = { admin: '/dashboard', tenant: '/portal' } as const;

export interface ManifestViewer {
  role: 'admin' | 'tenant';
  orgName: string;
}

export function buildManifest(viewer: ManifestViewer | null) {
  const name = viewer?.orgName.trim() || 'PropFlow';
  return {
    id: '/',
    name,
    short_name: name.length > 12 ? `${name.slice(0, 11)}…` : name,
    description: viewer ? `${name} — PropFlow` : 'PropFlow',
    start_url: viewer ? START_URL[viewer.role] : '/login',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: THEME_COLOR,
    icons: ICONS,
  };
}
