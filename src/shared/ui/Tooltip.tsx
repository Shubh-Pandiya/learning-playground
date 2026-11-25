import { cloneElement, isValidElement, useCallback, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '../cn';

export interface TooltipProps {
  content: ReactNode;
  /** A single element that accepts mouse/focus handlers and a ref-able DOM node. */
  children: ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  className?: string;
  disabled?: boolean;
}

/**
 * Hover/focus tooltip rendered in a portal (never clipped by overflow-hidden panels).
 * Wrap the trigger in a <span> if it's a custom component that doesn't forward events.
 */
export function Tooltip({ content, children, side = 'top', delay = 250, className, disabled }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback(
    (e: { currentTarget: EventTarget }) => {
      anchor.current = e.currentTarget as HTMLElement;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setOpen(true), delay);
    },
    [delay],
  );
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(false);
  }, []);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const r = anchor.current.getBoundingClientRect();
    const gap = 8;
    const map = {
      top: { x: r.left + r.width / 2, y: r.top - gap },
      bottom: { x: r.left + r.width / 2, y: r.bottom + gap },
      left: { x: r.left - gap, y: r.top + r.height / 2 },
      right: { x: r.right + gap, y: r.top + r.height / 2 },
    };
    setPos(map[side]);
  }, [open, side]);

  if (!isValidElement(children) || disabled || content == null || content === '') return children;

  const props = children.props as Record<string, unknown>;
  const chain =
    (ours: (e: never) => void, theirs: unknown) =>
    (e: never) => {
      (theirs as ((e: never) => void) | undefined)?.(e);
      ours(e);
    };

  const trigger = cloneElement(children as ReactElement<Record<string, unknown>>, {
    onMouseEnter: chain(show, props.onMouseEnter),
    onMouseLeave: chain(hide, props.onMouseLeave),
    onFocus: chain(show, props.onFocus),
    onBlur: chain(hide, props.onBlur),
    'aria-describedby': open ? id : undefined,
  });

  const transform = {
    top: 'translate(-50%, -100%)',
    bottom: 'translate(-50%, 0)',
    left: 'translate(-100%, -50%)',
    right: 'translate(0, -50%)',
  }[side];

  return (
    <>
      {trigger}
      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <div className="pointer-events-none fixed z-[100]" style={{ left: pos.x, top: pos.y, transform }}>
              <motion.div
                id={id}
                role="tooltip"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.12 }}
                className={cn(
                  'max-w-xs rounded-md bg-ink px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-paper shadow-lift',
                  className,
                )}
              >
                {content}
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
