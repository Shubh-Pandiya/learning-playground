import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  /** Small icon shown before the title. */
  icon?: ReactNode;
  /** Right side of the header (buttons, badges). */
  actions?: ReactNode;
  /** Remove body padding (e.g. for canvases or lists). */
  flush?: boolean;
  /** Use the sunken background — good for diagram/canvas areas. */
  sunken?: boolean;
  bodyClassName?: string;
}

/** Titled section with a hairline header strip. Use for palettes, inspectors, code, canvases. */
export function Panel({ title, icon, actions, flush, sunken, className, bodyClassName, children, ...rest }: PanelProps) {
  return (
    <section
      className={cn('flex min-h-0 flex-col overflow-hidden rounded-lg border border-line', sunken ? 'bg-sunken' : 'bg-surface', className)}
      {...rest}
    >
      {(title || actions) && (
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
          {icon && <span className="text-muted">{icon}</span>}
          {title && <h2 className="eyebrow truncate !text-ink">{title}</h2>}
          {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={cn('min-h-0 flex-1', !flush && 'p-4', bodyClassName)}>{children}</div>
    </section>
  );
}
