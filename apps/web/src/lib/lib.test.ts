import { ALL_PERMISSIONS, type AuthResponseDto } from '@mb/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { summariseHours } from '@/components/store/branch-card';
import { isOpen, lagosNow } from '@/components/store/open-status';
import { ApiError, buildUrl, getAccessToken, refreshSession, request, setSession } from './api';
import { activeHref, visibleNav } from './nav';
import { homeFor, safeNext } from './redirects';
import { generatePassword } from './utils';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const session = (token: string) => ({ data: { accessToken: token, expiresIn: 900, user: { id: 'u1' } } as unknown as AuthResponseDto });

describe('api client', () => {
  beforeEach(() => setSession(null));
  afterEach(() => vi.unstubAllGlobals());

  it('drops empty query values', () => {
    expect(buildUrl('/users', { q: '', role: 'SALES_STAFF', page: 2, branch: undefined })).toBe('/api/v1/users?role=SALES_STAFF&page=2');
  });

  it('refreshes once and retries when the access token has expired', async () => {
    setSession({ accessToken: 'old' } as AuthResponseDto);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(401, { error: { code: 'TOKEN_INVALID', message: 'expired' } }))
      .mockResolvedValueOnce(json(200, session('new')))
      .mockResolvedValueOnce(json(200, { data: { ok: true } }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await request<{ ok: boolean }>('/auth/me');
    expect(res.data.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]![1].headers.Authorization).toBe('Bearer new');
  });

  it('shares one refresh between concurrent callers', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json(200, session('t1')));
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([refreshSession(), refreshSession(), refreshSession()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBe('t1');
  });

  it('retries a refresh that raced with another tab', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(401, { error: { code: 'REFRESH_RACE' } }))
      .mockResolvedValueOnce(json(200, session('t2')));
    vi.stubGlobal('fetch', fetchMock);
    expect((await refreshSession())?.accessToken).toBe('t2');
  });

  it('surfaces API errors with code, message and field details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(422, { error: { code: 'VALIDATION_ERROR', message: 'Some fields are invalid', details: { phone: ['Bad'] } } })));
    const err = await request('/users', { method: 'POST', body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.fieldErrors).toEqual({ phone: ['Bad'] });
  });

  it('reports network failures in plain language', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const err = await request('/branches').catch((e) => e);
    expect(err.code).toBe('NETWORK_ERROR');
  });
});

describe('navigation', () => {
  it('shows only sections the user has permission for', () => {
    const sales = visibleNav({ permissions: ['branches:read'] });
    const labels = sales.flatMap((s) => s.items.map((i) => i.label));
    expect(labels).toEqual(['Dashboard', 'Branches']);
    const owner = visibleNav({ permissions: ALL_PERMISSIONS });
    expect(owner.flatMap((s) => s.items).length).toBeGreaterThan(5);
  });

  it('marks the most specific item active', () => {
    const nav = visibleNav({ permissions: ALL_PERMISSIONS });
    expect(activeHref('/admin', nav)).toBe('/admin');
    expect(activeHref('/admin/staff/123', nav)).toBe('/admin/staff');
  });
});

describe('redirects', () => {
  it('sends users to the right home', () => {
    expect(homeFor({ role: 'CUSTOMER', mustChangePassword: false })).toBe('/account');
    expect(homeFor({ role: 'BRANCH_ADMIN', mustChangePassword: false })).toBe('/admin');
    expect(homeFor({ role: 'SALES_STAFF', mustChangePassword: true })).toBe('/change-password');
  });

  it('refuses open redirects', () => {
    expect(safeNext('/admin/staff')).toBe('/admin/staff');
    expect(safeNext('//evil.example')).toBeNull();
    expect(safeNext('https://evil.example')).toBeNull();
    expect(safeNext('/\\evil.example')).toBeNull();
  });
});

describe('branch hours', () => {
  const hours = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '08:00', close: '18:00', closed: day === 0 }));

  it('summarises consecutive days', () => {
    expect(summariseHours(hours)).toEqual(['Mon–Sat 08:00–18:00', 'Sun Closed']);
  });

  it('computes open/closed in Nigeria time regardless of the visitor timezone', () => {
    // Monday 10:00 WAT = 09:00 UTC
    expect(lagosNow(new Date('2026-11-09T09:00:00Z'))).toEqual({ day: 1, time: '10:00' });
    expect(isOpen(hours, new Date('2026-11-09T09:00:00Z'))).toBe(true);
    expect(isOpen(hours, new Date('2026-11-09T17:30:00Z'))).toBe(false); // 18:30 WAT
    expect(isOpen(hours, new Date('2026-11-08T11:00:00Z'))).toBe(false); // Sunday
  });
});

describe('temporary passwords', () => {
  it('always satisfy the password rules', () => {
    for (let i = 0; i < 50; i++) {
      const p = generatePassword();
      expect(p).toMatch(/^(?=.*[a-zA-Z])(?=.*\d).{10}$/);
    }
  });
});
