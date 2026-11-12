'use client';

import type { ImageDto } from '@mb/shared';
import { Package } from 'lucide-react';
import { useState } from 'react';
import { cn, imageSrcSet, imageUrl } from '@/lib/utils';

export function Gallery({ images, name }: { images: ImageDto[]; name: string }) {
  const [i, setI] = useState(0);
  const current = images[i];
  return (
    <div>
      <div className="aspect-square overflow-hidden rounded-2xl border border-line bg-surface">
        {current ? (
          <img src={imageUrl(current.url, 900)!} srcSet={imageSrcSet(current.url, [450, 700, 900, 1200])} sizes="(min-width: 1024px) 600px, 100vw" fetchPriority={i === 0 ? 'high' : 'auto'} decoding="async" alt={current.alt ?? name} className="h-full w-full object-contain p-4" />
        ) : (
          <div className="flex h-full items-center justify-center text-ink-faint"><Package className="h-16 w-16" aria-hidden /><span className="sr-only">No photo yet</span></div>
        )}
      </div>
      {images.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Product photos">
          {images.map((img, idx) => (
            <button
              key={img.id}
              role="tab"
              aria-selected={idx === i}
              aria-label={`Photo ${idx + 1}`}
              onClick={() => setI(idx)}
              className={cn('h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 bg-surface', idx === i ? 'border-brand-600' : 'border-line hover:border-line-strong')}
            >
              <img src={imageUrl(img.url, 128)!} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
