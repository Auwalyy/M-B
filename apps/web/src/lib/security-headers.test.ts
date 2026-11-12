import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, securityHeaders } from '../../security-headers';

describe('security headers', () => {
  it('locks production pages down', () => {
    const csp = contentSecurityPolicy(false);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('img-src \'self\' data: blob: https://res.cloudinary.com');
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).not.toContain('unsafe-eval');
    const keys = securityHeaders(false).map((h) => h.key);
    expect(keys).toEqual(expect.arrayContaining(['Strict-Transport-Security', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy']));
  });

  it('relaxes only what development tooling needs', () => {
    expect(contentSecurityPolicy(true)).toContain("'unsafe-eval'");
    expect(securityHeaders(true).some((h) => h.key === 'Strict-Transport-Security')).toBe(false);
  });
});
