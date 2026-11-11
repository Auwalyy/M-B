'use client';

import { useRouter } from 'next/navigation';

/** A select that navigates as soon as it changes (e.g. sort order), keeping the other filters. */
export function AutoSubmit({ action, params, name, value, options, label }: { action: string; params: Record<string, string | undefined>; name: string; value: string; options: readonly (readonly [string, string])[]; label: string }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm text-ink-muted">
      {label}
      <select
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(Object.entries({ ...params, [name]: e.target.value, page: undefined }).filter((x): x is [string, string] => Boolean(x[1])));
          router.push(`${action}?${next}`);
        }}
        className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm text-ink"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
