import { cn } from '@/shared/cn';
import { Tooltip } from '@/shared/ui';
import { CATEGORY_LABEL, CATEGORY_ORDER, COMPONENTS, isSource } from '../data/components';
import type { ComponentKind } from '../types';
import { DND_MIME } from './Canvas';
import { IsoGlyph } from './iso';

export interface PaletteProps {
  kinds: ComponentKind[];
  onCanvas: Record<string, number>;
  onAdd: (kind: ComponentKind) => void;
}

export function Palette({ kinds, onCanvas, onAdd }: PaletteProps) {
  const groups = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: kinds.filter((k) => COMPONENTS[k].category === cat && !isSource(k)),
  }));
  return (
    <div className="space-y-4">
      <p className="text-[11.5px] leading-snug text-muted">
        Drag onto the canvas (or click). Connect by dragging from a node's right dot to another node. Some of these are traps.
      </p>
      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <div key={g.cat}>
            <div className="eyebrow mb-1.5">{CATEGORY_LABEL[g.cat]}</div>
            <div className="grid grid-cols-2 gap-1.5">
              {g.items.map((k) => {
                const def = COMPONENTS[k];
                const n = onCanvas[k] ?? 0;
                return (
                  <Tooltip key={k} side="right" content={<span className="block max-w-[240px] text-[12px] leading-snug">{def.solves}</span>}>
                    <button
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DND_MIME, k);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onClick={() => onAdd(k)}
                      className={cn(
                        'relative flex cursor-grab flex-col items-center rounded-lg border bg-surface px-1 pb-1.5 pt-1 text-center transition hover:-translate-y-px hover:border-accent/60 hover:shadow-lift active:cursor-grabbing',
                        n ? 'border-accent/40' : 'border-line',
                      )}
                    >
                      {n > 0 && <span className="absolute right-1 top-1 rounded-full bg-accent px-1 font-mono text-[9px] text-accent-ink">{n}</span>}
                      <IsoGlyph kind={k} size={40} />
                      <span className="mt-0.5 w-full truncate font-mono text-[10.5px] font-semibold leading-tight">{def.name}</span>
                      <span className="w-full truncate font-mono text-[9px] leading-tight text-faint">{def.tech}</span>
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}
