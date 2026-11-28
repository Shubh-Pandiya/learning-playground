import { useMemo, useRef, useState } from 'react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, CheckCircle2, GripVertical, Plus, ShieldAlert, X } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button } from '@/shared/ui';
import { act, advance, CLASSES, DEFAULT_RATES, evaluate, FILTERS, REFERENCE, type C, type CacheScope, type F, type Outcome, type Proven } from './gatewayModel';
import { LabFrame, rng, Seg, Slider, Stat, useTicker } from './kit';

function Chip({ f, onRemove, rejected }: { f: F; onRemove: () => void; rejected?: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: f });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex items-center gap-1 rounded-md border bg-surface px-1.5 py-1', isDragging ? 'z-10 border-accent shadow-lift' : 'border-line', f === 'router' && 'border-accent/50')}
      title={FILTERS[f].what}
    >
      <button {...attributes} {...listeners} className="cursor-grab text-faint active:cursor-grabbing" aria-label={`drag ${FILTERS[f].name}`}>
        <GripVertical size={12} />
      </button>
      <span className="font-mono text-[11px] font-semibold">{FILTERS[f].name}</span>
      {rejected ? <span className="rounded bg-bad/10 px-1 font-mono text-[9.5px] text-bad">−{fmtRate(rejected)}</span> : null}
      <button onClick={onRemove} className="text-faint hover:text-bad" aria-label={`remove ${FILTERS[f].name}`}>
        <X size={11} />
      </button>
    </div>
  );
}

const fmtRate = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);

interface Dot {
  id: number;
  c: C;
  at: number;
  stop: number;
  outcome: Outcome;
  ttl: number;
}

