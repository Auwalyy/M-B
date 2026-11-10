import type { MetadataRoute } from 'next';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

// Product and category URLs are added with the catalogue in Phase 3.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE}/branches`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE}/contact`, changeFrequency: 'monthly', priority: 0.5 },
  ];
}
