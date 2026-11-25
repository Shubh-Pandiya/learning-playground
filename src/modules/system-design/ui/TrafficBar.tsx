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
}

const STOPS = [0.5, 1, 2, 4, 10];

/** Traffic multiplier + spike buttons + chaos reset, floating at the bottom of the canvas. */
export function TrafficBar({ traffic, setTraffic, animate, setAnimate, anyDown, onRestoreAll }: TrafficProps) {
  return (
    <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-line bg-surface/95 px-2.5 py-1.5 shadow-paper backdrop-blur">
      <Activity size={14} className="text-accent" />
      <span className="font-mono text-[10px] uppercase tracking-wider text-faint">traffic</span>
      <div className="flex overflow-hidden rounded-md border border-line">
        {STOPS.map((s) => (
          <button
            key={s}
            onClick={() => setTraffic(s)}
            className={cn(
              'px-2 py-0.5 font-mono text-[11px] transition',
              traffic === s ? (s >= 4 ? 'bg-bad text-paper' : 'bg-ink text-paper') : s >= 4 ? 'text-bad hover:bg-bad/10' : 'text-muted hover:bg-ink/5',
            )}
          >
            {s === 1 ? 'peak' : `${s}×`}
          </button>
        ))}
      </div>
      <span className="mx-1 h-4 w-px bg-line" />
      <Tooltip content={animate ? 'Pause request animation' : 'Animate requests'}>
        <Button size="xs" variant="ghost" iconOnly aria-label="Toggle animation" icon={animate ? <Pause size={13} /> : <Play size={13} />} onClick={() => setAnimate(!animate)} />
      </Tooltip>
      {anyDown && (
        <Button size="xs" variant="success" icon={<RotateCcw size={12} />} onClick={onRestoreAll}>
          Restore all
        </Button>
      )}
    </div>
  );
}
