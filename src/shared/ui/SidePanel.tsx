import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../cn';
import { Button } from './Button';

export interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  eyebrow?: ReactNode;
  side?: 'right' | 'left';
  /** Tailwind width class. Default `w-[420px]`. */
  widthClassName?: string;
  /** Dim + block the page behind. Default false (non-modal inspector). */
  overlay?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Slide-in drawer (inspector, explanation, "why is this wrong?").
 * Esc closes. Rendered in a portal below the app header.
 */
export function SidePanel({ open, onClose, title, eyebrow, side = 'right', widthClassName = 'w-[420px]', overlay = false, footer, children }: SidePanelProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const from = side === 'right' ? '100%' : '-100%';

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {overlay && (
            <motion.div
              key="overlay"
              className="fixed inset-0 top-14 z-40 bg-ink/20"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
            />
          )}
          <motion.aside
            key="panel"
            role="dialog"
            aria-modal={overlay}
            className={cn(
              'fixed bottom-0 top-14 z-50 flex max-w-[100vw] flex-col border-line bg-surface shadow-lift',
              side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
              widthClassName,
            )}
            initial={{ x: from }}
            animate={{ x: 0 }}
            exit={{ x: from }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
          >
            <header className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0 flex-1">
                {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
                {title && <h2 className="font-mono text-base font-semibold leading-snug">{title}</h2>}
              </div>
              <Button size="sm" variant="ghost" iconOnly aria-label="Close" icon={<X size={16} />} onClick={onClose} />
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <footer className="shrink-0 border-t border-line px-5 py-3">{footer}</footer>}
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
