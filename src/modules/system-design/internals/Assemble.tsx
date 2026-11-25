import { useMemo, useState } from 'react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, GripVertical, Shuffle, X } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button } from '@/shared/ui';
import { Rich } from '../ui/Rich';
import type { InternalPart, Internals } from './types';

/** Deterministic shuffle that never returns the solved order. */
function shuffle(ids: string[], seed: number): string[] {
  const a = [...ids];
  let s = seed + 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  if (a.every((x, i) => x === ids[i])) a.reverse();
  return a;
}

function Item({ part, state, index }: { part: InternalPart; state?: 'right' | 'wrong'; index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: part.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 rounded-lg border bg-surface px-2 py-1.5',
        isDragging ? 'z-10 border-accent shadow-lift' : state === 'right' ? 'border-ok/60 bg-ok/[0.06]' : state === 'wrong' ? 'border-bad/60 bg-bad/[0.06]' : 'border-line',
      )}
    >
      <button {...attributes} {...listeners} className="cursor-grab touch-none text-faint hover:text-ink active:cursor-grabbing" aria-label={`Drag ${part.name}`}>
        <GripVertical size={15} />
      </button>
      <span className="w-5 font-mono text-[10.5px] text-faint">{index + 1}.</span>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[12px] font-semibold">{part.name}</div>
        <div className="text-[11px] text-muted">{part.role}</div>
      </div>
      {state === 'right' && <Check size={15} className="text-ok" />}
      {state === 'wrong' && <X size={15} className="text-bad" />}
    </li>
  );
}

/** Drag-and-drop: rebuild the component by ordering its parts along the request path. */
export function Assemble({ data, onSolved }: { data: Internals; onSolved?: () => void }) {
  const ids = useMemo(() => data.parts.map((p) => p.id), [data]);
  const [seed, setSeed] = useState(0);
  const [order, setOrder] = useState(() => shuffle(ids, 0));
  const [checked, setChecked] = useState(false);
  const [tries, setTries] = useState(0);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const byId = new Map(data.parts.map((p) => [p.id, p]));
  const right = order.filter((id, i) => id === ids[i]).length;
  const solved = checked && right === ids.length;

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setOrder((o) => arrayMove(o, o.indexOf(String(e.active.id)), o.indexOf(String(e.over!.id))));
    setChecked(false);
  };

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-muted">
        Rebuild it from memory: drag the parts into the order a request (or a write) passes through them. Generating the structure yourself sticks far better than re-reading it.
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ol className="space-y-1.5">
            {order.map((id, i) => (
              <Item key={id} part={byId.get(id)!} index={i} state={checked ? (id === ids[i] ? 'right' : 'wrong') : undefined} />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          icon={<Check size={14} />}
          onClick={() => {
            setChecked(true);
            setTries((t) => t + 1);
            if (order.every((id, i) => id === ids[i])) onSolved?.();
          }}
        >
          Check order
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Shuffle size={14} />}
          onClick={() => {
            setSeed((s) => s + 1);
            setOrder(shuffle(ids, seed + 1));
            setChecked(false);
          }}
        >
          Reshuffle
        </Button>
        {checked && (
          <span className={cn('font-mono text-[12px]', solved ? 'text-ok' : 'text-warn')}>
            {solved ? `Assembled${tries > 1 ? ` in ${tries} tries` : ' first try'}!` : `${right}/${ids.length} in the right place`}
          </span>
        )}
      </div>
      {solved && (
        <div className="space-y-1.5 rounded-lg border border-ok/40 bg-ok/[0.05] p-3">
          <div className="eyebrow text-ok">Why this order</div>
          {data.flow.map((f, i) => (
            <p key={i} className="text-[12px] leading-relaxed text-muted">
              <b className="font-mono text-ink">{byId.get(f.part)?.name}:</b> <Rich text={f.text} />
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
