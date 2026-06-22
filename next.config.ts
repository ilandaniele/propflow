import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,

  // Security headers — CSP is nonce-based (generated in middleware.ts per request).
  // Static headers here provide non-CSP security headers as a base layer.
  // The nonce-based CSP in middleware.ts takes precedence and overrides the static one.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
        ],
      },
    ];
  },

  images: {
    // dangerouslyAllowSVG is intentionally NOT set (ASVS V13.1.5 — SVG can carry XSS)
    remotePatterns: [
      // Tigris S3 — signed URLs for unit-images, tenant-avatars, incident-photos, etc.
      {
        protocol: 'https',
        hostname: '*.fly.storage.tigris.dev',
      },
      // Airtable CDN — Room attachment URLs are served directly from Airtable CDN (IC-1).
      {
        protocol: 'https',
        hostname: 'dl.airtable.com',
      },
      {
        protocol: 'https',
        hostname: 'v5.airtableusercontent.com',
      },
    ],
  },

  // Experimental: server actions size limit
  experimental: {
    serverActions: {
      bodySizeLimit: '6mb', // allow up to 6mb for incident photo uploads (validated to 5mb server-side)
    },
  },
};

export default withNextIntl(nextConfig);
