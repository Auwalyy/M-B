import path from 'node:path';
import type { NextConfig } from 'next';
import { securityHeaders } from './security-headers';

/** Where the API runs. The browser never calls it directly: /api/* is proxied, so cookies stay first-party. */
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:4100';

// The proxy address is fixed at build time. On a hosted build (Vercel), a missing or local API_URL
// would produce a site that looks fine but whose every /api call fails, so stop the build instead.
if (process.env.VERCEL && (!process.env.API_URL || /^https?:\/\/(127\.0\.0\.1|localhost)/.test(API_URL))) {
  throw new Error(
    'API_URL is not set to the public API address. In Vercel → Settings → Environment Variables, set API_URL ' +
      '(for example https://m-b-vvmz.onrender.com), then deploy again.',
  );
}
const repoRoot = path.resolve(process.cwd(), '../..');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // A self-contained server bundle for Docker or a VPS (Vercel ignores this).
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
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
        headers: securityHeaders(process.env.NODE_ENV !== 'production'),
      },
    ];
  },
};

export default nextConfig;
