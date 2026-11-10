import type { PageMeta } from '@mb/shared';

/** A paginated result. Routes serialise it as `{ data: items, meta }`. */
export class Page<T> {
  constructor(
    public readonly items: T[],
    public readonly meta: PageMeta,
  ) {}

  static of<T>(items: T[], total: number, page: number, limit: number): Page<T> {
    return new Page(items, { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) });
  }

  map<U>(fn: (item: T) => U): Page<U> {
    return new Page(this.items.map(fn), this.meta);
  }
}

export function skipFor(page: number, limit: number): number {
  return (page - 1) * limit;
}

/** Escapes user input for use inside a RegExp (search boxes). */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
