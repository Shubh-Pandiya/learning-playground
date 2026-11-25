import { useState } from 'react';
import { GripVertical } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Tooltip } from '@/shared/ui';
import type { Scenario } from '../types';
import { KIND, MIME_ATTR, MIME_TPL } from './TableNode';

export interface PaletteProps {
  sc: Scenario;
  /** tpl id → tables on the canvas made from it */
  onCanvas: Record<string, number>;
  unplaced: string[];
  onAdd: (tpl: string) => void;
}

export function Palette({ sc, onCanvas, unplaced, onAdd }: PaletteProps) {
  const [all, setAll] = useState(false);
  const attrs = sc.attrs.filter((a) => (all ? true : unplaced.includes(a.id)));
  return (
    <div className="space-y-4">
      <div>
        <div className="eyebrow mb-1">Tables</div>
        <p className="mb-2 text-[11.5px] leading-snug text-muted">Drag onto the canvas (or click). Some are traps. Drag from a table's right dot onto its parent to add a foreign key.</p>
        <div className="space-y-1.5">
          {sc.templates.map((t) => {
            const n = onCanvas[t.id] ?? 0;
            const k = KIND[t.kind];
            return (
              <Tooltip key={t.id} side="right" content={<span className="block max-w-[260px] text-[12px] leading-snug">{t.blurb}</span>}>
                <button
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(MIME_TPL, t.id);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => onAdd(t.id)}
                  disabled={n > 0}
                  className={cn(
                    'relative flex w-full cursor-grab items-center gap-2 overflow-hidden rounded-lg border bg-surface py-1.5 pl-3 pr-2 text-left transition active:cursor-grabbing',
                    n ? 'cursor-default border-accent/40 opacity-55' : 'border-line hover:-translate-y-px hover:border-accent/60 hover:shadow-lift',
                  )}
                >
                  <span className={cn('absolute inset-y-0 left-0 w-1', k.tone)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[11.5px] font-semibold leading-tight text-ink">{t.name}</span>
                    <span className="block truncate font-mono text-[9.5px] leading-tight text-faint">
                      {k.label} · {t.columns.length} col{t.columns.length === 1 ? '' : 's'}
                    </span>
                  </span>
                  {n > 0 && <span className="rounded-full bg-accent px-1.5 font-mono text-[9px] text-accent-ink">on canvas</span>}
                </button>
              </Tooltip>
            );
          })}
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="eyebrow">Attributes {all ? '' : `· ${unplaced.length} unplaced`}</span>
          <button onClick={() => setAll((v) => !v)} className="font-mono text-[10px] text-accent hover:underline">
            {all ? 'unplaced only' : 'show all'}
          </button>
        </div>
        <p className="mb-2 text-[11.5px] leading-snug text-muted">Drag an attribute onto a table to add it as a column. Drag a column between tables to move it (hold Alt to copy).</p>
        {attrs.length === 0 && <p className="rounded-lg border border-dashed border-line px-2 py-2 text-center text-[11.5px] text-faint">Every attribute is stored somewhere.</p>}
        <div className="flex flex-wrap gap-1">
          {attrs.map((a) => (
            <Tooltip key={a.id} side="right" content={<span className="block max-w-[240px] text-[12px] leading-snug">{a.doc ?? `${a.name ?? a.id} (${a.type})`}</span>}>
              <span
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(MIME_ATTR, a.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                className={cn(
                  'inline-flex cursor-grab items-center gap-0.5 rounded border px-1 py-0.5 font-mono text-[10.5px] active:cursor-grabbing',
                  unplaced.includes(a.id) ? 'border-warn/40 bg-warn/10 text-ink' : 'border-line bg-surface text-muted',
                  a.technical && 'italic text-violet',
                )}
              >
                <GripVertical size={9} className="text-faint" />
                {a.name ?? a.id}
              </span>
            </Tooltip>
          ))}
        </div>
      </div>
    </div>
  );
}
