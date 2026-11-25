import type { ReactNode } from 'react';
import { Activity, Pause, Play, RotateCcw } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Tooltip } from '@/shared/ui';

export interface TrafficProps {
  traffic: number;
  setTraffic: (t: number) => void;
  animate: boolean;
  setAnimate: (a: boolean) => void;
  anyDown: boolean;
  onRestoreAll: () => void;
  /** Extra controls (the chaos menu). */
  children?: ReactNode;
}

const STOPS = [0.5, 1, 2, 3, 5];

/** Data-volume multiplier + animation toggle + chaos menu + restore, floating at the bottom of the canvas. */
export function TrafficBar({ traffic, setTraffic, animate, setAnimate, anyDown, onRestoreAll, children }: TrafficProps) {
  return (
    <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-line bg-surface/95 px-2.5 py-1.5 shadow-paper backdrop-blur">
      <Activity size={14} className="text-accent" />
      <span className="font-mono text-[10px] uppercase tracking-wider text-faint">volume</span>
      <div className="flex overflow-hidden rounded-md border border-line">
        {STOPS.map((s) => (
          <button
            key={s}
            onClick={() => setTraffic(s)}
            className={cn(
              'px-2 py-0.5 font-mono text-[11px] transition',
              traffic === s ? (s >= 3 ? 'bg-bad text-paper' : 'bg-ink text-paper') : s >= 3 ? 'text-bad hover:bg-bad/10' : 'text-muted hover:bg-ink/5',
            )}
          >
            {s === 1 ? 'normal' : `${s}×`}
          </button>
        ))}
      </div>
      <span className="mx-1 h-4 w-px bg-line" />
      <Tooltip content={animate ? 'Pause data-flow animation' : 'Animate data flow'}>
        <Button size="xs" variant="ghost" iconOnly aria-label="Toggle animation" icon={animate ? <Pause size={13} /> : <Play size={13} />} onClick={() => setAnimate(!animate)} />
      </Tooltip>
      {children}
      {anyDown && (
        <Button size="xs" variant="success" icon={<RotateCcw size={12} />} onClick={onRestoreAll}>
          Restore all
        </Button>
      )}
    </div>
  );
}
