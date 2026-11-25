import { useState } from 'react';
import { LayoutGroup, motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/shared/cn';
import { StepControls, useStepper } from '@/shared/ui';
import { Rich } from '../ui/Rich';
import type { Internals } from './types';

/** Animated walk of one request through the component's internal parts. */
export function Anatomy({ data }: { data: Internals }) {
  const stepper = useStepper(data.flow.length, { intervalMs: 4500 });
  const [pinned, setPinned] = useState<string | null>(null);
  const cur = data.flow[stepper.step];
  const focus = pinned ?? cur.part;
  const visited = new Set(data.flow.slice(0, stepper.step + 1).map((f) => f.part));
  const part = data.parts.find((p) => p.id === focus);

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed text-muted">
        <Rich text={data.summary} />
      </p>
      <LayoutGroup id={`anatomy-${data.kind}`}>
        <div className="flex flex-wrap items-stretch gap-y-3 rounded-xl border border-line bg-sunken/40 p-3">
          {data.parts.map((p, i) => {
            const active = p.id === cur.part;
            return (
              <div key={p.id} className="flex items-center">
                <button
                  onClick={() => setPinned((x) => (x === p.id ? null : p.id))}
                  className={cn(
                    'relative w-[118px] rounded-lg border px-2 py-1.5 text-left transition',
                    active ? 'border-accent bg-accent/10 shadow-sm' : visited.has(p.id) ? 'border-accent/40 bg-surface' : 'border-line bg-surface opacity-80',
                    pinned === p.id && 'ring-2 ring-info/50',
                  )}
                >
                  <div className="font-mono text-[9.5px] text-faint">{String(i + 1).padStart(2, '0')}</div>
                  <div className="font-mono text-[11.5px] font-semibold leading-tight">{p.name}</div>
                  <div className="mt-0.5 text-[10.5px] leading-snug text-muted">{p.role}</div>
                  {active && (
                    <motion.span
                      layoutId="packet"
                      className="absolute -right-1.5 -top-1.5 h-3 w-3 rounded-full bg-accent shadow-[0_0_0_4px_rgb(var(--c-accent)/0.2)]"
                      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                    />
                  )}
                </button>
                {i < data.parts.length - 1 && <ChevronRight size={14} className="mx-0.5 shrink-0 text-faint" />}
              </div>
            );
          })}
        </div>
      </LayoutGroup>
      <motion.div key={stepper.step} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-accent/30 bg-accent/[0.05] p-3">
        <div className="font-mono text-[10.5px] uppercase tracking-wider text-accent">
          step {stepper.step + 1}/{data.flow.length} · {data.parts.find((p) => p.id === cur.part)?.name}
        </div>
        <div className="mt-0.5 font-mono text-[13px] font-semibold">{cur.title}</div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          <Rich text={cur.text} />
        </p>
      </motion.div>
      <StepControls stepper={stepper} speeds={[0.5, 1, 2]} caption="click a part to pin its details" />
      {part && (
        <div className="rounded-lg border border-line bg-surface p-3">
          <div className="eyebrow">How it’s built · {part.name}</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink/90">
            <Rich text={part.detail} />
          </p>
        </div>
      )}
    </div>
  );
}
