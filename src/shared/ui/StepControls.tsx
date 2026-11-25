import { useEffect, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react';
import { cn } from '../cn';
import { Button } from './Button';
import { Kbd } from './Kbd';
import type { Stepper } from './useStepper';

export interface StepControlsProps {
  stepper: Stepper;
  /** Speed multipliers offered. */
  speeds?: number[];
  /** Bind ←/→/Space/R globally (ignored while typing in inputs). Default true. */
  keyboard?: boolean;
  /** Optional caption for the current step (e.g. "i=2, j=5 → swap"). */
  caption?: ReactNode;
  /** Show the scrubber slider. Default true. */
  scrubber?: boolean;
  className?: string;
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

/** Prev / Play-Pause / Next / Reset + speed + scrubber for step-through animations. */
export function StepControls({ stepper: s, speeds = [0.5, 1, 1.5, 2, 4], keyboard = true, caption, scrubber = true, className }: StepControlsProps) {
  useEffect(() => {
    if (!keyboard) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        s.pause();
        s.next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        s.pause();
        s.prev();
      } else if (e.key === ' ') {
        e.preventDefault();
        s.toggle();
      } else if (e.key === 'r' || e.key === 'R') {
        s.reset();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboard, s]);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="ghost" iconOnly aria-label="Reset" title="Reset (R)" icon={<RotateCcw size={14} />} onClick={s.reset} />
        <Button
          size="sm"
          variant="secondary"
          iconOnly
          aria-label="Previous step"
          title="Previous (←)"
          icon={<ChevronLeft size={16} />}
          disabled={s.atStart}
          onClick={() => {
            s.pause();
            s.prev();
          }}
        />
        <Button
          size="sm"
          variant="primary"
          aria-label={s.playing ? 'Pause' : 'Play'}
          title={s.playing ? 'Pause (Space)' : 'Play (Space)'}
          icon={s.playing ? <Pause size={14} /> : <Play size={14} />}
          onClick={s.toggle}
          className="min-w-[84px]"
        >
          {s.playing ? 'Pause' : s.atEnd && s.total > 1 ? 'Replay' : 'Play'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          iconOnly
          aria-label="Next step"
          title="Next (→)"
          icon={<ChevronRight size={16} />}
          disabled={s.atEnd}
          onClick={() => {
            s.pause();
            s.next();
          }}
        />
        <span className="ml-1 font-mono text-xs tabular-nums text-muted">
          step <span className="text-ink">{s.total ? s.step + 1 : 0}</span>/{s.total}
        </span>
        <div className="ml-auto flex items-center gap-0.5 rounded border border-line bg-surface p-0.5">
          {speeds.map((sp) => (
            <button
              key={sp}
              type="button"
              onClick={() => s.setSpeed(sp)}
              className={cn(
                'rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums transition-colors',
                s.speed === sp ? 'bg-ink text-paper' : 'text-muted hover:text-ink',
              )}
            >
              {sp}×
            </button>
          ))}
        </div>
      </div>
      {scrubber && s.total > 1 && (
        <input
          type="range"
          min={0}
          max={s.total - 1}
          value={s.step}
          onChange={(e) => {
            s.pause();
            s.goTo(Number(e.target.value));
          }}
          aria-label="Scrub steps"
          className="h-1 w-full cursor-pointer accent-[rgb(var(--c-accent))]"
        />
      )}
      {caption && <div className="font-mono text-xs leading-relaxed text-ink">{caption}</div>}
      {keyboard && (
        <div className="flex items-center gap-2 font-mono text-[10.5px] text-faint">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd> step <Kbd>Space</Kbd> play <Kbd>R</Kbd> reset
        </div>
      )}
    </div>
  );
}
