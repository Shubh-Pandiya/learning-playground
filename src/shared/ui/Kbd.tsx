import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

/** Keyboard key hint, e.g. <Kbd>Space</Kbd> or <Kbd>→</Kbd>. */
export function Kbd({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-line border-b-2 bg-surface px-1 font-mono text-[10.5px] text-muted',
        className,
      )}
      {...rest}
    />
  );
}
