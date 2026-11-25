import { cn } from '@/shared/cn';
import type { Viz } from '../engine/types';
import { ArrayView, BitsView, ChipsView, GridView, IntervalsView, MapView, SetView, StackView, TextView } from './basic';
import { DecisionView, GraphView, HeapView, ListView, TreeView } from './structures';

const wide = new Set<Viz['kind']>(['array', 'list', 'tree', 'graph', 'grid', 'heap', 'intervals', 'bits', 'decision', 'text']);

export function VizItem({ v }: { v: Viz }) {
  switch (v.kind) {
    case 'array':
      return <ArrayView v={v} />;
    case 'map':
      return <MapView v={v} />;
    case 'set':
      return <SetView v={v} />;
    case 'stack':
      return <StackView v={v} />;
    case 'list':
      return <ListView v={v} />;
    case 'tree':
      return <TreeView v={v} />;
    case 'graph':
      return <GraphView v={v} />;
    case 'grid':
      return <GridView v={v} />;
    case 'heap':
      return <HeapView v={v} />;
    case 'intervals':
      return <IntervalsView v={v} />;
    case 'bits':
      return <BitsView v={v} />;
    case 'decision':
      return <DecisionView v={v} />;
    case 'chips':
      return <ChipsView v={v} />;
    case 'text':
      return <TextView v={v} />;
  }
}

/** Lays out all structures of a frame: big structures full-width, maps/sets/stacks side by side. */
export function VizView({ viz, className }: { viz: Viz[]; className?: string }) {
  if (!viz.length) return <div className="p-6 text-center text-sm text-faint">nothing to draw at this step</div>;
  return (
    <div className={cn('flex flex-wrap gap-3', className)}>
      {viz.map((v, i) => (
        <section
          key={`${v.kind}:${v.name}:${i}`}
          className={cn('min-w-0 rounded-lg border border-line/70 bg-surface/60 p-3', wide.has(v.kind) ? 'basis-full' : 'min-w-[11rem] flex-1')}
        >
          <header className="mb-2 flex items-baseline justify-between gap-2">
            <span className="font-mono text-xs font-semibold text-muted">{v.name}</span>
            {v.caption && <span className="truncate text-[11px] text-faint">{v.caption}</span>}
          </header>
          <VizItem v={v} />
        </section>
      ))}
    </div>
  );
}
