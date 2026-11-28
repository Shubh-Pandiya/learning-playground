import { useMemo, useRef, useState } from 'react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, CheckCircle2, GripVertical, Plus, ShieldAlert, X } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button } from '@/shared/ui';
import { LabFrame, rng, Slider, Stat, useTicker } from './kit';

type F = 'cors' | 'ip-limit' | 'authn' | 'user-limit' | 'authz' | 'validate' | 'cache' | 'router';
type C = 'legit' | 'heavy' | 'badtoken' | 'flood' | 'preflight';

const FILTERS: Record<F, { name: string; short: string; ms: number; what: string }> = {
  cors: { name: 'CORS', short: 'cors', ms: 0.005, what: 'Answers browser OPTIONS preflights (204) and adds CORS headers.' },
  'ip-limit': { name: 'IP rate limit', short: 'ip-lim', ms: 0.01, what: 'Coarse per-IP token bucket kept in local memory, so it costs almost nothing.' },
  authn: { name: 'AuthN (JWT)', short: 'authn', ms: 0.08, what: 'Verifies the RS256 signature with a cached JWKS key, then exp/aud/iss. CPU-heavy (~80 µs).' },
  'user-limit': { name: 'User quota', short: 'quota', ms: 0.6, what: 'Global per-user token bucket via Redis / Envoy RLS: one network RTT per request.' },
  authz: { name: 'AuthZ policy', short: 'authz', ms: 0.15, what: 'Checks scopes/roles on the verified identity (local OPA / RBAC).' },
  validate: { name: 'Schema validate', short: 'valid', ms: 0.25, what: 'Parses the body and validates it against the OpenAPI schema.' },
  cache: { name: 'Response cache', short: 'cache', ms: 0.05, what: 'Serves cached GET responses (~40% hit ratio here).' },
  router: { name: 'Router', short: 'router', ms: 0.02, what: 'Picks the upstream cluster and forwards. Terminal: filters after it never run.' },
};
const CLASSES: { id: C; label: string; color: string; hint: string }[] = [
  { id: 'legit', label: 'legit users', color: 'rgb(var(--c-ok))', hint: 'valid token, within quota' },
  { id: 'heavy', label: 'quota abusers', color: 'rgb(var(--c-warn))', hint: 'valid token, 5× over their plan' },
  { id: 'badtoken', label: 'bad tokens', color: 'rgb(var(--c-violet))', hint: 'credential stuffing / forged JWTs' },
  { id: 'flood', label: 'IP flood', color: 'rgb(var(--c-bad))', hint: 'unauthenticated L7 flood from a few IPs' },
  { id: 'preflight', label: 'CORS preflight', color: 'rgb(var(--c-info))', hint: 'browser OPTIONS, no Authorization header' },
];
const REFERENCE: F[] = ['cors', 'ip-limit', 'authn', 'user-limit', 'authz', 'validate', 'cache', 'router'];
const ABUSE: C[] = ['heavy', 'badtoken', 'flood'];

type Outcome = 'served' | 'cached' | 'answered' | 'rejected' | 'leak' | 'dropped';
interface Step {
  rej: number;
  outcome?: Outcome;
}

/** What filter `f` does to a request of class `c`, given whether identity is already verified. */
function act(f: F, c: C, identity: boolean): Step {
  switch (f) {
    case 'cors':
      return c === 'preflight' ? { rej: 1, outcome: 'answered' } : { rej: 0 };
    case 'ip-limit':
      return c === 'flood' ? { rej: 0.9, outcome: 'rejected' } : { rej: 0 };
    case 'authn':
      return c === 'badtoken' || c === 'flood' || c === 'preflight' ? { rej: 1, outcome: 'rejected' } : { rej: 0 };
    case 'user-limit':
      return identity && c === 'heavy' ? { rej: 0.8, outcome: 'rejected' } : { rej: 0 };
    case 'authz':
      return identity ? { rej: 0 } : { rej: 1, outcome: 'rejected' };
    case 'validate':
      return c === 'flood' ? { rej: 0.6, outcome: 'rejected' } : { rej: 0 };
    case 'cache':
      if (c === 'preflight') return { rej: 0 };
      return { rej: 0.4, outcome: identity || c === 'legit' || c === 'heavy' ? 'cached' : 'leak' };
    case 'router':
      return { rej: 1, outcome: 'served' };
  }
}

interface Eval {
  cpuMs: number;
  redisOps: number;
  legitOk: number;
  legitLatency: number;
  backend: number;
  backendAbuse: number;
  leaked: number;
  rejectedAt: Partial<Record<F, number>>;
  issues: { tone: 'bad' | 'warn'; text: string }[];
  good: string[];
}

