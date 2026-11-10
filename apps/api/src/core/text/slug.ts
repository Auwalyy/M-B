import type { Model } from 'mongoose';

/** "Samsung 55\" QLED TV" -> "samsung-55-qled-tv" */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

/** A slug that no other document uses: "tv", then "tv-2", "tv-3", … */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function uniqueSlug(model: Model<any>, source: string, excludeId?: unknown): Promise<string> {
  const base = slugify(source);
  const taken = new Set(
    (
      await model
        .find({ slug: { $regex: `^${base}(-\\d+)?$` }, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })
        .select('slug')
        .lean<{ slug: string }[]>()
    ).map((d) => d.slug),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}
