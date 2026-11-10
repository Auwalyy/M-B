import type { MetadataRoute } from 'next';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/account', '/api', '/change-password', '/reset-password'] }],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