function evaluate(chain: F[], rates: Record<C, number>): Eval {
  const r: Eval = { cpuMs: 0, redisOps: 0, legitOk: 0, legitLatency: 0, backend: 0, backendAbuse: 0, leaked: 0, rejectedAt: {}, issues: [], good: [] };
  const routerAt = chain.indexOf('router');
  const live = routerAt >= 0 ? chain.slice(0, routerAt + 1) : chain;
  let legitServed = 0;
  let preflightOk = 0;
  for (const cls of CLASSES) {
    let m = rates[cls.id];
    let identity = false;
    let lat = 0;
    for (const f of live) {
      if (m <= 0) break;
      r.cpuMs += m * FILTERS[f].ms;
      if (f === 'user-limit') r.redisOps += m;
      if (cls.id === 'legit') lat += FILTERS[f].ms;
      const s = act(f, cls.id, identity);
      const out = m * s.rej;
      if (out > 0) {
        if (s.outcome === 'rejected') r.rejectedAt[f] = (r.rejectedAt[f] ?? 0) + out;
        if (s.outcome === 'served') {
          r.backend += out;
          if (ABUSE.includes(cls.id)) r.backendAbuse += out;
          if (cls.id === 'legit') legitServed += out;
        }
        if (s.outcome === 'cached' && cls.id === 'legit') legitServed += out;
        if (s.outcome === 'leak') r.leaked += out;
        if (s.outcome === 'answered' && cls.id === 'preflight') preflightOk += out;
      }
      m -= out;
      if (f === 'authn') identity = true;
    }
    if (cls.id === 'legit') r.legitLatency = lat;
  }
  const legitTotal = rates.legit + rates.preflight;
  r.legitOk = legitTotal ? (legitServed + preflightOk) / legitTotal : 1;

  const pos = (f: F) => chain.indexOf(f);
  const before = (a: F, b: F) => pos(a) >= 0 && pos(b) >= 0 && pos(a) < pos(b);
  const has = (f: F) => pos(f) >= 0 && (routerAt < 0 || pos(f) < routerAt);
  if (routerAt < 0) r.issues.push({ tone: 'bad', text: 'No router: nothing is forwarded. Every request ends in a 404 from the gateway.' });
  const dead = routerAt >= 0 ? chain.slice(routerAt + 1) : [];
  if (dead.length) r.issues.push({ tone: 'bad', text: `${dead.map((f) => FILTERS[f].name).join(', ')} sit after the router, so they never run. In Envoy the router filter is terminal and must be last.` });
  if (!has('authn')) r.issues.push({ tone: 'bad', text: 'No authentication before the router: forged and missing tokens reach your services.' });
  if (has('authn') && has('cors') && before('authn', 'cors')) r.issues.push({ tone: 'bad', text: 'CORS after AuthN: browser preflights carry no Authorization header, get 401, and the web app breaks. Answer OPTIONS first.' });
  if (has('authn') && !has('cors') && rates.preflight > 0) r.issues.push({ tone: 'warn', text: 'No CORS filter: preflights fall into AuthN and get 401. Browser clients cannot call this API.' });
  if (has('user-limit') && (!has('authn') || before('user-limit', 'authn')))
    r.issues.push({ tone: 'bad', text: 'User quota runs before identity is verified, so it can only key on a claimed, unverified user id. Abusers rotate it and bypass the quota, and every junk request still costs a Redis call.' });
  if (has('authz') && (!has('authn') || before('authz', 'authn'))) r.issues.push({ tone: 'bad', text: 'AuthZ before AuthN: there is no verified identity yet, so the policy sees anonymous and denies everyone (403).' });
  if (has('cache') && (!has('authn') || before('cache', 'authn')))
    r.issues.push({ tone: 'bad', text: 'Response cache before AuthN: cached (possibly private) responses go to unauthenticated callers. This is a data leak. Cache after auth, keyed by user or only for public routes.' });
  if (has('authn') && has('ip-limit') && before('authn', 'ip-limit'))
    r.issues.push({ tone: 'warn', text: 'IP limit after AuthN: the flood is signature-verified before it is dropped, so you burn CPU on RSA verifies for junk. Put cheap rejections first.' });
  if (!has('ip-limit') && rates.flood > 0) r.issues.push({ tone: 'warn', text: 'No coarse IP limit: the L7 flood reaches AuthN (and possibly the quota store) at full rate.' });
  if (has('validate') && has('user-limit') && before('validate', 'user-limit')) r.issues.push({ tone: 'warn', text: 'Body validation before the quota check: you parse bodies for requests you will reject with 429 anyway.' });
  if (!has('user-limit') && rates.heavy > 0) r.issues.push({ tone: 'warn', text: 'No per-user quota: abusers with valid tokens consume backend capacity unchecked.' });
  if (has('cache') && has('validate') && before('cache', 'validate') && has('authn') && before('authn', 'cache')) r.good.push('Cache before validation is fine for idempotent GETs, since hits skip body parsing.');
  if (chain.join() === REFERENCE.join()) r.good.push('This is the reference order: cheapest rejections first, identity before anything keyed on identity, terminal router last.');
  return r;
}

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
  const [rates, setRates] = useState<Record<C, number>>({ legit: 2000, heavy: 300, badtoken: 500, flood: 20000, preflight: 400 });
  const [running, setRunning] = useState(true);
  const [, force] = useState(0);
  const dots = useRef<Dot[]>([]);
  const seq = useRef(0);
  const rand = useRef(rng(7));
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ev = useMemo(() => evaluate(chain, rates), [chain, rates]);
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
      let identity = false;
      let stop = lane.length;
      let outcome: Outcome = 'dropped';
      for (let i = 0; i < lane.length; i++) {
        const s = act(lane[i], c, identity);
        if (lane[i] === 'authn') identity = true;
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
          <Stat label="added latency (legit)" value={`${(ev.legitLatency * 1000).toFixed(0)}µs`} tone={ev.leaked > 0 ? 'bad' : undefined} sub={ev.leaked > 0 ? `${fmtRate(ev.leaked)} rps leaked from cache` : 'gateway filters only'} />
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
