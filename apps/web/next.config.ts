import path from 'node:path';
import type { NextConfig } from 'next';

/** Where the API runs. The browser never calls it directly: /api/* is proxied, so cookies stay first-party. */
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:4100';
const repoRoot = path.resolve(process.cwd(), '../..');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@mb/shared'],
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_URL}/api/:path*` },
      // Images stored on the API's local disk in development (production images come from Cloudinary).
      { source: '/uploads/:path*', destination: `${API_URL}/uploads/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
        ],
      },
    ];
  },
};

export default nextConfig;
