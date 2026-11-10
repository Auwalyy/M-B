'use client';

import { Copy, RefreshCw } from 'lucide-react';
import { type InputHTMLAttributes, forwardRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { generatePassword } from '@/lib/utils';

/** Text input with "generate" and "copy" buttons, for temporary passwords that are handed over in person. */
export const TempPasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { onGenerate: (value: string) => void; value?: string }>(
  function TempPasswordInput({ onGenerate, value, ...props }, ref) {
    const toast = useToast();
    return (
      <div className="flex gap-2">
        <Input ref={ref} value={value} autoComplete="off" spellCheck={false} className="font-mono" {...props} />
        <Button variant="secondary" size="icon" onClick={() => onGenerate(generatePassword())} aria-label="Generate a password" title="Generate">
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          aria-label="Copy password"
          title="Copy"
          disabled={!value}
          onClick={async () => {
            await navigator.clipboard.writeText(value ?? '');
            toast.success('Password copied');
          }}
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    );
  },
);
