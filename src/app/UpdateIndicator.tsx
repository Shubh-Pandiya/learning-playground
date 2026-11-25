import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDownCircle, ChevronDown, X } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Tooltip } from '@/shared/ui';
import { shortSha, startUpdatePolling, useUpdates, useUpdatesSeen } from './updates';

/** Header badge (only when an update is blocked) + one-time "updated" toast. */
export function UpdateIndicator() {
  const status = useUpdates((s) => s.status);
  const seenSha = useUpdatesSeen((s) => s.seenSha);
  const markSeen = useUpdatesSeen((s) => s.markSeen);
  const [open, setOpen] = useState(false);

  useEffect(startUpdatePolling, []);

  const last = status?.lastUpdate;
  const showToast = !!last && last.to !== seenSha;
  const blocked = status?.state === 'skipped' && status.behind > 0;

  return (
    <>
      {blocked && (
        <Tooltip content={status.reason ?? 'Update skipped'} side="bottom">
          <Link
            to="/settings#updates"
            className="inline-flex items-center gap-1.5 rounded border border-warn/40 bg-warn/10 px-2 py-1 font-mono text-[11px] text-warn"
          >
            <ArrowDownCircle size={13} />
            update skipped
          </Link>
        </Tooltip>
      )}
      <AnimatePresence>
        {showToast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            role="status"
            className="fixed bottom-5 right-5 z-50 w-[340px] rounded-lg border border-line bg-surface p-4 shadow-lift"
          >
            <div className="flex items-start gap-3">
              <ArrowDownCircle size={18} className="mt-0.5 shrink-0 text-ok" />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[13px] font-semibold">
                  Updated to <span className="text-accent">{shortSha(last.to)}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {last.commits.length} new commit{last.commits.length === 1 ? '' : 's'} from GitHub · your progress is untouched
                </p>
                <button
                  type="button"
                  onClick={() => setOpen((o) => !o)}
                  className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] text-ink hover:text-accent"
                >
                  What&apos;s new
                  <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
                </button>
                {open && (
                  <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                    {last.commits.map((c) => (
                      <li key={c.sha} className="flex gap-2 text-xs">
                        <span className="shrink-0 font-mono text-faint">{c.sha}</span>
                        <span className="text-muted">{c.subject}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => markSeen(last.to)}
                className="shrink-0 text-faint hover:text-ink"
              >
                <X size={15} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
