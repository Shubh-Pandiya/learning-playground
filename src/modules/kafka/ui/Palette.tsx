import { cn } from '@/shared/cn';
import { Tooltip } from '@/shared/ui';
import { CATEGORY_LABEL, CATEGORY_ORDER, KINDS } from '../data/components';
import type { KKind } from '../types';
import { DND_MIME } from './Canvas';
import { Glyph } from './Glyph';

export function Palette({ kinds, onAdd, compact }: { kinds: KKind[]; onAdd: (k: KKind) => void; compact?: boolean }) {
  return (
    <div className="space-y-3">
      {CATEGORY_ORDER.map((cat) => {
        const list = kinds.filter((k) => KINDS[k].category === cat);
        if (!list.length) return null;
        return (
          <div key={cat}>
            <div className={cn('eyebrow mb-1.5', cat === 'trap' && 'text-bad')}>{CATEGORY_LABEL[cat]}</div>
            <div className={cn('grid gap-1.5', compact ? 'grid-cols-1' : 'grid-cols-2')}>
              {list.map((k) => {
                const d = KINDS[k];
                return (
                  <Tooltip
                    key={k}
                    side="right"
                    content={
                      <div className="max-w-[240px] space-y-1 text-[12px]">
                        <div className="font-semibold">{d.name}</div>
                        <div className="opacity-80">{d.solves}</div>
                        {d.trap && <div className="text-bad">Trap: {d.trap.why}</div>}
                      </div>
                    }
                  >
                    <button
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DND_MIME, k);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onClick={() => onAdd(k)}
                      className={cn(
                        'flex w-full cursor-grab items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1.5 text-left transition hover:border-accent hover:shadow-paper active:cursor-grabbing',
                        d.category === 'trap' && 'border-dashed',
                      )}
                    >
                      <Glyph kind={k} size={24} />
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] font-medium leading-tight text-ink">{d.name}</span>
                        <span className="block truncate font-mono text-[9.5px] leading-tight text-faint">{d.tech}</span>
                      </span>
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="text-[11px] leading-snug text-faint">Drag onto the canvas (or click). Connect by dragging from a node’s right handle to another node. Select + Delete removes.</p>
    </div>
  );
}
