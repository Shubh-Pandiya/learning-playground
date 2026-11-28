import { useMemo, useRef, useState } from 'react';
import { Skull } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button } from '@/shared/ui';
import { LabFrame, Seg, Slider, Stat, useTicker } from './kit';

type Mode = 'eureka' | 'k8s' | 'dns' | 'mesh';
type Failure = 'crash' | 'host' | 'graceful';
type DnsCache = 'ttl' | 'jvm30' | 'forever';

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: 'eureka', label: 'client-side · Eureka', hint: 'client caches the registry and balances itself' },
  { value: 'k8s', label: 'server-side · k8s Service', hint: 'kube-proxy iptables/IPVS on every node' },
  { value: 'dns', label: 'DNS · TTL', hint: 'health-checked records + resolver/JVM caches' },
  { value: 'mesh', label: 'mesh · Envoy EDS', hint: 'control plane pushes endpoints to sidecars' },
];

interface Knobs {
  hb: number;
  lease: number;
  refresh: number;
  ttl: number;
  hcInterval: number;
  dnsCache: DnsCache;
  preStop: boolean;
  retries: boolean;
  outlier: boolean;
}

interface Timing {
  /** Seconds after the failure until the source of truth stops listing the instance. */
  detect: number;
  /** Further seconds until callers' local view is updated. */
  propagate: number;
  /** For graceful stops: seconds the instance keeps serving after SIGTERM (preStop). */
  servesFor: number;
  parts: string[];
}

function timing(mode: Mode, f: Failure, k: Knobs): Timing {
  switch (mode) {
    case 'eureka': {
      const detect = f === 'graceful' ? 0 : k.lease + 60;
      const propagate = 30 + k.refresh + 30;
      return {
        detect,
        propagate,
        servesFor: 0,
        parts:
          f === 'graceful'
            ? ['DELETE /eureka/apps/… deregisters at once', `server readOnly response cache ≤30s`, `client registry fetch ≤${k.refresh}s`, 'LoadBalancer server-list cache ≤30s']
            : [`last renewal ≤${k.hb}s ago, lease ${k.lease}s`, 'eviction task runs every 60s', 'server response cache ≤30s', `client fetch ≤${k.refresh}s`, 'LB cache ≤30s'],
      };
    }
    case 'k8s': {
      if (f === 'crash') return { detect: 1, propagate: 2, servesFor: 0, parts: ['kubelet sees the container exit, pod Ready=false (~1s)', 'EndpointSlice controller updates (~1s)', 'kube-proxy re-syncs iptables/IPVS (~1s)'] };
      if (f === 'host') return { detect: 45, propagate: 2, servesFor: 0, parts: ['kubelet gone, so no probes run', 'node-monitor-grace-period ~40s, then NotReady', 'pods marked NotReady → endpoints removed', 'kube-proxy sync'] };
      return {
        detect: 0,
        propagate: 3,
        servesFor: k.preStop ? 10 : 0,
        parts: k.preStop
          ? ['pod Terminating → removed from EndpointSlice at once', 'preStop sleep 10s keeps serving while kube-proxy/ingress catch up', 'then SIGTERM, drain, exit']
          : ['SIGTERM and endpoint removal race in parallel', 'app stops accepting at t=0', 'kube-proxy/ingress still route to it for ~1–3s'],
      };
    }
    case 'dns': {
      const cache = k.dnsCache === 'ttl' ? k.ttl : k.dnsCache === 'jvm30' ? Math.max(k.ttl, 30) : 600;
      return {
        detect: f === 'graceful' ? 0 : k.hcInterval * 3,
        propagate: cache,
        servesFor: 0,
        parts: [
          f === 'graceful' ? 'record removed on deregister' : `health checker: 3 failures × ${k.hcInterval}s`,
          `record TTL ${k.ttl}s at resolvers`,
          k.dnsCache === 'ttl' ? 'client honours TTL' : k.dnsCache === 'jvm30' ? 'JVM networkaddress.cache.ttl=30s' : 'client caches "forever" (until restart; shown as 600s)',
          'pooled connections keep the old IP until they break',
        ],
      };
    }
    case 'mesh':
      return {
        detect: f === 'host' ? 45 : f === 'crash' ? 1 : 0,
        propagate: 2,
        servesFor: f === 'graceful' ? 5 : 0,
        parts: ['k8s endpoints → istiod (debounced ~100ms–1s)', 'EDS push to every sidecar (~1s)', 'outlier detection ejects on consecutive 5xx/connect failures within a few requests', 'sidecar retries connect-failure on another endpoint'],
      };
  }
}

const N = 4;
const CLIENTS = 20;
const T0 = 10;

