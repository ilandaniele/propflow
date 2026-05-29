import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

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
    remotePatterns: [
      // Add Supabase storage domain if serving images from Supabase
      // { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },

  // Experimental: server actions size limit
  experimental: {
    serverActions: {
      bodySizeLimit: '6mb', // allow up to 6mb for incident photo uploads (validated to 5mb server-side)
    },
  },
};

export default nextConfig;
