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
        // Agent Phase 7: excludes /widget.js and /widget/* (negative
        // lookahead after a named param, per the path-to-regexp docs in
        // node_modules/next/dist/docs/.../headers.md) — those routes set
        // their own headers (no X-Frame-Options, no COOP; see src/proxy.ts
        // and src/app/widget.js/route.ts + src/app/widget/[publicKey]).
        // Without this exclusion, this catch-all's X-Frame-Options: DENY
        // would always win and no site could ever embed the widget.
        source: '/:path((?!widget\\.js|widget/).*)',
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
      {
        // The widget paths still get the non-framing baseline — just no
        // X-Frame-Options and no Cross-Origin-Opener-Policy, both of which
        // would break third-party embedding.
        source: '/widget.js',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
        ],
      },
      {
        source: '/widget/:key*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
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
