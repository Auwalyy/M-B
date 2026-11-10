import 'server-only';

/**
 * Server-side reads for public, SEO-relevant pages (rendered on the server and cached).
 * Calls the API directly, not through the /api proxy.
 */
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:4100';

export async function serverGet<T>(path: string, revalidate = 300): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1${path}`, { next: { revalidate }, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { data: T };
    return body.data;
  } catch {
    return null;
  }
}
