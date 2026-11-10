import { describe, expect, it } from 'vitest';
import { createBranchSchema, loginSchema, openingHoursSchema, registerSchema } from '../index';

describe('shared schemas', () => {
  it('normalises phone and email on registration', () => {
    const out = registerSchema.parse({
      fullName: '  Aisha Bello ',
      phone: '0803 123 4567',
      email: ' Aisha@Example.COM ',
      password: 'secret123',
    });
    expect(out).toMatchObject({ fullName: 'Aisha Bello', phone: '+2348031234567', email: 'aisha@example.com' });
  });

  it('rejects weak passwords', () => {
    const r = registerSchema.safeParse({ fullName: 'A', phone: '08031234567', password: 'password' });
    expect(r.success).toBe(false);
  });

  it('rejects operator objects where strings are expected (NoSQL injection)', () => {
    const r = loginSchema.safeParse({ identifier: { $gt: '' }, password: 'x' });
    expect(r.success).toBe(false);
  });

  it('validates branch codes and upper-cases them', () => {
    const base = {
      name: 'Kano – Bompai',
      address: '12 Bompai Road',
      city: 'Kano',
      state: 'Kano',
      phone: '08031234567',
      whatsapp: '08031234567',
    };
    expect(createBranchSchema.parse({ ...base, code: 'kan01' }).code).toBe('KAN01');
    expect(createBranchSchema.safeParse({ ...base, code: 'KANO-1' }).success).toBe(false);
  });

  it('rejects opening hours that close before they open, or repeat a day', () => {
    expect(openingHoursSchema.safeParse([{ day: 1, open: '18:00', close: '08:00' }]).success).toBe(false);
    expect(
      openingHoursSchema.safeParse([
        { day: 1, open: '08:00', close: '18:00' },
        { day: 1, open: '09:00', close: '17:00' },
      ]).success,
    ).toBe(false);
    expect(openingHoursSchema.safeParse([{ day: 0, open: '00:00', close: '00:00', closed: true }]).success).toBe(true);
  });
});