export default function GatewayLab() {
  const [chain, setChain] = useState<F[]>(['router', 'authn', 'user-limit', 'cors', 'cache']);
  const [rates, setRates] = useState<Record<C, number>>(DEFAULT_RATES);
  const [scope, setScope] = useState<CacheScope>('shared');
  const [running, setRunning] = useState(true);
  const [, force] = useState(0);
  const dots = useRef<Dot[]>([]);
  const seq = useRef(0);
  const rand = useRef(rng(7));
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ev = useMemo(() => evaluate(chain, rates, scope), [chain, rates, scope]);
  const palette = (Object.keys(FILTERS) as F[]).filter((f) => !chain.includes(f));
  const routerAt = chain.indexOf('router');
  const lane = routerAt >= 0 ? chain.slice(0, routerAt + 1) : chain;

  useTicker(running, 90, () => {
    const R = rand.current;
    // spawn: sqrt-weighted so the flood is visible without drowning the rest
    const w = CLASSES.map((c) => Math.sqrt(rates[c.id]));
    const tot = w.reduce((a, b) => a + b, 0);
    if (tot > 0 && R() < 0.9) {
      let x = R() * tot;
      let ci = 0;
      while (x > w[ci] && ci < w.length - 1) x -= w[ci++];
      const c = CLASSES[ci].id;
      let p: Proven = { identity: false, authorized: false };
      let stop = lane.length;
      let outcome: Outcome = 'dropped';
      for (let i = 0; i < lane.length; i++) {
        const s = act(lane[i], c, p, scope);
        p = advance(lane[i], p);
        if (s.rej > 0 && R() < s.rej) {
          stop = i;
          outcome = s.outcome ?? 'rejected';
          break;
        }
      }
      dots.current.push({ id: seq.current++, c, at: -0.5, stop, outcome, ttl: 8 });
    }
    for (const d of dots.current) {
      if (d.at < d.stop) d.at = Math.min(d.stop, d.at + 0.22);
      else d.ttl--;
    }
    dots.current = dots.current.filter((d) => d.ttl > 0).slice(-80);
    force((n) => n + 1);
  });

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setChain((c) => arrayMove(c, c.indexOf(e.active.id as F), c.indexOf(e.over!.id as F)));
  };
  const n = Math.max(lane.length, 1);
  const cores = ev.cpuMs / 1000;
  const color = (c: C) => CLASSES.find((x) => x.id === c)!.color;

  return (
    <LabFrame
      title="Gateway filter chain: order is a design decision"
      goal="Drag filters into an order (and add or remove them). Watch what reaches the backend, what it costs the gateway, and what breaks. Start from the broken chain on the right and fix it."
      running={running}
      onToggle={() => setRunning((r) => !r)}
      onReset={() => {
        setChain(['router', 'authn', 'user-limit', 'cors', 'cache']);
        dots.current = [];
      }}
      controls={
        <>
          <div className="space-y-2 sm:col-span-2">
            <div className="eyebrow">Filter chain · request flows left → right (drag to reorder)</div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={chain} strategy={rectSortingStrategy}>
                <div className="flex min-h-[34px] flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-line p-1.5">
                  <span className="font-mono text-[10px] text-faint">client →</span>
                  {chain.map((f) => (
                    <Chip key={f} f={f} rejected={ev.rejectedAt[f]} onRemove={() => setChain((c) => c.filter((x) => x !== f))} />
                  ))}
                  <span className="font-mono text-[10px] text-faint">→ services</span>
                </div>
              </SortableContext>
            </DndContext>
            <div className="flex flex-wrap items-center gap-1">
              <span className="font-mono text-[10px] text-faint">available:</span>
              {palette.map((f) => (
                <button
                  key={f}
                  title={FILTERS[f].what}
                  onClick={() => setChain((c) => (c.includes('router') && f !== 'router' ? [...c.slice(0, c.indexOf('router')), f, ...c.slice(c.indexOf('router'))] : [...c, f]))}
                  className="flex items-center gap-0.5 rounded-md border border-dashed border-line px-1.5 py-0.5 font-mono text-[10.5px] text-muted hover:border-accent hover:text-ink"
                >
                  <Plus size={10} /> {FILTERS[f].name}
                </button>
              ))}
              {palette.length === 0 && <span className="font-mono text-[10px] text-faint">all filters in use</span>}
              <Button size="xs" variant="ghost" onClick={() => setChain(REFERENCE)}>
                show reference order
              </Button>
            </div>
          </div>
          <Seg
            label="Response cache holds"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'shared', label: 'protected responses (shared key)', hint: 'e.g. /tenants/42/invoices cached by route and reused across callers' },
              { value: 'public', label: 'public GETs only', hint: 'Cache-Control: public resources such as catalog pages; never user-specific data' },
            ]}
          />
          {CLASSES.map((c) => (
            <Slider
              key={c.id}
              label={`${c.label} · ${c.hint}`}
              value={rates[c.id]}
              min={0}
              max={c.id === 'flood' ? 50000 : 5000}
              step={c.id === 'flood' ? 1000 : 100}
              onChange={(v) => setRates((r) => ({ ...r, [c.id]: v }))}
              fmt={(v) => `${fmtRate(v)} rps`}
            />
          ))}
        </>
      }
      stats={
        <>
          <Stat label="legit success" value={`${Math.round(ev.legitOk * 100)}%`} tone={ev.legitOk > 0.98 ? 'ok' : ev.legitOk > 0.8 ? 'warn' : 'bad'} sub="users + browser preflights" />
          <Stat label="abusive rps at backend" value={fmtRate(ev.backendAbuse)} tone={ev.backendAbuse < 100 ? 'ok' : ev.backendAbuse < 1000 ? 'warn' : 'bad'} sub={`of ${fmtRate(ev.backend)} rps forwarded`} />
          <Stat label="gateway CPU" value={`${cores.toFixed(2)} cores`} tone={cores < 0.6 ? 'ok' : cores < 1.5 ? 'warn' : 'bad'} sub={`quota store: ${fmtRate(ev.redisOps)} ops/s`} />
          <Stat label="added latency (legit)" value={`${(ev.legitLatency * 1000).toFixed(0)}µs`} tone={ev.leaked > 0 ? 'bad' : undefined} sub={ev.leaked > 0 ? `${fmtRate(ev.leaked)} rps leaked from cache${ev.leakedBy.forbidden ? ' (incl. authz bypass)' : ''}` : 'gateway filters only'} />
        </>
      }
      insight={
        <div className="space-y-1">
          {ev.issues.length === 0 && ev.good.length === 0 && <span>No ordering problems. Try removing the IP limit and turning the flood up to see why cheap rejections go first.</span>}
          {ev.issues.map((i, k) => (
            <div key={k} className="flex gap-1.5">
              {i.tone === 'bad' ? <ShieldAlert size={13} className="mt-0.5 shrink-0 text-bad" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" />}
              <span>{i.text}</span>
            </div>
          ))}
          {ev.good.map((g, k) => (
            <div key={k} className="flex gap-1.5">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-ok" />
              <span>{g}</span>
            </div>
          ))}
        </div>
      }
    >
      <div className="relative h-[118px] select-none">
        <div className="absolute inset-x-0 top-[14px] grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0,1fr))` }}>
          {lane.map((f) => (
            <div key={f} className="mx-0.5 rounded-md border border-line bg-surface py-1 text-center">
              <div className="truncate font-mono text-[10px] font-semibold">{FILTERS[f].short}</div>
              <div className="font-mono text-[9px] text-faint">{FILTERS[f].ms < 0.1 ? `${Math.round(FILTERS[f].ms * 1000)}µs` : `${FILTERS[f].ms}ms`}</div>
            </div>
          ))}
        </div>
        <div className="absolute inset-x-0 top-[62px] h-[44px] rounded-md border border-dashed border-line/70">
          {dots.current.map((d) => {
            const x = ((Math.max(d.at, -0.5) + 0.5) / n) * 100;
            const done = d.at >= d.stop;
            const fate = done ? d.outcome : null;
            const y = (d.id * 37) % 34;
            return (
              <span
                key={d.id}
                className={cn('absolute h-[8px] w-[8px] rounded-full transition-[left] duration-100', fate === 'rejected' && 'opacity-40', fate === 'leak' && 'animate-pulse ring-2 ring-bad')}
                style={{ left: `calc(${Math.min(x, 100)}% - 4px)`, top: 4 + y, background: color(d.c) }}
              />
            );
          })}
        </div>
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap justify-center gap-x-3 font-mono text-[9.5px] text-faint">
          {CLASSES.map((c) => (
            <span key={c.id} className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
              {c.label}
            </span>
          ))}
          <span>· faded = rejected · ringed = leaked</span>
        </div>
      </div>
    </LabFrame>
  );
}
