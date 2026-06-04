import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
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
      // Supabase Storage — signed URLs for unit-images, tenant-avatars, incident-photos, etc.
      // Pattern matches: https://<project-ref>.supabase.co/storage/v1/object/sign/**
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/sign/**',
      },
      // Also allow public object paths (for admin service-role direct reads if needed)
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      // Airtable CDN — Room attachment URLs are served directly from Airtable CDN (IC-1).
      // No Supabase Storage copy is made for Airtable attachments.
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