export default function DiscoveryLab() {
  const [mode, setMode] = useState<Mode>('eureka');
  const [failure, setFailure] = useState<Failure>('crash');
  const [k, setK] = useState<Knobs>({ hb: 30, lease: 90, refresh: 30, ttl: 60, hcInterval: 10, dnsCache: 'ttl', preStop: false, retries: false, outlier: false });
  const [rps, setRps] = useState(400);
  const [speed, setSpeed] = useState(10);
  const [running, setRunning] = useState(true);
  const [t, setT] = useState(0);
  const hist = useRef<number[]>([]);
  const kn = <K extends keyof Knobs>(key: K, v: Knobs[K]) => setK((x) => ({ ...x, [key]: v }));

  const tm = useMemo(() => timing(mode, failure, k), [mode, failure, k]);
  const outlier = k.outlier || mode === 'mesh';
  const retries = k.retries || mode === 'mesh';
  const killAt = T0;
  const deadFrom = killAt + tm.servesFor;
  const removedAt = killAt + tm.detect + tm.propagate;
  const stale = Math.max(0, removedAt - deadFrom);
  const horizon = Math.max(60, Math.ceil((killAt + tm.detect + tm.propagate + 25) / 10) * 10);

  /** Fraction of all requests failing at sim time `x`. */
  const failFrac = (x: number) => {
    if (x < deadFrom || x >= removedAt) return 0;
    if (retries) return 0;
    // passive outlier detection: each client ejects after ~5 consecutive failures
    if (outlier) {
      const perClientRps = rps / CLIENTS / N;
      const ejectAfter = perClientRps > 0 ? 5 / perClientRps : Infinity;
      return x - deadFrom < ejectAfter ? 1 / N : 0;
    }
    return 1 / N;
  };
  const connectPenalty = failure === 'host' ? 1000 : 1;
  const totalFailed = useMemo(() => {
    let s = 0;
    for (let x = 0; x < horizon; x += 0.1) s += failFrac(x) * rps * 0.1;
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizon, deadFrom, removedAt, rps, retries, outlier]);
  const retriedReqs = retries ? (outlier ? Math.min(stale, 5 / Math.max(rps / CLIENTS / N, 0.001)) : stale) * (rps / N) : 0;

  useTicker(running, 100, () => {
    setT((x) => {
      const nx = x + speed * 0.1;
      if (nx > horizon) {
        hist.current = [];
        return 0;
      }
      return nx;
    });
  });

  const reset = () => {
    setT(0);
    hist.current = [];
  };

  const instDead = (x: number) => x >= deadFrom;
  const viewHas = (x: number) => x < removedAt;

  const bars = 120;
  const series = Array.from({ length: bars }, (_, i) => failFrac((i / bars) * horizon));
  const pctX = (x: number) => `${(Math.min(x, horizon) / horizon) * 100}%`;
  const fmtS = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m${Math.round(s % 60) ? ` ${Math.round(s % 60)}s` : ''}` : `${Math.round(s * 10) / 10}s`);

  const compare = MODES.map((m) => {
    const x = timing(m.value, failure, k);
    const w = Math.max(0, x.detect + x.propagate - x.servesFor);
    return { ...m, ...x, window: w };
  });

  const Row = ({ label, segs }: { label: string; segs: { from: number; to: number; cls: string; text?: string }[] }) => (
    <div className="grid grid-cols-[118px_1fr] items-center gap-2">
      <span className="truncate font-mono text-[10px] text-muted">{label}</span>
      <div className="relative h-4 rounded-sm bg-ink/[0.04]">
        {segs.map((s, i) => (
          <div key={i} className={cn('absolute top-0 flex h-4 items-center overflow-hidden rounded-sm px-1 font-mono text-[9px] text-paper', s.cls)} style={{ left: pctX(s.from), width: `calc(${pctX(s.to)} - ${pctX(s.from)})` }}>
            {s.text}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <LabFrame
      title="Service discovery: how long do callers keep hitting a dead instance?"
      goal="Instance B dies at t=10s. Watch the source of truth notice, then the callers' cached view catch up. Every second in between, a quarter of requests go to a corpse. Switch discovery style, failure type and knobs."
      running={running}
      onToggle={() => setRunning((r) => !r)}
      onReset={reset}
      controls={
        <>
          <div className="sm:col-span-2">
            <Seg label="Discovery style" value={mode} options={MODES} onChange={(v) => { setMode(v); reset(); }} />
          </div>
          <Seg
            label="How B dies"
            value={failure}
            options={[
              { value: 'crash', label: 'process crash', hint: 'port closed: connection refused, fails fast' },
              { value: 'host', label: 'host vanishes', hint: 'no RST: connect timeouts, slow failures' },
              { value: 'graceful', label: 'graceful stop', hint: 'deploy / scale-in: SIGTERM, deregister' },
            ]}
            onChange={(v) => { setFailure(v); reset(); }}
          />
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-1.5 font-mono text-[11px]">
              <input type="checkbox" checked={retries} disabled={mode === 'mesh'} onChange={(e) => kn('retries', e.target.checked)} /> retry on another instance
            </label>
            <label className="flex items-center gap-1.5 font-mono text-[11px]">
              <input type="checkbox" checked={outlier} disabled={mode === 'mesh'} onChange={(e) => kn('outlier', e.target.checked)} /> passive outlier ejection
            </label>
            {mode === 'mesh' && <span className="font-mono text-[10px] text-faint">(both on by default in the mesh)</span>}
          </div>
          {mode === 'eureka' && (
            <>
              <Slider label="heartbeat (renewal) interval" value={k.hb} min={5} max={30} step={5} onChange={(v) => kn('hb', v)} fmt={(v) => `${v}s`} />
              <Slider label="lease expiration (eviction after)" value={k.lease} min={15} max={90} step={5} onChange={(v) => kn('lease', v)} fmt={(v) => `${v}s`} />
              <Slider label="client registry fetch interval" value={k.refresh} min={5} max={30} step={5} onChange={(v) => kn('refresh', v)} fmt={(v) => `${v}s`} />
            </>
          )}
          {mode === 'dns' && (
            <>
              <Slider label="record TTL" value={k.ttl} min={5} max={300} step={5} onChange={(v) => kn('ttl', v)} fmt={(v) => `${v}s`} />
              <Seg label="health-check interval" value={k.hcInterval} options={[{ value: 10, label: '10s (fast)' }, { value: 30, label: '30s (standard)' }]} onChange={(v) => kn('hcInterval', v)} />
              <Seg
                label="client resolver cache"
                value={k.dnsCache}
                options={[
                  { value: 'ttl', label: 'honours TTL' },
                  { value: 'jvm30', label: 'JVM 30s' },
                  { value: 'forever', label: 'cache forever' },
                ]}
                onChange={(v) => kn('dnsCache', v)}
              />
            </>
          )}
          {mode === 'k8s' && failure === 'graceful' && (
            <label className="flex items-center gap-1.5 font-mono text-[11px]">
              <input type="checkbox" checked={k.preStop} onChange={(e) => kn('preStop', e.target.checked)} /> preStop: sleep 10 (keep serving while endpoints propagate)
            </label>
          )}
          <Slider label="traffic to the service" value={rps} min={50} max={2000} step={50} onChange={setRps} fmt={(v) => `${v} rps`} />
          <Slider label="simulation speed" value={speed} min={1} max={30} onChange={setSpeed} fmt={(v) => `${v}×`} />
        </>
      }
      stats={
        <>
          <Stat label="stale window" value={fmtS(stale)} tone={stale < 3 ? 'ok' : stale < 30 ? 'warn' : 'bad'} sub="B dead but still in callers' view" />
          <Stat label="failed requests" value={Math.round(totalFailed).toLocaleString()} tone={totalFailed < 10 ? 'ok' : totalFailed < 1000 ? 'warn' : 'bad'} sub={`at ${rps} rps over ${N} instances`} />
          <Stat
            label="retried requests"
            value={Math.round(retriedReqs).toLocaleString()}
            tone={retries ? (failure === 'host' ? 'warn' : 'ok') : undefined}
            sub={retries ? `each +${connectPenalty >= 1000 ? '1s connect timeout' : '~1ms (fast RST)'}` : 'retries off'}
          />
          <Stat label="sim clock" value={`${Math.floor(t)}s`} sub={t < killAt ? 'B healthy' : instDead(t) ? (viewHas(t) ? 'B dead · still routed' : 'B removed everywhere') : 'B draining (preStop)'} />
        </>
      }
      insight={
        <span>
          {mode === 'eureka' &&
            (failure === 'graceful'
              ? 'Even a clean deregistration takes up to ~90s to reach callers: three caches stacked (server response cache, client fetch, LB list). Shrink them, or retry on another instance.'
              : `Eureka favours availability, so it is slow to forget: lease ${k.lease}s + eviction timer + three caches ≈ ${fmtS(tm.detect + tm.propagate)} worst case. Lowering the lease helps, but shorter leases plus network blips mean more false evictions (that is what self-preservation guards against). Client retries and outlier ejection are the real fix.`)}
          {mode === 'k8s' &&
            (failure === 'crash'
              ? 'A crashed container is noticed by the kubelet at once, so endpoints update in ~2–3s. Readiness probes matter for hangs, not crashes.'
              : failure === 'host'
                ? 'When a whole node disappears nobody runs probes. The control plane waits node-monitor-grace-period (~40s) before marking pods NotReady, and connections hang until timeout. Client-side timeouts + retries cover this gap.'
                : k.preStop
                  ? 'With a preStop sleep the pod keeps serving while every kube-proxy and ingress drops it, so zero errors on deploy. This is the standard fix.'
                  : 'Without preStop, SIGTERM and endpoint removal race: the app stops before every node has updated iptables, so each rolling deploy drops requests. Add a preStop sleep and handle SIGTERM by draining.')}
          {mode === 'dns' &&
            `DNS staleness is TTL plus every cache between you and the authority. ${k.dnsCache === 'forever' ? 'A client that caches forever never moves off a dead IP until restart: classic JVM / connection-pool bug.' : ''} Low TTLs raise resolver load and still don't fix pooled connections. DNS is fine for coarse failover, poor for fast instance churn.`}
          {mode === 'mesh' &&
            'The sidecar learns removals by push (EDS) in about a second, and passive outlier detection plus connect-failure retries hide the gap entirely. You pay with a sidecar hop (~0.5–1ms) and a control plane to run.'}
        </span>
      }
    >
      <div className="space-y-2 p-1">
        <div className="flex items-center gap-2">
          {['A', 'B', 'C', 'D'].map((id) => {
            const dead = id === 'B' && instDead(t);
            const routed = id !== 'B' || viewHas(t);
            return (
              <div
                key={id}
                className={cn(
                  'flex h-10 flex-1 items-center justify-center gap-1 rounded-md border font-mono text-[11px] transition-colors',
                  dead ? (routed ? 'animate-pulse border-bad bg-bad/15 text-bad' : 'border-line bg-ink/[0.04] text-faint line-through') : 'border-ok/50 bg-ok/10',
                )}
              >
                {dead && <Skull size={12} />} {id}
                <span className="text-[9.5px] text-faint">{routed ? `${Math.round(100 / (viewHas(t) ? N : N - 1))}%` : 'removed'}</span>
              </div>
            );
          })}
          <Button size="xs" variant="secondary" onClick={() => setT(Math.max(0, killAt - 2))}>
            replay
          </Button>
        </div>
        <div className="relative space-y-1">
          <Row label="B actually alive" segs={[{ from: 0, to: deadFrom, cls: 'bg-ok/70', text: tm.servesFor ? 'serving (draining)' : 'up' }, { from: deadFrom, to: horizon, cls: 'bg-bad/60', text: 'dead' }]} />
          <Row label="source of truth lists B" segs={[{ from: 0, to: killAt + tm.detect, cls: 'bg-info/70', text: 'registered' }]} />
          <Row label="callers route to B" segs={[{ from: 0, to: removedAt, cls: removedAt > deadFrom ? 'bg-warn/80' : 'bg-info/70', text: 'in client view' }]} />
          <div className="grid grid-cols-[118px_1fr] items-end gap-2">
            <span className="font-mono text-[10px] text-muted">error rate</span>
            <div className="flex h-8 items-end gap-px">
              {series.map((v, i) => (
                <div key={i} className={cn('flex-1 rounded-t-sm', v > 0 ? 'bg-bad/70' : 'bg-ok/30')} style={{ height: `${Math.max(6, v * 100 * 3)}%` }} />
              ))}
            </div>
          </div>
          <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-accent" style={{ left: `calc(118px + 0.5rem + (100% - 118px - 0.5rem) * ${Math.min(t, horizon) / horizon})` }} />
          <div className="grid grid-cols-[118px_1fr] gap-2 font-mono text-[9px] text-faint">
            <span />
            <div className="flex justify-between">
              <span>0s</span>
              <span>kill @ {killAt}s</span>
              <span>{horizon}s</span>
            </div>
          </div>
        </div>
        <div className="rounded-md border border-line bg-surface p-2">
          <div className="eyebrow mb-1">Why it takes {fmtS(tm.detect + tm.propagate)}: the chain of delays</div>
          <div className="flex flex-wrap gap-1">
            {tm.parts.map((p, i) => (
              <span key={i} className="rounded border border-line bg-paper px-1.5 py-0.5 font-mono text-[10px]">
                {i + 1}. {p}
              </span>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full text-left font-mono text-[10.5px]">
            <thead className="bg-sunken text-faint">
              <tr>
                <th className="px-2 py-1">same failure, other styles</th>
                <th className="px-2 py-1">detect</th>
                <th className="px-2 py-1">propagate</th>
                <th className="px-2 py-1">worst stale window</th>
              </tr>
            </thead>
            <tbody>
              {compare.map((c) => (
                <tr key={c.value} className={cn('border-t border-line', c.value === mode && 'bg-accent/10')}>
                  <td className="px-2 py-1">{c.label}</td>
                  <td className="px-2 py-1">{fmtS(c.detect)}</td>
                  <td className="px-2 py-1">{fmtS(c.propagate)}</td>
                  <td className={cn('px-2 py-1 font-semibold', c.window < 3 ? 'text-ok' : c.window < 30 ? 'text-warn' : 'text-bad')}>{fmtS(c.window)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </LabFrame>
  );
}
