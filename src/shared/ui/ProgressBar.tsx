import { motion } from 'framer-motion';
import { cn } from '../cn';
import { toneClasses, type Tone } from './Tag';

export interface ProgressBarProps {
  /** Current value. */
  value: number;
  /** Max value (default 1, so `value` can be a 0..1 fraction). */
  max?: number;
  tone?: Tone;
  /** Label left of the numbers row. */
  label?: string;
  /** Show "value / max" or percentage on the right. */
  showValue?: 'fraction' | 'percent' | false;
  size?: 'xs' | 'sm' | 'md';
  /** Optional segment markers (e.g. thresholds), as fractions 0..1. */
  markers?: number[];
  className?: string;
}

export function ProgressBar({
  value,
  max = 1,
  tone = 'accent',
  label,
  showValue = false,
  size = 'sm',
  markers,
  className,
}: ProgressBarProps) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const h = size === 'xs' ? 'h-1' : size === 'sm' ? 'h-1.5' : 'h-2.5';
  return (
    <div className={cn('w-full', className)}>
      {(label || showValue) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-2 font-mono text-[11px] text-muted">
          <span className="truncate">{label}</span>
          {showValue === 'fraction' && (
            <span className="tabular-nums text-ink">
              {value}
              <span className="text-faint"> / {max}</span>
            </span>
          )}
          {showValue === 'percent' && <span className="tabular-nums text-ink">{Math.round(pct * 100)}%</span>}
        </div>
      )}
      <div
        className={cn('relative w-full overflow-hidden rounded-full bg-ink/[0.08]', h)}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={label}
      >
        <motion.div
          className={cn('h-full rounded-full', toneClasses[tone].dot)}
          initial={false}
          animate={{ width: `${pct * 100}%` }}
          transition={{ type: 'spring', stiffness: 140, damping: 22 }}
        />
        {markers?.map((m) => (
          <span key={m} className="absolute top-0 h-full w-px bg-paper/80" style={{ left: `${m * 100}%` }} />
        ))}
      </div>
    </div>
  );
}
