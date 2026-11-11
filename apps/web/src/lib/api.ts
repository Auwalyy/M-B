import type { AuthResponseDto, PageMeta } from '@mb/shared';

/**
 * API client. The access token lives in memory only (never in localStorage); the refresh
 * token is an httpOnly cookie the browser sends to /api/v1/auth. Requests go to /api/*
 * on the web origin, which Next.js proxies to the API, so cookies are first-party.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, string[]> | unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field errors from a 409/422 response, keyed by field path. */
  get fieldErrors(): Record<string, string[]> {
    return this.details && typeof this.details === 'object' && !Array.isArray(this.details)
      ? (this.details as Record<string, string[]>)
      : {};
  }
}

export const API_BASE = '/api/v1';

let accessToken: string | null = null;
type Listener = (session: AuthResponseDto | null) => void;
const listeners = new Set<Listener>();

export function getAccessToken() {
  return accessToken;
}

export function setSession(session: AuthResponseDto | null) {
  accessToken = session?.accessToken ?? null;
  for (const l of listeners) l(session);
}

/** Notified whenever the session is refreshed or ends (used by the auth provider). */
export function onSessionChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let refreshInFlight: Promise<AuthResponseDto | null> | null = null;

/**
 * Exchanges the refresh cookie for a new access token. Concurrent callers share one request.
 * If another tab rotated the token a moment ago (REFRESH_RACE), the browser already holds
 * the new cookie, so retry once.
 */
export function refreshSession(): Promise<AuthResponseDto | null> {
  refreshInFlight ??= (async () => {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'same-origin' });
        if (res.ok) {
          const body = (await res.json()) as { data: AuthResponseDto };
          setSession(body.data);
          return body.data;
        }
        const err = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
        if (err?.error?.code === 'REFRESH_RACE' && attempt === 0) {
          await sleep(400);
          continue;
        }
        break;
      }
      setSession(null);
      return null;
    } catch {
      // Network failure: keep any token we have; the next request will try again.
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

const RETRYABLE_AUTH_CODES = new Set(['TOKEN_INVALID', 'UNAUTHENTICATED']);

export type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Multipart upload; sent as-is so the browser sets the boundary. */
  form?: FormData;
  query?: Query;
  signal?: AbortSignal;
}

export function buildUrl(path: string, query?: Query): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return `${API_BASE}${path}${s ? `?${s}` : ''}`;
}

export async function request<T>(path: string, opts: RequestOptions = {}, canRetry = true): Promise<{ data: T; meta?: PageMeta }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined && !opts.form) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
      credentials: 'same-origin',
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your internet connection and try again.');
  }

  if (res.status === 204) return { data: undefined as T };
  const body = (await res.json().catch(() => null)) as
    | { data: T; meta?: PageMeta; error?: { code: string; message: string; details?: unknown; requestId?: string } }
    | null;

  if (!res.ok) {
    const e = body?.error;
    if (res.status === 401 && canRetry && e && RETRYABLE_AUTH_CODES.has(e.code)) {
      const refreshed = await refreshSession();
      if (refreshed) return request<T>(path, opts, false);
    }
    if (res.status === 401 && e?.code === 'SESSION_INVALID') setSession(null);
    throw new ApiError(
      res.status,
      e?.code ?? 'HTTP_ERROR',
      e?.message ?? `Request failed (${res.status})`,
      e?.details,
      e?.requestId,
    );
  }
  return { data: body!.data, meta: body!.meta };
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) =>
    request<T>(path, { query, signal }).then((r) => r.data),
  page: <T>(path: string, query?: Query, signal?: AbortSignal) =>
    request<T[]>(path, { query, signal }) as Promise<{ data: T[]; meta: PageMeta }>,
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} }).then((r) => r.data),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: body ?? {} }).then((r) => r.data),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: body ?? {} }).then((r) => r.data),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }).then((r) => r.data),
  /** Upload files as multipart/form-data under one field name. */
  upload: <T>(path: string, field: string, files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append(field, f);
    return request<T>(path, { method: 'POST', form }).then((r) => r.data);
  },
};

/**
 * Downloads a file (such as a CSV report) with the signed-in user's token and hands it to the browser.
 * A plain link cannot be used because the token is not a cookie.
 */
export async function downloadFile(path: string, query?: Query, fallbackName = 'download', canRetry = true): Promise<void> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), { headers, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your internet connection and try again.');
  }
  if (!res.ok) {
    const e = ((await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null)?.error;
    if (res.status === 401 && canRetry && e && RETRYABLE_AUTH_CODES.has(e.code) && (await refreshSession())) return downloadFile(path, query, fallbackName, false);
    throw new ApiError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? `Download failed (${res.status})`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Human-friendly message for any error thrown by the client. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}
